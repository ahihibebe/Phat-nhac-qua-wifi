import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  DecodedTrack,
  FrameDurationMs,
  ReceiverDevice,
  RoomSettings,
  SampleRateOption,
  SavedPlaylist,
  ServerMessage,
} from '../types/audio';
import { classifyAudioFormat, extractCoverArtFromBuffer } from '../utils/coverExtractor';
import { encodePcmPacket, extractWaveformPeaks } from '../utils/pcmPacketizer';
import {
  deleteStoredAudioFile,
  loadAllStoredAudioFiles,
  loadSavedPlaylists,
  persistSavedPlaylists,
  saveAudioFileRecord,
} from '../utils/playlistStorage';
import { buildBuiltInTracks } from '../utils/synthTracks';

interface HostMetrics {
  packetsSent: number;
  bytesSent: number;
  kbps: number;
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'opus', 'webm']);

export function useHostStreamer(roomId: string) {
  const [wsConnected, setWsConnected] = useState(false);
  const [receivers, setReceivers] = useState<ReceiverDevice[]>([]);
  const [settings, setSettings] = useState<RoomSettings>({
    sampleRate: 48000,
    frameDurationMs: 20,
    jitterBufferMs: 80,
    isPlaying: false,
    trackTitle: 'Chưa chọn bản nhạc',
    trackCoverUrl: undefined,
    trackPositionSec: 0,
    trackDurationSec: 0,
  });

  const [tracks, setTracks] = useState<DecodedTrack[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>(() => loadSavedPlaylists());
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [loopTrack, setLoopTrack] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [currentPositionSec, setCurrentPositionSec] = useState(0);
  const [localMonitorEnabled, setLocalMonitorEnabled] = useState(true);
  const [localMonitorVolume, setLocalMonitorVolume] = useState(0.75);
  const [spectrumBands, setSpectrumBands] = useState<number[]>(() => new Array(32).fill(0));
  const [metrics, setMetrics] = useState<HostMetrics>({
    packetsSent: 0,
    bytesSent: 0,
    kbps: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);

  const serverOffsetMsRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const loopTrackRef = useRef(false);
  const shuffleRef = useRef(false);
  const tracksRef = useRef<DecodedTrack[]>([]);
  const activeTrackRef = useRef<DecodedTrack | null>(null);
  const settingsRef = useRef(settings);
  const localMonitorEnabledRef = useRef(localMonitorEnabled);
  const localMonitorVolumeRef = useRef(localMonitorVolume);

  const sampleCursorRef = useRef(0);
  const seqRef = useRef(1);
  const nextTickPerfMsRef = useRef(0);
  const schedulerTimerRef = useRef<number | null>(null);
  const bytesWindowRef = useRef<{ ts: number; bytes: number }[]>([]);
  const totalPacketsRef = useRef(0);
  const totalBytesRef = useRef(0);
  const advanceTrackCallbackRef = useRef<() => void>(() => {});

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    loopTrackRef.current = loopTrack;
  }, [loopTrack]);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  useEffect(() => {
    localMonitorEnabledRef.current = localMonitorEnabled;
    localMonitorVolumeRef.current = localMonitorVolume;
    if (monitorGainRef.current && audioCtxRef.current) {
      const target = localMonitorEnabled ? localMonitorVolume : 0;
      monitorGainRef.current.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.015);
    }
  }, [localMonitorEnabled, localMonitorVolume]);

  const sendControl = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const ensureAudioContext = useCallback((sampleRate: SampleRateOption) => {
    if (!audioCtxRef.current || audioCtxRef.current.sampleRate !== sampleRate) {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      const ctx = new AudioContext({ sampleRate });
      const gain = ctx.createGain();
      gain.gain.value = localMonitorEnabledRef.current ? localMonitorVolumeRef.current : 0;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      monitorGainRef.current = gain;
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  // Initialize built-in tracks + restore stored tracks from IndexedDB
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const builtIns = buildBuiltInTracks(48000);
      const storedRecords = await loadAllStoredAudioFiles();
      const restored: DecodedTrack[] = [];

      if (storedRecords.length > 0) {
        const offline = new OfflineAudioContext(2, 48000, 48000);
        for (const rec of storedRecords) {
          try {
            const arrBuf = await rec.blob.arrayBuffer();
            const audioBuf = await offline.decodeAudioData(arrBuf);
            restored.push({
              id: rec.id,
              title: rec.title,
              artistOrSource: `Đã lưu (${(rec.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
              formatLabel: `${rec.formatCategory} · ${(audioBuf.sampleRate / 1000).toFixed(1)} kHz · ${
                audioBuf.numberOfChannels === 1 ? 'Mono' : 'Stereo'
              }`,
              formatCategory: rec.formatCategory,
              coverUrl: rec.coverUrl,
              durationSec: audioBuf.duration,
              sampleRate: audioBuf.sampleRate,
              channels: audioBuf.numberOfChannels,
              buffer: audioBuf,
              peaks: extractWaveformPeaks(audioBuf),
              isBuiltIn: false,
              fileSizeBytes: rec.fileSizeBytes,
            });
          } catch {
            // Skip corrupted stored entry
          }
        }
      }

      if (cancelled) return;
      const merged = [...restored, ...builtIns];
      setTracks(merged);
      tracksRef.current = merged;
      if (merged.length > 0) {
        setActiveTrackId(merged[0].id);
        activeTrackRef.current = merged[0];
        setSettings((prev) => ({
          ...prev,
          trackTitle: merged[0].title,
          trackCoverUrl: merged[0].coverUrl,
          trackDurationSec: merged[0].durationSec,
        }));
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // WebSocket + Clock Sync
  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        setWsConnected(true);
        sendControl({ type: 'room:join', roomId, role: 'host' });
        sendControl({ type: 'sync:ping', clientSendMs: Date.now() });
        pingTimer = window.setInterval(() => {
          sendControl({ type: 'sync:ping', clientSendMs: Date.now() });
        }, 4000);
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        if (msg.type === 'sync:pong') {
          const now = Date.now();
          const rtt = Math.max(0, now - msg.clientSendMs);
          const estimatedServerNow = msg.serverTimeMs + rtt / 2;
          serverOffsetMsRef.current = estimatedServerNow - now;
        } else if (msg.type === 'room:state') {
          setReceivers(msg.receivers);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer !== null) {
          clearInterval(pingTimer);
          pingTimer = null;
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
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, sendControl]);

  const stopPlaybackLoop = useCallback(() => {
    if (schedulerTimerRef.current !== null) {
      clearInterval(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    setSpectrumBands(new Array(32).fill(0));
    sendControl({
      type: 'host:settings',
      settings: { isPlaying: false },
    });
  }, [sendControl]);

  const scheduleFrameTick = useCallback(() => {
    const track = activeTrackRef.current;
    if (!track || !isPlayingRef.current) return;

    const { sampleRate, frameDurationMs, jitterBufferMs } = settingsRef.current;
    const ctx = audioCtxRef.current;
    const nowPerf = performance.now();

    let framesDispatched = 0;
    while (nowPerf + 45 >= nextTickPerfMsRef.current && framesDispatched < 6) {
      const frameSamples = Math.round((sampleRate * frameDurationMs) / 1000);
      const srcBuffer = track.buffer;
      const srcRate = srcBuffer.sampleRate;
      const srcCh0 = srcBuffer.getChannelData(0);
      const srcCh1 = srcBuffer.numberOfChannels > 1 ? srcBuffer.getChannelData(1) : srcCh0;

      const left = new Float32Array(frameSamples);
      const right = new Float32Array(frameSamples);

      const rateRatio = srcRate / sampleRate;
      let cursor = sampleCursorRef.current;

      for (let i = 0; i < frameSamples; i++) {
        const srcIdxFloat = cursor * rateRatio;
        const idx0 = Math.floor(srcIdxFloat);
        if (idx0 >= srcCh0.length) {
          if (loopTrackRef.current) {
            cursor = 0;
            sampleCursorRef.current = 0;
            left[i] = srcCh0[0] ?? 0;
            right[i] = srcCh1[0] ?? 0;
          } else {
            advanceTrackCallbackRef.current();
            return;
          }
        } else {
          const frac = srcIdxFloat - idx0;
          const idx1 = Math.min(srcCh0.length - 1, idx0 + 1);
          left[i] = srcCh0[idx0] * (1 - frac) + srcCh0[idx1] * frac;
          right[i] = srcCh1[idx0] * (1 - frac) + srcCh1[idx1] * frac;
        }
        cursor += 1;
      }

      sampleCursorRef.current = cursor;
      const posSec = Math.min(track.durationSec, cursor / sampleRate);
      setCurrentPositionSec(posSec);

      const aheadMs = Math.max(0, nextTickPerfMsRef.current - nowPerf);
      const playAtServerMs = Date.now() + serverOffsetMsRef.current + aheadMs + jitterBufferMs;

      const seq = seqRef.current++;
      const { buffer, preview } = encodePcmPacket({
        seq,
        playAtServerMs,
        sampleRate,
        left,
        right,
        channels: 2,
      });

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
      }

      if (ctx && monitorGainRef.current && localMonitorEnabledRef.current) {
        const audioBuf = ctx.createBuffer(2, frameSamples, sampleRate);
        audioBuf.copyToChannel(left, 0);
        audioBuf.copyToChannel(right, 1);
        const srcNode = ctx.createBufferSource();
        srcNode.buffer = audioBuf;
        srcNode.connect(monitorGainRef.current);
        const startAt = ctx.currentTime + (aheadMs + jitterBufferMs) / 1000;
        srcNode.start(Math.max(ctx.currentTime, startAt));
      }

      const bands = new Array(32).fill(0);
      const step = Math.max(1, Math.floor(frameSamples / 32));
      for (let b = 0; b < 32; b++) {
        let sum = 0;
        for (let k = 0; k < step; k++) {
          const idx = b * step + k;
          if (idx < frameSamples) {
            sum += Math.abs(left[idx]) + Math.abs(right[idx]);
          }
        }
        const avg = sum / (step * 2);
        bands[b] = Math.min(1, Math.pow(avg * 2.4, 0.72));
      }
      setSpectrumBands(bands);

      const nowMs = Date.now();
      totalPacketsRef.current += 1;
      totalBytesRef.current += preview.byteLength;
      bytesWindowRef.current.push({ ts: nowMs, bytes: preview.byteLength });
      while (bytesWindowRef.current.length > 0 && nowMs - bytesWindowRef.current[0].ts > 1000) {
        bytesWindowRef.current.shift();
      }
      const windowBytes = bytesWindowRef.current.reduce((acc, item) => acc + item.bytes, 0);
      const kbps = Math.round((windowBytes * 8) / 1000);

      setMetrics({
        packetsSent: totalPacketsRef.current,
        bytesSent: totalBytesRef.current,
        kbps,
      });

      nextTickPerfMsRef.current += frameDurationMs;
      framesDispatched += 1;
    }
  }, []);

  const startPlayback = useCallback(
    (fromPositionSec?: number) => {
      const track = activeTrackRef.current;
      if (!track) return;

      const { sampleRate } = settingsRef.current;
      ensureAudioContext(sampleRate);

      if (typeof fromPositionSec === 'number') {
        const clamped = Math.max(0, Math.min(track.durationSec, fromPositionSec));
        sampleCursorRef.current = Math.floor(clamped * sampleRate);
        setCurrentPositionSec(clamped);
      }

      isPlayingRef.current = true;
      setIsPlaying(true);
      nextTickPerfMsRef.current = performance.now();

      if (schedulerTimerRef.current !== null) {
        clearInterval(schedulerTimerRef.current);
      }
      schedulerTimerRef.current = window.setInterval(scheduleFrameTick, 8);

      sendControl({
        type: 'host:settings',
        settings: {
          isPlaying: true,
          trackTitle: track.title,
          trackCoverUrl: track.coverUrl,
          trackDurationSec: track.durationSec,
          trackPositionSec: sampleCursorRef.current / sampleRate,
        },
      });
    },
    [ensureAudioContext, scheduleFrameTick, sendControl]
  );

  const pausePlayback = useCallback(() => {
    stopPlaybackLoop();
  }, [stopPlaybackLoop]);

  const stopAndRewind = useCallback(() => {
    stopPlaybackLoop();
    sampleCursorRef.current = 0;
    setCurrentPositionSec(0);
    sendControl({
      type: 'host:settings',
      settings: { isPlaying: false, trackPositionSec: 0 },
    });
  }, [sendControl, stopPlaybackLoop]);

  const seekTo = useCallback(
    (sec: number) => {
      const track = activeTrackRef.current;
      if (!track) return;
      const clamped = Math.max(0, Math.min(track.durationSec, sec));
      sampleCursorRef.current = Math.floor(clamped * settingsRef.current.sampleRate);
      setCurrentPositionSec(clamped);
      sendControl({
        type: 'host:settings',
        settings: { trackPositionSec: clamped },
      });
    },
    [sendControl]
  );

  const selectTrack = useCallback(
    (trackId: string, autoPlay = false) => {
      const found = tracksRef.current.find((t) => t.id === trackId);
      if (!found) return;
      const wasPlaying = isPlayingRef.current;
      stopPlaybackLoop();
      activeTrackRef.current = found;
      setActiveTrackId(found.id);
      sampleCursorRef.current = 0;
      setCurrentPositionSec(0);
      setSettings((prev) => ({
        ...prev,
        trackTitle: found.title,
        trackCoverUrl: found.coverUrl,
        trackDurationSec: found.durationSec,
        trackPositionSec: 0,
      }));
      sendControl({
        type: 'host:settings',
        settings: {
          trackTitle: found.title,
          trackCoverUrl: found.coverUrl,
          trackDurationSec: found.durationSec,
          trackPositionSec: 0,
        },
      });
      if (autoPlay || wasPlaying) {
        startPlayback(0);
      }
    },
    [sendControl, startPlayback, stopPlaybackLoop]
  );

  const nextTrack = useCallback(() => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    if (shuffleRef.current && list.length > 1) {
      const candidates = list.filter((t) => t.id !== activeTrackRef.current?.id);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      selectTrack(pick.id, true);
      return;
    }
    const idx = list.findIndex((t) => t.id === activeTrackRef.current?.id);
    const nextIdx = (idx + 1) % list.length;
    selectTrack(list[nextIdx].id, true);
  }, [selectTrack]);

  const previousTrack = useCallback(() => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    if (sampleCursorRef.current / settingsRef.current.sampleRate > 3) {
      seekTo(0);
      return;
    }
    const idx = list.findIndex((t) => t.id === activeTrackRef.current?.id);
    const prevIdx = (idx - 1 + list.length) % list.length;
    selectTrack(list[prevIdx].id, true);
  }, [seekTo, selectTrack]);

  useEffect(() => {
    advanceTrackCallbackRef.current = () => {
      nextTrack();
    };
  }, [nextTrack]);

  const loadLocalAudioFiles = useCallback(
    async (files: FileList | File[]) => {
      const candidates = Array.from(files).filter((file) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext);
      });
      if (candidates.length === 0) return;

      setIsScanning(true);
      setDecodeError(null);
      setScanProgress({ scanned: 0, total: candidates.length });

      try {
        const ctx = ensureAudioContext(settingsRef.current.sampleRate);
        const decodedList: DecodedTrack[] = [];

        for (let i = 0; i < candidates.length; i++) {
          const file = candidates[i];
          setScanProgress({ scanned: i + 1, total: candidates.length });
          try {
            const arrayBuffer = await file.arrayBuffer();
            const coverUrl = extractCoverArtFromBuffer(arrayBuffer, file.name);
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            const cleanName = file.name.replace(/\.[^/.]+$/, '');
            const formatCategory = classifyAudioFormat(file.name);
            const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            const newTrack: DecodedTrack = {
              id,
              title: cleanName,
              artistOrSource: `${(file.size / (1024 * 1024)).toFixed(1)} MB · Đã lưu trình duyệt`,
              formatLabel: `${formatCategory} · ${(audioBuffer.sampleRate / 1000).toFixed(1)} kHz · ${
                audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'
              }`,
              formatCategory,
              coverUrl,
              durationSec: audioBuffer.duration,
              sampleRate: audioBuffer.sampleRate,
              channels: audioBuffer.numberOfChannels,
              buffer: audioBuffer,
              peaks: extractWaveformPeaks(audioBuffer),
              isBuiltIn: false,
              fileSizeBytes: file.size,
            };

            decodedList.push(newTrack);
            await saveAudioFileRecord({
              id,
              fileName: file.name,
              title: cleanName,
              formatCategory,
              coverUrl,
              fileSizeBytes: file.size,
              blob: file,
              addedAt: Date.now(),
            });
          } catch {
            // Continue scanning remaining files if one file is unsupported
          }
        }

        if (decodedList.length > 0) {
          setTracks((prev) => {
            const next = [...decodedList, ...prev];
            tracksRef.current = next;
            return next;
          });
          const first = decodedList[0];
          activeTrackRef.current = first;
          setActiveTrackId(first.id);
          sampleCursorRef.current = 0;
          setCurrentPositionSec(0);
          setSettings((prev) => ({
            ...prev,
            trackTitle: first.title,
            trackCoverUrl: first.coverUrl,
            trackDurationSec: first.durationSec,
          }));
          sendControl({
            type: 'host:settings',
            settings: {
              trackTitle: first.title,
              trackCoverUrl: first.coverUrl,
              trackDurationSec: first.durationSec,
              trackPositionSec: 0,
            },
          });
        } else {
          setDecodeError('Không tìm thấy tệp âm thanh hợp lệ để giải mã.');
        }
      } catch (err) {
        setDecodeError(
          err instanceof Error
            ? `Lỗi khi quét nhạc: ${err.message}`
            : 'Không thể giải mã tệp âm thanh đã chọn.'
        );
      } finally {
        setIsScanning(false);
        setScanProgress(null);
      }
    },
    [ensureAudioContext, sendControl]
  );

  /**
   * Fast recursive folder scanner using File System Access API when supported,
   * returning false if caller should fall back to webkitdirectory input.
   */
  const scanDirectoryFast = useCallback(async (): Promise<boolean> => {
    const win = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker !== 'function') {
      return false;
    }

    try {
      const dirHandle = await win.showDirectoryPicker();
      setIsScanning(true);
      const foundFiles: File[] = [];

      const walk = async (handle: FileSystemDirectoryHandle, depth = 0) => {
        if (depth > 4) return;
        const iter = (handle as FileSystemDirectoryHandle & {
          values: () => AsyncIterable<FileSystemHandle>;
        }).values();
        for await (const entry of iter) {
          if (entry.kind === 'file') {
            const fileHandle = entry as FileSystemFileHandle;
            const ext = entry.name.split('.').pop()?.toLowerCase() || '';
            if (AUDIO_EXTENSIONS.has(ext)) {
              const file = await fileHandle.getFile();
              foundFiles.push(file);
            }
          } else if (entry.kind === 'directory') {
            await walk(entry as FileSystemDirectoryHandle, depth + 1);
          }
        }
      };

      await walk(dirHandle);
      if (foundFiles.length > 0) {
        await loadLocalAudioFiles(foundFiles);
      } else {
        setIsScanning(false);
        setDecodeError('Thư mục đã chọn không chứa tệp MP3, FLAC, WAV, M4A hoặc OGG.');
      }
      return true;
    } catch (err) {
      setIsScanning(false);
      // User cancelled picker
      if (err instanceof Error && err.name === 'AbortError') {
        return true;
      }
      return false;
    }
  }, [loadLocalAudioFiles]);

  const removeTrack = useCallback(
    async (trackId: string) => {
      const target = tracksRef.current.find((t) => t.id === trackId);
      if (!target || target.isBuiltIn) return;
      await deleteStoredAudioFile(trackId);
      setTracks((prev) => {
        const next = prev.filter((t) => t.id !== trackId);
        tracksRef.current = next;
        if (activeTrackRef.current?.id === trackId && next.length > 0) {
          activeTrackRef.current = next[0];
          setActiveTrackId(next[0].id);
        }
        return next;
      });
    },
    []
  );

  const saveCurrentPlaylist = useCallback((playlistName: string) => {
    const trimmed = playlistName.trim();
    if (!trimmed) return;
    const current = tracksRef.current;
    const newPlaylist: SavedPlaylist = {
      id: `pl-${Date.now()}`,
      name: trimmed,
      createdAt: Date.now(),
      trackIds: current.map((t) => t.id),
      trackTitles: current.map((t) => t.title),
    };
    setSavedPlaylists((prev) => {
      const next = [newPlaylist, ...prev];
      persistSavedPlaylists(next);
      return next;
    });
  }, []);

  const loadPlaylist = useCallback(
    (playlistId: string) => {
      const found = savedPlaylists.find((p) => p.id === playlistId);
      if (!found) return;
      const matching = tracksRef.current.filter((t) => found.trackIds.includes(t.id));
      if (matching.length > 0) {
        selectTrack(matching[0].id, true);
      }
    },
    [savedPlaylists, selectTrack]
  );

  const deletePlaylist = useCallback((playlistId: string) => {
    setSavedPlaylists((prev) => {
      const next = prev.filter((p) => p.id !== playlistId);
      persistSavedPlaylists(next);
      return next;
    });
  }, []);

  const updateStreamSettings = useCallback(
    (patch: Partial<Pick<RoomSettings, 'sampleRate' | 'frameDurationMs' | 'jitterBufferMs'>>) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      settingsRef.current = next;
      if (patch.sampleRate && isPlayingRef.current) {
        ensureAudioContext(patch.sampleRate);
      }
      sendControl({ type: 'host:settings', settings: patch });
    },
    [ensureAudioContext, sendControl]
  );

  const updateDevice = useCallback(
    (
      receiverId: string,
      patch: Partial<
        Pick<ReceiverDevice, 'name' | 'speakerLabel' | 'volume' | 'muted' | 'delayOffsetMs' | 'channelMode'>
      >
    ) => {
      sendControl({ type: 'host:update-device', receiverId, patch });
    },
    [sendControl]
  );

  const sendTestTone = useCallback(
    (receiverId: string) => {
      sendControl({ type: 'host:test-tone', receiverId });
    },
    [sendControl]
  );

  const kickDevice = useCallback(
    (receiverId: string) => {
      sendControl({ type: 'host:kick-device', receiverId });
    },
    [sendControl]
  );

  useEffect(() => {
    return () => {
      if (schedulerTimerRef.current !== null) {
        clearInterval(schedulerTimerRef.current);
      }
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const activeTrack = tracks.find((t) => t.id === activeTrackId) || null;

  return {
    wsConnected,
    receivers,
    settings,
    tracks,
    activeTrack,
    savedPlaylists,
    isScanning,
    scanProgress,
    decodeError,
    isPlaying,
    loopTrack,
    setLoopTrack,
    shuffle,
    setShuffle,
    currentPositionSec,
    localMonitorEnabled,
    setLocalMonitorEnabled,
    localMonitorVolume,
    setLocalMonitorVolume,
    spectrumBands,
    metrics,
    startPlayback,
    pausePlayback,
    stopAndRewind,
    seekTo,
    nextTrack,
    previousTrack,
    selectTrack,
    removeTrack,
    loadLocalAudioFiles,
    scanDirectoryFast,
    saveCurrentPlaylist,
    loadPlaylist,
    deletePlaylist,
    updateStreamSettings,
    updateDevice,
    sendTestTone,
    kickDevice,
  };
}
