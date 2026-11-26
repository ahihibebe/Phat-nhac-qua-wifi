import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ReceiverDevice, RoomSettings, ServerMessage } from '../types/audio';
import { decodePcmPacket } from '../utils/pcmPacketizer';
import { getWebSocketUrl } from '../utils/wsEndpoint';

export interface AudioOutputOption {
  deviceId: string;
  label: string;
}

export function useReceiverClient(
  roomId: string,
  initialName: string,
  initialSpeaker: string,
  serverOriginOverride?: string
) {
  const [wsConnected, setWsConnected] = useState(false);
  const [hostConnected, setHostConnected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [deviceConfig, setDeviceConfig] = useState<ReceiverDevice | null>(null);
  const [roomSettings, setRoomSettings] = useState<RoomSettings>({
    sampleRate: 48000,
    frameDurationMs: 20,
    jitterBufferMs: 80,
    isPlaying: false,
    trackTitle: 'Đang chờ máy chủ phát nhạc...',
    trackPositionSec: 0,
    trackDurationSec: 0,
  });

  const [rttMs, setRttMs] = useState(0);
  const [bufferMs, setBufferMs] = useState(0);
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [packetsDropped, setPacketsDropped] = useState(0);
  const [signalDb, setSignalDb] = useState(-60);
  const [outputDevices, setOutputDevices] = useState<AudioOutputOption[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string>('default');
  const [sinkSupported, setSinkSupported] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const serverOffsetMsRef = useRef(0);
  const rttMsRef = useRef(0);
  const nextScheduledTimeRef = useRef(0);
  const lastSeqRef = useRef<number | null>(null);
  const packetsReceivedRef = useRef(0);
  const packetsDroppedRef = useRef(0);
  const bufferMsRef = useRef(0);
  const audioReadyRef = useRef(false);
  const deviceConfigRef = useRef<ReceiverDevice | null>(null);
  const outputLabelRef = useRef('Mặc định / Loa Bluetooth đang kết nối');

  useEffect(() => {
    deviceConfigRef.current = deviceConfig;
    if (gainNodeRef.current && audioCtxRef.current && deviceConfig) {
      const targetGain = deviceConfig.muted ? 0 : deviceConfig.volume;
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioCtxRef.current.currentTime, 0.015);
    }
  }, [deviceConfig]);

  const sendControl = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const refreshOutputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Đầu ra âm thanh #${idx + 1}`,
        }));
      setOutputDevices(outputs);
    } catch {
      // Browser may restrict enumerateDevices before permission
    }
  }, []);

  const enableAudio = useCallback(async () => {
    const targetRate = roomSettings.sampleRate || 48000;
    if (!audioCtxRef.current) {
      const ctx = new AudioContext({ sampleRate: targetRate });
      const gain = ctx.createGain();
      const cfg = deviceConfigRef.current;
      gain.gain.value = cfg ? (cfg.muted ? 0 : cfg.volume) : 1;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;

      const anyCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      setSinkSupported(typeof anyCtx.setSinkId === 'function');
    }

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    audioReadyRef.current = true;
    setAudioReady(true);
    nextScheduledTimeRef.current = 0;
    window.__MTB_ANDROID__?.setBackgroundPlayback?.(
      true,
      roomSettings.trackTitle || 'MusicToBlutooth Nhận',
      `Đang kết nối loa Bluetooth · Phòng ${roomId}`
    );
    await refreshOutputDevices();
  }, [refreshOutputDevices, roomId, roomSettings.sampleRate, roomSettings.trackTitle]);

  const selectAudioOutput = useCallback(
    async (deviceId: string) => {
      setSelectedOutputId(deviceId);
      const found = outputDevices.find((d) => d.deviceId === deviceId);
      if (found) {
        outputLabelRef.current = found.label;
      }
      const ctx = audioCtxRef.current as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
      if (ctx && typeof ctx.setSinkId === 'function') {
        try {
          await ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
        } catch {
          // Ignore sink switch failure on unsupported device
        }
      }
    },
    [outputDevices]
  );

  // Connect WebSocket & process incoming binary PCM stream
  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let telemetryTimer: number | null = null;

    const connect = () => {
      const ws = new WebSocket(getWebSocketUrl(serverOriginOverride));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        setWsConnected(true);
        sendControl({
          type: 'room:join',
          roomId,
          role: 'receiver',
          deviceName: initialName,
          speakerLabel: initialSpeaker,
        });
        sendControl({ type: 'sync:ping', clientSendMs: Date.now() });

        pingTimer = window.setInterval(() => {
          sendControl({ type: 'sync:ping', clientSendMs: Date.now() });
        }, 3000);

        telemetryTimer = window.setInterval(() => {
          sendControl({
            type: 'receiver:telemetry',
            rttMs: rttMsRef.current,
            bufferMs: Math.round(bufferMsRef.current),
            packetsReceived: packetsReceivedRef.current,
            packetsDropped: packetsDroppedRef.current,
            audioReady: audioReadyRef.current,
            outputDeviceLabel: outputLabelRef.current,
          });
        }, 1200);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const parsed = decodePcmPacket(event.data);
          if (!parsed) return;

          packetsReceivedRef.current += 1;

          if (!parsed.checksumValid) {
            packetsDroppedRef.current += 1;
            return;
          }

          if (!parsed.isTestTone && lastSeqRef.current !== null && parsed.seq > lastSeqRef.current + 1) {
            const gap = parsed.seq - lastSeqRef.current - 1;
            if (gap < 20) {
              packetsDroppedRef.current += gap;
            }
          }
          if (!parsed.isTestTone) {
            lastSeqRef.current = parsed.seq;
          }

          const ctx = audioCtxRef.current;
          const gain = gainNodeRef.current;
          if (!ctx || !gain || !audioReadyRef.current) return;

          const cfg = deviceConfigRef.current;
          if (cfg?.muted) return;

          const outLeft = new Float32Array(parsed.frameSamples);
          const outRight = new Float32Array(parsed.frameSamples);
          const mode = cfg?.channelMode || 'stereo';

          for (let i = 0; i < parsed.frameSamples; i++) {
            const l = parsed.left[i];
            const r = parsed.right[i];
            if (mode === 'left') {
              outLeft[i] = l;
              outRight[i] = l;
            } else if (mode === 'right') {
              outLeft[i] = r;
              outRight[i] = r;
            } else if (mode === 'mono') {
              const m = (l + r) * 0.5;
              outLeft[i] = m;
              outRight[i] = m;
            } else {
              outLeft[i] = l;
              outRight[i] = r;
            }
          }

          const audioBuf = ctx.createBuffer(2, parsed.frameSamples, parsed.sampleRate);
          audioBuf.copyToChannel(outLeft, 0);
          audioBuf.copyToChannel(outRight, 1);

          const src = ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(gain);

          // Synchronized scheduling using NTP clock offset + per-Bluetooth delay offset
          const delayOffsetMs = cfg?.delayOffsetMs || 0;
          const targetLocalMs = parsed.playAtServerMs + delayOffsetMs - serverOffsetMsRef.current;
          const deltaSec = (targetLocalMs - Date.now()) / 1000;
          const desiredStartCtxTime = ctx.currentTime + Math.max(0.015, deltaSec);
          const frameDurSec = audioBuf.duration;

          let startAt = desiredStartCtxTime;
          if (
            nextScheduledTimeRef.current > ctx.currentTime &&
            Math.abs(nextScheduledTimeRef.current - desiredStartCtxTime) < 0.085
          ) {
            startAt = nextScheduledTimeRef.current;
          }

          src.start(startAt);
          nextScheduledTimeRef.current = startAt + frameDurSec;
          bufferMsRef.current = Math.max(0, (nextScheduledTimeRef.current - ctx.currentTime) * 1000);

          if ((packetsReceivedRef.current & 3) === 0) {
            setPacketsReceived(packetsReceivedRef.current);
            setPacketsDropped(packetsDroppedRef.current);
            setSignalDb(parsed.rmsDb);
            setBufferMs(Math.round(bufferMsRef.current));
          }
          return;
        }

        if (typeof event.data === 'string') {
          let msg: ServerMessage;
          try {
            msg = JSON.parse(event.data) as ServerMessage;
          } catch {
            return;
          }

          if (msg.type === 'sync:pong') {
            const now = Date.now();
            const rtt = Math.max(0, now - msg.clientSendMs);
            rttMsRef.current = rtt;
            setRttMs(rtt);
            const estimatedServerNow = msg.serverTimeMs + rtt / 2;
            serverOffsetMsRef.current = estimatedServerNow - now;
          } else if (msg.type === 'device:config') {
            setDeviceConfig(msg.device);
          } else if (msg.type === 'room:settings') {
            setRoomSettings(msg.settings);
            if (audioReadyRef.current) {
              window.__MTB_ANDROID__?.setBackgroundPlayback?.(
                true,
                msg.settings.trackTitle || 'MusicToBlutooth Nhận',
                msg.settings.isPlaying
                  ? `Đang phát ra loa Bluetooth · Phòng ${roomId}`
                  : `Đang chờ máy chủ · Phòng ${roomId}`
              );
              if ('mediaSession' in navigator) {
                try {
                  navigator.mediaSession.metadata = new MediaMetadata({
                    title: msg.settings.trackTitle,
                    artist: 'MusicToBlutooth Nhận',
                    album: `Phòng ${roomId}`,
                  });
                  navigator.mediaSession.playbackState = msg.settings.isPlaying ? 'playing' : 'paused';
                } catch {
                  // ignore
                }
              }
            }
          } else if (msg.type === 'room:state') {
            setHostConnected(msg.hostConnected);
            setRoomSettings(msg.settings);
          } else if (msg.type === 'host:disconnected') {
            setHostConnected(false);
            setSignalDb(-60);
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer !== null) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (telemetryTimer !== null) {
          clearInterval(telemetryTimer);
          telemetryTimer = null;
        }
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (pingTimer !== null) clearInterval(pingTimer);
      if (telemetryTimer !== null) clearInterval(telemetryTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [initialName, initialSpeaker, roomId, sendControl, serverOriginOverride]);

  useEffect(() => {
    const onVisibility = () => {
      if (audioReadyRef.current && audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const updateSelf = useCallback(
    (patch: {
      name?: string;
      speakerLabel?: string;
      volume?: number;
      muted?: boolean;
      delayOffsetMs?: number;
    }) => {
      sendControl({ type: 'receiver:update-self', ...patch });
    },
    [sendControl]
  );

  return {
    wsConnected,
    hostConnected,
    audioReady,
    deviceConfig,
    roomSettings,
    rttMs,
    bufferMs,
    packetsReceived,
    packetsDropped,
    signalDb,
    outputDevices,
    selectedOutputId,
    sinkSupported,
    enableAudio,
    selectAudioOutput,
    updateSelf,
  };
}
