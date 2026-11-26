import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ClientMessage,
  ClientRole,
  ReceiverDevice,
  ReleasePayload,
  RoomSettings,
  ServerMessage,
} from './src/types/audio.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  roomId: string;
  role: ClientRole;
}

interface RoomState {
  roomId: string;
  hostClientId: string | null;
  clients: Map<string, ConnectedClient>;
  receivers: Map<string, ReceiverDevice>;
  settings: RoomSettings;
}

const rooms = new Map<string, RoomState>();

function createDefaultRoom(roomId: string): RoomState {
  return {
    roomId,
    hostClientId: null,
    clients: new Map(),
    receivers: new Map(),
    settings: {
      sampleRate: 48000,
      frameDurationMs: 20,
      jitterBufferMs: 80,
      isPlaying: false,
      trackTitle: 'Chưa chọn bản nhạc',
      trackPositionSec: 0,
      trackDurationSec: 0,
    },
  };
}

function getOrCreateRoom(rawRoomId: string): RoomState {
  const roomId = (rawRoomId || 'MB48').trim().toUpperCase().slice(0, 12) || 'MB48';
  let room = rooms.get(roomId);
  if (!room) {
    room = createDefaultRoom(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

function sendJson(ws: WebSocket, payload: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoomState(room: RoomState) {
  const stateMsg: ServerMessage = {
    type: 'room:state',
    roomId: room.roomId,
    receivers: Array.from(room.receivers.values()),
    settings: room.settings,
    hostConnected: room.hostClientId !== null,
  };
  for (const client of room.clients.values()) {
    sendJson(client.ws, stateMsg);
  }
}

function sendCalibrationToneToReceiver(room: RoomState, receiverId: string) {
  const targetClient = room.clients.get(receiverId);
  if (!targetClient || targetClient.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const sampleRate = room.settings.sampleRate;
  const frameDurationMs = room.settings.frameDurationMs;
  const frameSamples = Math.round((sampleRate * frameDurationMs) / 1000);
  const totalFrames = Math.ceil(400 / frameDurationMs);
  const basePlayMs = Date.now() + Math.max(60, room.settings.jitterBufferMs);

  for (let f = 0; f < totalFrames; f++) {
    const headerBytes = 24;
    const payloadBytes = frameSamples * 2 * 2;
    const buf = Buffer.allocUnsafe(headerBytes + payloadBytes);
    const seq = 900000 + f;
    const flags = 0x01 | 0x02;

    buf.writeUInt8(0x4d, 0);
    buf.writeUInt8(0x42, 1);
    buf.writeUInt8(1, 2);
    buf.writeUInt8(flags, 3);
    buf.writeUInt32LE(seq >>> 0, 4);
    buf.writeDoubleLE(basePlayMs + f * frameDurationMs, 8);
    buf.writeUInt32LE(sampleRate >>> 0, 16);
    buf.writeUInt16LE(frameSamples & 0xffff, 20);

    let checksum = (seq ^ sampleRate ^ frameSamples ^ flags) & 0xffff;
    let offset = headerBytes;

    for (let i = 0; i < frameSamples; i++) {
      const globalSample = f * frameSamples + i;
      const t = globalSample / sampleRate;
      const env = Math.min(1, t / 0.015) * Math.exp(-t * 7.5);
      const freq = t < 0.18 ? 880 : 1318.5;
      const sampleFloat = Math.sin(2 * Math.PI * freq * t) * env * 0.45;
      const sampleInt = sampleFloat < 0 ? Math.round(sampleFloat * 32768) : Math.round(sampleFloat * 32767);

      buf.writeInt16LE(sampleInt, offset);
      buf.writeInt16LE(sampleInt, offset + 2);
      offset += 4;

      if ((i & 15) === 0) {
        checksum = (checksum + (sampleInt & 0xffff)) & 0xffff;
      }
    }

    buf.writeUInt16LE(checksum, 22);
    targetClient.ws.send(buf);
  }
}

function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}

/**
 * Pure Node.js ZIP builder using zlib.crc32 & deflateRawSync to bundle android/ + .github/workflows/
 * so users can download the fixed Gradle parallel APK build source directly from the homepage.
 */
function collectFilesRecursive(baseDir: string, currentDir: string, out: { zipPath: string; absPath: string }[]) {
  if (!fs.existsSync(currentDir)) return;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'build' || entry.name === '.gradle') continue;
      collectFilesRecursive(baseDir, abs, out);
    } else {
      out.push({
        zipPath: path.relative(baseDir, abs).replace(/\\/g, '/'),
        absPath: abs,
      });
    }
  }
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZipBuffer(files: { zipPath: string; content: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.zipPath, 'utf8');
    const compressed = zlib.deflateRawSync(file.content);
    const crc = crc32(file.content);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function buildBundledRelease(repoSlug: string | null): ReleasePayload {
  return {
    version: 'v1.0.0',
    publishedAt: '2026-11-26',
    repoSlug,
    source: 'bundled',
    releaseNotes:
      'Phát hành song song 2 bản APK Android (Truyền & Nhận), đã khắc phục xung đột kotlin-stdlib-jdk8 trong Gradle 8.7.',
    assets: [
      {
        id: 'apk-transmitter',
        role: 'transmitter',
        title: 'Bản Truyền (Máy chủ phát nhạc)',
        fileName: 'MusicToBlutooth-Truyen.apk',
        packageId: 'com.musictoblutooth.transmitter',
        version: 'v1.0.0',
        sizeLabel: 'APK · Android 7.0+',
        description:
          'Cài trên máy chính để quét thư mục nhạc, lưu danh sách phát và truyền gói PCM qua Wi-Fi tới nhiều loa.',
        downloadUrl: '/api/download/android-project.zip',
      },
      {
        id: 'apk-receiver',
        role: 'receiver',
        title: 'Bản Nhận (Điện thoại cắm loa Bluetooth)',
        fileName: 'MusicToBlutooth-Nhan.apk',
        packageId: 'com.musictoblutooth.receiver',
        version: 'v1.0.0',
        sizeLabel: 'APK · Android 7.0+',
        description:
          'Cài trên từng điện thoại kết nối loa Bluetooth để nhận âm thanh đồng bộ, tự động khóa Wi-Fi Multicast.',
        downloadUrl: '/api/download/android-project.zip',
      },
    ],
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, serverTimeMs: Date.now() });
  });

  app.get('/api/network-info', (req, res) => {
    const lanIps = getLanAddresses();
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    res.json({
      lanIps,
      port: PORT,
      suggestedUrls: lanIps.map((ip) => `http://${ip}:${PORT}`),
      originUrl: `${protocol}://${hostHeader}`,
    });
  });

  app.get('/api/releases', async (req, res) => {
    const queryRepo = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const repoSlug = queryRepo || process.env.GITHUB_REPOSITORY || null;

    if (repoSlug && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoSlug)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'MusicToBlutooth-Server',
          },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (ghRes.ok) {
          const data = (await ghRes.json()) as {
            tag_name?: string;
            published_at?: string;
            body?: string;
            assets?: { name: string; browser_download_url: string; size: number }[];
          };
          const ghAssets = data.assets || [];
          const truyenAsset = ghAssets.find((a) => /truyen|transmitter/i.test(a.name));
          const nhanAsset = ghAssets.find((a) => /nhan|receiver/i.test(a.name));

          const base = buildBundledRelease(repoSlug);
          if (truyenAsset || nhanAsset) {
            const payload: ReleasePayload = {
              version: data.tag_name || base.version,
              publishedAt: data.published_at ? data.published_at.slice(0, 10) : base.publishedAt,
              repoSlug,
              source: 'github',
              releaseNotes: data.body?.slice(0, 220) || base.releaseNotes,
              assets: [
                {
                  ...base.assets[0],
                  version: data.tag_name || base.version,
                  fileName: truyenAsset?.name || base.assets[0].fileName,
                  sizeLabel: truyenAsset
                    ? `${(truyenAsset.size / (1024 * 1024)).toFixed(1)} MB · APK`
                    : base.assets[0].sizeLabel,
                  downloadUrl: truyenAsset?.browser_download_url || base.assets[0].downloadUrl,
                },
                {
                  ...base.assets[1],
                  version: data.tag_name || base.version,
                  fileName: nhanAsset?.name || base.assets[1].fileName,
                  sizeLabel: nhanAsset
                    ? `${(nhanAsset.size / (1024 * 1024)).toFixed(1)} MB · APK`
                    : base.assets[1].sizeLabel,
                  downloadUrl: nhanAsset?.browser_download_url || base.assets[1].downloadUrl,
                },
              ],
            };
            res.json(payload);
            return;
          }
        }
      } catch {
        // Fall back to bundled release info
      }
    }

    res.json(buildBundledRelease(repoSlug));
  });

  app.get('/api/download/android-project.zip', (_req, res) => {
    const collected: { zipPath: string; absPath: string }[] = [];
    collectFilesRecursive(__dirname, path.join(__dirname, 'android'), collected);
    collectFilesRecursive(__dirname, path.join(__dirname, '.github'), collected);

    const files = collected.map((item) => ({
      zipPath: item.zipPath,
      content: fs.readFileSync(item.absPath),
    }));

    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      const distCollected: { zipPath: string; absPath: string }[] = [];
      collectFilesRecursive(distDir, distDir, distCollected);
      for (const item of distCollected) {
        files.push({
          zipPath: `android/app/src/main/assets/www/${item.zipPath}`,
          content: fs.readFileSync(item.absPath),
        });
      }
    }

    const zipBuf = createZipBuffer(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="MusicToBlutooth-Android-DualAPK.zip"');
    res.send(zipBuf);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const clientId = `dev-${Math.random().toString(36).slice(2, 8)}`;
    let currentClient: ConnectedClient | null = null;

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!currentClient || currentClient.role !== 'host') return;
        const room = rooms.get(currentClient.roomId);
        if (!room) return;

        const packetBuffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);

        for (const client of room.clients.values()) {
          if (client.role === 'receiver' && client.ws.readyState === WebSocket.OPEN) {
            const rec = room.receivers.get(client.id);
            if (rec && !rec.muted) {
              client.ws.send(packetBuffer, { binary: true });
            }
          }
        }
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'sync:ping') {
        sendJson(ws, {
          type: 'sync:pong',
          clientSendMs: msg.clientSendMs,
          serverTimeMs: Date.now(),
        });
        return;
      }

      if (msg.type === 'room:join') {
        if (currentClient) {
          const prevRoom = rooms.get(currentClient.roomId);
          if (prevRoom) {
            prevRoom.clients.delete(currentClient.id);
            prevRoom.receivers.delete(currentClient.id);
            if (prevRoom.hostClientId === currentClient.id) {
              prevRoom.hostClientId = null;
            }
            broadcastRoomState(prevRoom);
          }
        }

        const room = getOrCreateRoom(msg.roomId);
        currentClient = {
          ws,
          id: clientId,
          roomId: room.roomId,
          role: msg.role,
        };
        room.clients.set(clientId, currentClient);

        if (msg.role === 'host') {
          room.hostClientId = clientId;
        } else {
          const idx = room.receivers.size + 1;
          const device: ReceiverDevice = {
            id: clientId,
            name: msg.deviceName?.trim() || `Điện thoại #${idx}`,
            speakerLabel: msg.speakerLabel?.trim() || `Loa Bluetooth ${idx}`,
            volume: 1,
            muted: false,
            delayOffsetMs: 0,
            channelMode: 'stereo',
            rttMs: 0,
            bufferMs: 0,
            packetsReceived: 0,
            packetsDropped: 0,
            audioReady: false,
            outputDeviceLabel: 'Mặc định / Bluetooth hệ thống',
            connectedAt: Date.now(),
            lastSeenAt: Date.now(),
          };
          room.receivers.set(clientId, device);
          sendJson(ws, { type: 'device:config', device });
        }

        broadcastRoomState(room);
        return;
      }

      if (!currentClient) return;
      const room = rooms.get(currentClient.roomId);
      if (!room) return;

      if (msg.type === 'host:settings' && currentClient.role === 'host') {
        room.settings = { ...room.settings, ...msg.settings };
        for (const client of room.clients.values()) {
          if (client.id !== currentClient.id) {
            sendJson(client.ws, { type: 'room:settings', settings: room.settings });
          }
        }
        return;
      }

      if (msg.type === 'host:update-device' && currentClient.role === 'host') {
        const dev = room.receivers.get(msg.receiverId);
        if (!dev) return;
        const updated: ReceiverDevice = { ...dev, ...msg.patch };
        room.receivers.set(msg.receiverId, updated);
        const targetClient = room.clients.get(msg.receiverId);
        if (targetClient) {
          sendJson(targetClient.ws, { type: 'device:config', device: updated });
        }
        broadcastRoomState(room);
        return;
      }

      if (msg.type === 'host:kick-device' && currentClient.role === 'host') {
        const targetClient = room.clients.get(msg.receiverId);
        if (targetClient) {
          targetClient.ws.close(4000, 'Host disconnected device');
        }
        room.clients.delete(msg.receiverId);
        room.receivers.delete(msg.receiverId);
        broadcastRoomState(room);
        return;
      }

      if (msg.type === 'host:test-tone' && currentClient.role === 'host') {
        sendCalibrationToneToReceiver(room, msg.receiverId);
        return;
      }

      if (msg.type === 'receiver:telemetry' && currentClient.role === 'receiver') {
        const dev = room.receivers.get(currentClient.id);
        if (!dev) return;
        const updated: ReceiverDevice = {
          ...dev,
          rttMs: msg.rttMs,
          bufferMs: msg.bufferMs,
          packetsReceived: msg.packetsReceived,
          packetsDropped: msg.packetsDropped,
          audioReady: msg.audioReady,
          outputDeviceLabel: msg.outputDeviceLabel || dev.outputDeviceLabel,
          lastSeenAt: Date.now(),
        };
        room.receivers.set(currentClient.id, updated);
        broadcastRoomState(room);
        return;
      }

      if (msg.type === 'receiver:update-self' && currentClient.role === 'receiver') {
        const dev = room.receivers.get(currentClient.id);
        if (!dev) return;
        const updated: ReceiverDevice = {
          ...dev,
          name: msg.name !== undefined ? msg.name : dev.name,
          speakerLabel: msg.speakerLabel !== undefined ? msg.speakerLabel : dev.speakerLabel,
          volume: msg.volume !== undefined ? msg.volume : dev.volume,
          muted: msg.muted !== undefined ? msg.muted : dev.muted,
          delayOffsetMs: msg.delayOffsetMs !== undefined ? msg.delayOffsetMs : dev.delayOffsetMs,
        };
        room.receivers.set(currentClient.id, updated);
        sendJson(ws, { type: 'device:config', device: updated });
        broadcastRoomState(room);
      }
    });

    ws.on('close', () => {
      if (!currentClient) return;
      const room = rooms.get(currentClient.roomId);
      if (!room) return;

      room.clients.delete(currentClient.id);
      if (currentClient.role === 'receiver') {
        room.receivers.delete(currentClient.id);
      }
      if (room.hostClientId === currentClient.id) {
        room.hostClientId = null;
        room.settings.isPlaying = false;
        for (const client of room.clients.values()) {
          sendJson(client.ws, { type: 'host:disconnected' });
        }
      }

      if (room.clients.size === 0) {
        rooms.delete(room.roomId);
      } else {
        broadcastRoomState(room);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MusicToBlutooth server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
