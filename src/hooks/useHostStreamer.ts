import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioFormatCategory,
  ClientMessage,
  DecodedTrack,
  FrameDurationMs,
  ReceiverDevice,
  RoomSettings,
  SampleRateOption,
  SavedPlaylist,
  ServerMessage,
} from '../types/audio';
import {
  classifyAudioFormat,
  extractCoverArtFromBuffer,
  getFallbackCoverForName,
} from '../utils/coverExtractor';
import { encodePcmPacket, extractWaveformPeaks } from '../utils/pcmPacketizer';
import {
  deleteStoredAudioFile,
  loadAllStoredAudioFiles,
  loadSavedPlaylists,
  persistSavedPlaylists,
  saveAudioFileRecordsBatch,
  type StoredAudioFileRecord,
} from '../utils/playlistStorage';
import { buildBuiltInTracks } from '../utils/synthTracks';
import { getWebSocketUrl, type AndroidScannedSong } from '../utils/wsEndpoint';

interface HostMetrics {
  packetsSent: number;
  bytesSent: number;
  kbps: number;
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'opus', 'webm']);

function cubicHermite(y0: number, y1: number, y2: number, y3: number, mu: number): number {
  const mu2 = mu * mu;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  const a3 = y1;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + a3;
}

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
  const [isDecodingTrack, setIsDecodingTrack] = useState(false);
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
  const monitorSourceRef = useRef<AudioBufferSourceNode | null>(null);

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
  const tickerWorkerRef = useRef<Worker | null>(null);
  const tickerWorkerUrlRef = useRef<string | null>(null);
  const lastUiSyncPerfRef = useRef(0);
  const bytesWindowRef = useRef<{ ts: number; bytes: number }[]>([]);
  const totalPacketsRef = useRef(0);
  const totalBytesRef = useRef(0);
  const advanceTrackCallbackRef = useRef<() => void>(() => {});
  const decodeInFlightRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());

  const updateBackgroundState = useCallback(
    (playing: boolean, track: DecodedTrack | null) => {
      const title = track ? track.title : 'MusicToBlutooth Truyền';
      const subtitle = playing
        ? `Đang phát qua Wi-Fi · Phòng ${roomId}`
        : 'Đang tạm dừng phát nhạc';

      window.__MTB_ANDROID__?.setBackgroundPlayback?.(true, title, subtitle);

      if ('mediaSession' in navigator) {
        try {
          if (track) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: track.title,
              artist: track.folderName || 'MusicToBlutooth',
              album: `Phòng ${roomId} · ${track.formatCategory}`,
            });
          }
          navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
        } catch {
          // ignore MediaSession errors on older browsers
        }
      }
    },
    [roomId]
  );

  const stopBgTicker = useCallback(() => {
    if (schedulerTimerRef.current !== null) {
      clearInterval(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    if (tickerWorkerRef.current) {
      tickerWorkerRef.current.postMessage('stop');
    }
  }, []);

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

  const stopMonitorSource = useCallback(() => {
    if (monitorSourceRef.current) {
      try {
        monitorSourceRef.current.stop();
        monitorSourceRef.current.disconnect();
      } catch {
        // ignore if already stopped
      }
      monitorSourceRef.current = null;
    }
  }, []);

  const ensureAudioContext = useCallback((sampleRate: SampleRateOption) => {
    if (!audioCtxRef.current || audioCtxRef.current.sampleRate !== sampleRate) {
      stopMonitorSource();
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
  }, [stopMonitorSource]);

  const startContinuousMonitor = useCallback(
    (buffer: AudioBuffer, offsetSec: number, jitterMs: number) => {
      stopMonitorSource();
      if (!localMonitorEnabledRef.current) return;
      const ctx = ensureAudioContext(settingsRef.current.sampleRate);
      const gain = monitorGainRef.current;
      if (!ctx || !gain) return;

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = loopTrackRef.current;
      src.connect(gain);

      const safeOffset = Math.max(0, Math.min(Math.max(0, buffer.duration - 0.05), offsetSec));
      const startAt = ctx.currentTime + jitterMs / 1000;
      src.start(startAt, safeOffset);
      monitorSourceRef.current = src;
    },
    [ensureAudioContext, stopMonitorSource]
  );

  useEffect(() => {
    localMonitorEnabledRef.current = localMonitorEnabled;
    localMonitorVolumeRef.current = localMonitorVolume;
    if (monitorGainRef.current && audioCtxRef.current) {
      const target = localMonitorEnabled ? localMonitorVolume : 0;
      monitorGainRef.current.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.02);
    }
    if (localMonitorEnabled && isPlayingRef.current && activeTrackRef.current?.buffer && !monitorSourceRef.current) {
      const posSec = sampleCursorRef.current / settingsRef.current.sampleRate;
      startContinuousMonitor(activeTrackRef.current.buffer, posSec, settingsRef.current.jitterBufferMs);
    } else if (!localMonitorEnabled && monitorSourceRef.current) {
      stopMonitorSource();
    }
  }, [localMonitorEnabled, localMonitorVolume, startContinuousMonitor, stopMonitorSource]);

  const sendControl = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  /**
   * Lazily decodes a scanned track's raw audio bytes into an AudioBuffer only when needed,
   * avoiding UI stalls and memory bloat when scanning hundreds of files.
   */
  const ensureTrackDecoded = useCallback(
    async (track: DecodedTrack): Promise<AudioBuffer | null> => {
      if (track.buffer) return track.buffer;

      const existing = decodeInFlightRef.current.get(track.id);
      if (existing) return existing;

      const promise = (async (): Promise<AudioBuffer | null> => {
        try {
          let arrayBuf: ArrayBuffer | null = null;
          if (track.rawBlob) {
            arrayBuf = await track.rawBlob.arrayBuffer();
          } else if (track.localMediaUrl) {
            const res = await fetch(track.localMediaUrl);
            if (res.ok) {
              arrayBuf = await res.arrayBuffer();
            }
          }
          if (!arrayBuf) return null;

          const ctx = ensureAudioContext(settingsRef.current.sampleRate);
          const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
          const peaks = extractWaveformPeaks(decoded);

          // Update track in state & ref
          const updated: DecodedTrack = {
            ...track,
            buffer: decoded,
            durationSec: decoded.duration,
            sampleRate: decoded.sampleRate,
            channels: decoded.numberOfChannels,
            peaks,
            formatLabel: `${track.formatCategory} · ${(decoded.sampleRate / 1000).toFixed(1)} kHz · ${
              decoded.numberOfChannels === 1 ? 'Mono' : 'Stereo'
            }`,
          };

          tracksRef.current = tracksRef.current.map((t) => (t.id === track.id ? updated : t));
          setTracks(tracksRef.current);
          if (activeTrackRef.current?.id === track.id) {
            activeTrackRef.current = updated;
          }
          return decoded;
        } catch (err) {
          setDecodeError(
            err instanceof Error
              ? `Không thể giải mã "${track.title}": ${err.message}`
              : `Định dạng tệp "${track.title}" không được hỗ trợ.`
          );
          return null;
        } finally {
          decodeInFlightRef.current.delete(track.id);
        }
      })();

      decodeInFlightRef.current.set(track.id, promise);
      return promise;
    },
    [ensureAudioContext]
  );

  // Initialize built-in tracks + restore scanned tracks instantaneously from IndexedDB
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const builtIns = buildBuiltInTracks(48000);
      const storedRecords = await loadAllStoredAudioFiles();
      const restored: DecodedTrack[] = storedRecords.map((rec) => ({
        id: rec.id,
        title: rec.title,
        artistOrSource: `${(rec.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB · Đã lưu`,
        folderName: rec.folderName || 'Nhạc đã lưu',
        formatLabel: `${rec.formatCategory} · Sẵn sàng phát`,
        formatCategory: rec.formatCategory,
        coverUrl: rec.coverUrl,
        durationSec: rec.durationSec || 0,
        sampleRate: 48000,
        channels: 2,
        buffer: null,
        peaks: [],
        isBuiltIn: false,
        fileSizeBytes: rec.fileSizeBytes,
        rawBlob: rec.blob,
        localMediaUrl: rec.localMediaUrl,
      }));

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
      const ws = new WebSocket(getWebSocketUrl());
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
    stopBgTicker();
    stopMonitorSource();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setSpectrumBands(new Array(32).fill(0));
    updateBackgroundState(false, activeTrackRef.current);
    sendControl({
      type: 'host:settings',
      settings: { isPlaying: false },
    });
  }, [sendControl, stopBgTicker, stopMonitorSource, updateBackgroundState]);

  const scheduleFrameTick = useCallback(() => {
    const track = activeTrackRef.current;
    const srcBuffer = track?.buffer;
    if (!track || !srcBuffer || !isPlayingRef.current) return;

    const { sampleRate, frameDurationMs, jitterBufferMs } = settingsRef.current;
    const nowPerf = performance.now();

    let framesDispatched = 0;
    let latestBands: number[] | null = null;
    let latestPosSec = 0;

    while (nowPerf + 45 >= nextTickPerfMsRef.current && framesDispatched < 4) {
      const frameSamples = Math.round((sampleRate * frameDurationMs) / 1000);
      const srcRate = srcBuffer.sampleRate;
      const srcCh0 = srcBuffer.getChannelData(0);
      const srcCh1 = srcBuffer.numberOfChannels > 1 ? srcBuffer.getChannelData(1) : srcCh0;
      const srcLen = srcCh0.length;

      const left = new Float32Array(frameSamples);
      const right = new Float32Array(frameSamples);

      const rateRatio = srcRate / sampleRate;
      const isSameRate = Math.abs(rateRatio - 1) < 1e-6;
      let cursor = sampleCursorRef.current;

      for (let i = 0; i < frameSamples; i++) {
        if (isSameRate) {
          if (cursor >= srcLen) {
            if (loopTrackRef.current) {
              cursor = 0;
            } else {
              advanceTrackCallbackRef.current();
              return;
            }
          }
          left[i] = srcCh0[cursor];
          right[i] = srcCh1[cursor];
        } else {
          const srcIdxFloat = cursor * rateRatio;
          const idx1 = Math.floor(srcIdxFloat);
          if (idx1 >= srcLen) {
            if (loopTrackRef.current) {
              cursor = 0;
              left[i] = srcCh0[0] ?? 0;
              right[i] = srcCh1[0] ?? 0;
            } else {
              advanceTrackCallbackRef.current();
              return;
            }
          } else {
            const mu = srcIdxFloat - idx1;
            const idx0 = Math.max(0, idx1 - 1);
            const idx2 = Math.min(srcLen - 1, idx1 + 1);
            const idx3 = Math.min(srcLen - 1, idx1 + 2);
            left[i] = cubicHermite(srcCh0[idx0], srcCh0[idx1], srcCh0[idx2], srcCh0[idx3], mu);
            right[i] = cubicHermite(srcCh1[idx0], srcCh1[idx1], srcCh1[idx2], srcCh1[idx3], mu);
          }
        }
        cursor += 1;
      }

      sampleCursorRef.current = cursor;
      latestPosSec = Math.min(track.durationSec || srcBuffer.duration, cursor / sampleRate);

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

      const nowMs = Date.now();
      totalPacketsRef.current += 1;
      totalBytesRef.current += preview.byteLength;
      bytesWindowRef.current.push({ ts: nowMs, bytes: preview.byteLength });
      while (bytesWindowRef.current.length > 0 && nowMs - bytesWindowRef.current[0].ts > 1000) {
        bytesWindowRef.current.shift();
      }

      if (nowPerf - lastUiSyncPerfRef.current >= 75) {
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
        latestBands = bands;
      }

      nextTickPerfMsRef.current += frameDurationMs;
      framesDispatched += 1;
    }

    // Throttle React UI updates (~13 Hz) to prevent main-thread audio jitter
    if (framesDispatched > 0 && nowPerf - lastUiSyncPerfRef.current >= 75) {
      lastUiSyncPerfRef.current = nowPerf;
      setCurrentPositionSec(latestPosSec);
      if (latestBands) setSpectrumBands(latestBands);
      const windowBytes = bytesWindowRef.current.reduce((acc, item) => acc + item.bytes, 0);
      setMetrics({
        packetsSent: totalPacketsRef.current,
        bytesSent: totalBytesRef.current,
        kbps: Math.round((windowBytes * 8) / 1000),
      });
    }
  }, []);

  const startPlayback = useCallback(
    async (fromPositionSec?: number) => {
      const track = activeTrackRef.current;
      if (!track) return;

      const { sampleRate, jitterBufferMs } = settingsRef.current;
      ensureAudioContext(sampleRate);

      let buffer = track.buffer;
      if (!buffer) {
        setIsDecodingTrack(true);
        buffer = await ensureTrackDecoded(track);
        setIsDecodingTrack(false);
        if (!buffer) return;
      }

      const targetPosSec =
        typeof fromPositionSec === 'number'
          ? Math.max(0, Math.min(buffer.duration, fromPositionSec))
          : Math.max(0, Math.min(buffer.duration, sampleCursorRef.current / sampleRate));

      sampleCursorRef.current = Math.floor(targetPosSec * sampleRate);
      setCurrentPositionSec(targetPosSec);

      // Clean, zero-noise continuous Web Audio monitor playback
      startContinuousMonitor(buffer, targetPosSec, jitterBufferMs);

      isPlayingRef.current = true;
      setIsPlaying(true);
      nextTickPerfMsRef.current = performance.now();
      updateBackgroundState(true, track);

      stopBgTicker();
      try {
        if (!tickerWorkerRef.current) {
          const workerCode = `
            let id = null;
            self.onmessage = function(e) {
              if (e.data === 'start') {
                if (id !== null) clearInterval(id);
                id = setInterval(function() { self.postMessage('t'); }, 10);
              } else if (e.data === 'stop') {
                if (id !== null) clearInterval(id);
                id = null;
              }
            };
          `;
          const url = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
          tickerWorkerUrlRef.current = url;
          tickerWorkerRef.current = new Worker(url);
        }
        tickerWorkerRef.current.onmessage = () => scheduleFrameTick();
        tickerWorkerRef.current.postMessage('start');
      } catch {
        schedulerTimerRef.current = window.setInterval(scheduleFrameTick, 10);
      }

      sendControl({
        type: 'host:settings',
        settings: {
          isPlaying: true,
          trackTitle: track.title,
          trackCoverUrl: track.coverUrl,
          trackDurationSec: buffer.duration,
          trackPositionSec: targetPosSec,
        },
      });

      // Pre-decode next track smoothly in background
      const list = tracksRef.current;
      const curIdx = list.findIndex((t) => t.id === track.id);
      if (curIdx >= 0 && list.length > 1) {
        const nextItem = list[(curIdx + 1) % list.length];
        if (nextItem && !nextItem.buffer) {
          ensureTrackDecoded(nextItem).catch(() => {});
        }
      }
    },
    [
      ensureAudioContext,
      ensureTrackDecoded,
      scheduleFrameTick,
      sendControl,
      startContinuousMonitor,
      stopBgTicker,
      updateBackgroundState,
    ]
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
      const duration = track.buffer?.duration || track.durationSec || 0;
      const clamped = Math.max(0, Math.min(duration, sec));
      sampleCursorRef.current = Math.floor(clamped * settingsRef.current.sampleRate);
      setCurrentPositionSec(clamped);
      if (isPlayingRef.current && track.buffer) {
        startContinuousMonitor(track.buffer, clamped, settingsRef.current.jitterBufferMs);
      }
      sendControl({
        type: 'host:settings',
        settings: { trackPositionSec: clamped },
      });
    },
    [sendControl, startContinuousMonitor]
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
      } else if (!found.buffer) {
        ensureTrackDecoded(found).catch(() => {});
      }
    },
    [ensureTrackDecoded, sendControl, startPlayback, stopPlaybackLoop]
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

  /**
   * Instant metadata-first file/folder ingestion: reads only 128KB header per file for cover art,
   * classifies format + folderName, saves to IndexedDB in batch, and decodes AudioBuffer lazily on play.
   */
  const loadLocalAudioFiles = useCallback(
    async (files: FileList | File[], explicitFolderName?: string) => {
      const candidates = Array.from(files).filter((file) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext);
      });
      if (candidates.length === 0) {
        setDecodeError('Không tìm thấy tệp âm thanh (MP3, FLAC, WAV, M4A, OGG) trong lựa chọn.');
        return;
      }

      setIsScanning(true);
      setDecodeError(null);
      setScanProgress({ scanned: 0, total: candidates.length });

      try {
        const scannedTracks: DecodedTrack[] = [];
        const dbBatch: StoredAudioFileRecord[] = [];

        for (let i = 0; i < candidates.length; i++) {
          const file = candidates[i];
          if (i % 10 === 0 || i === candidates.length - 1) {
            setScanProgress({ scanned: i + 1, total: candidates.length });
          }

          const headSlice = await file.slice(0, 131072).arrayBuffer();
          const coverUrl = extractCoverArtFromBuffer(headSlice, file.name);
          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          const formatCategory = classifyAudioFormat(file.name);
          const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
          let folderName = explicitFolderName || 'Nhạc đã chọn';
          if (relPath.includes('/')) {
            const parts = relPath.split('/').filter(Boolean);
            folderName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
          }

          const id = `file-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
          const item: DecodedTrack = {
            id,
            title: cleanName,
            artistOrSource: `${(file.size / (1024 * 1024)).toFixed(1)} MB · ${folderName}`,
            folderName,
            formatLabel: `${formatCategory} · Sẵn sàng phát`,
            formatCategory,
            coverUrl,
            durationSec: 0,
            sampleRate: 48000,
            channels: 2,
            buffer: null,
            peaks: [],
            isBuiltIn: false,
            fileSizeBytes: file.size,
            rawBlob: file,
          };

          scannedTracks.push(item);
          dbBatch.push({
            id,
            fileName: file.name,
            title: cleanName,
            folderName,
            formatCategory,
            coverUrl,
            durationSec: 0,
            fileSizeBytes: file.size,
            blob: file,
            addedAt: Date.now() + i,
          });
        }

        await saveAudioFileRecordsBatch(dbBatch);

        if (scannedTracks.length > 0) {
          setTracks((prev) => {
            const next = [...scannedTracks, ...prev];
            tracksRef.current = next;
            return next;
          });
          const first = scannedTracks[0];
          activeTrackRef.current = first;
          setActiveTrackId(first.id);
          sampleCursorRef.current = 0;
          setCurrentPositionSec(0);
          ensureTrackDecoded(first).catch(() => {});
        }
      } catch (err) {
        setDecodeError(
          err instanceof Error ? `Lỗi khi quét nhạc: ${err.message}` : 'Không thể quét tệp âm thanh.'
        );
      } finally {
        setIsScanning(false);
        setScanProgress(null);
      }
    },
    [ensureTrackDecoded]
  );

  const importAndroidMediaStore = useCallback(async (): Promise<boolean> => {
    const bridge = window.__MTB_ANDROID__;
    if (!bridge?.scanDeviceMusic) return false;

    setIsScanning(true);
    setDecodeError(null);
    try {
      const raw = bridge.scanDeviceMusic();
      const parsed = JSON.parse(raw) as {
        needsPermission: boolean;
        tracks: AndroidScannedSong[];
      };

      if (parsed.needsPermission) {
        setDecodeError('Vui lòng bấm Cho phép quyền truy cập Âm thanh trên điện thoại để quét thư mục nhạc.');
        setIsScanning(false);
        return true;
      }

      if (!parsed.tracks || parsed.tracks.length === 0) {
        setDecodeError('Không tìm thấy tệp nhạc (MP3, FLAC, WAV, M4A, OGG) trên bộ nhớ máy.');
        setIsScanning(false);
        return true;
      }

      const mapped: DecodedTrack[] = parsed.tracks.map((s) => {
        const cat = (s.formatCategory || 'KHÁC') as AudioFormatCategory;
        const cover = s.coverUrl && s.coverUrl.length > 10 ? s.coverUrl : getFallbackCoverForName(s.title);
        return {
          id: s.id,
          title: s.title,
          artistOrSource: `${s.artist} · ${(s.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`,
          folderName: s.folderName || 'Nhạc trên máy',
          formatLabel: `${cat} · Trên máy`,
          formatCategory: cat,
          coverUrl: cover,
          durationSec: s.durationSec,
          sampleRate: 48000,
          channels: 2,
          buffer: null,
          peaks: [],
          isBuiltIn: false,
          fileSizeBytes: s.fileSizeBytes,
          localMediaUrl: s.localMediaUrl,
        };
      });

      const dbBatch: StoredAudioFileRecord[] = mapped.map((t, idx) => ({
        id: t.id,
        fileName: `${t.title}.${t.formatCategory.toLowerCase()}`,
        title: t.title,
        folderName: t.folderName,
        formatCategory: t.formatCategory,
        coverUrl: t.coverUrl,
        durationSec: t.durationSec,
        fileSizeBytes: t.fileSizeBytes || 0,
        localMediaUrl: t.localMediaUrl,
        addedAt: Date.now() + idx,
      }));
      await saveAudioFileRecordsBatch(dbBatch);

      setTracks((prev) => {
        const existingIds = new Set(mapped.map((m) => m.id));
        const kept = prev.filter((p) => !existingIds.has(p.id));
        const next = [...mapped, ...kept];
        tracksRef.current = next;
        return next;
      });

      const first = mapped[0];
      activeTrackRef.current = first;
      setActiveTrackId(first.id);
      ensureTrackDecoded(first).catch(() => {});
      return true;
    } catch {
      return false;
    } finally {
      setIsScanning(false);
    }
  }, [ensureTrackDecoded]);

  // Auto-run Android MediaStore scan right after runtime permission is granted
  useEffect(() => {
    const onPermGranted = () => {
      importAndroidMediaStore();
    };
    window.addEventListener('mtb-media-permission-granted', onPermGranted);
    return () => window.removeEventListener('mtb-media-permission-granted', onPermGranted);
  }, [importAndroidMediaStore]);

  const scanDirectoryFast = useCallback(async (): Promise<boolean> => {
    // 1. Native Android MediaStore scan if inside Transmitter APK
    if (window.__MTB_ANDROID__?.scanDeviceMusic) {
      return await importAndroidMediaStore();
    }

    // 2. Desktop Chrome/Edge File System Access API
    const win = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker !== 'function') {
      return false;
    }

    try {
      const dirHandle = await win.showDirectoryPicker();
      setIsScanning(true);
      const foundFiles: { file: File; folder: string }[] = [];

      const walk = async (handle: FileSystemDirectoryHandle, folderLabel: string, depth = 0) => {
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
              foundFiles.push({ file, folder: folderLabel });
            }
          } else if (entry.kind === 'directory') {
            await walk(entry as FileSystemDirectoryHandle, entry.name, depth + 1);
          }
        }
      };

      await walk(dirHandle, dirHandle.name || 'Thư mục nhạc');
      if (foundFiles.length > 0) {
        // Preserve folder assignment cleanly
        setDecodeError(null);
        setScanProgress({ scanned: 0, total: foundFiles.length });
        const scannedTracks: DecodedTrack[] = [];
        const dbBatch: StoredAudioFileRecord[] = [];

        for (let i = 0; i < foundFiles.length; i++) {
          const { file, folder } = foundFiles[i];
          if (i % 10 === 0 || i === foundFiles.length - 1) {
            setScanProgress({ scanned: i + 1, total: foundFiles.length });
          }
          const headSlice = await file.slice(0, 131072).arrayBuffer();
          const coverUrl = extractCoverArtFromBuffer(headSlice, file.name);
          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          const formatCategory = classifyAudioFormat(file.name);
          const id = `file-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;

          scannedTracks.push({
            id,
            title: cleanName,
            artistOrSource: `${(file.size / (1024 * 1024)).toFixed(1)} MB · ${folder}`,
            folderName: folder,
            formatLabel: `${formatCategory} · Sẵn sàng phát`,
            formatCategory,
            coverUrl,
            durationSec: 0,
            sampleRate: 48000,
            channels: 2,
            buffer: null,
            peaks: [],
            isBuiltIn: false,
            fileSizeBytes: file.size,
            rawBlob: file,
          });
          dbBatch.push({
            id,
            fileName: file.name,
            title: cleanName,
            folderName: folder,
            formatCategory,
            coverUrl,
            durationSec: 0,
            fileSizeBytes: file.size,
            blob: file,
            addedAt: Date.now() + i,
          });
        }

        await saveAudioFileRecordsBatch(dbBatch);
        setTracks((prev) => {
          const next = [...scannedTracks, ...prev];
          tracksRef.current = next;
          return next;
        });
        const first = scannedTracks[0];
        activeTrackRef.current = first;
        setActiveTrackId(first.id);
        ensureTrackDecoded(first).catch(() => {});
      } else {
        setDecodeError('Thư mục đã chọn không chứa tệp MP3, FLAC, WAV, M4A hoặc OGG.');
      }
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return true;
      }
      return false;
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }
  }, [ensureTrackDecoded, importAndroidMediaStore]);

  const removeTrack = useCallback(async (trackId: string) => {
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
  }, []);

  const saveCurrentPlaylist = useCallback((playlistName: string, folderName?: string) => {
    const trimmed = playlistName.trim();
    if (!trimmed) return;
    const sourceTracks = folderName
      ? tracksRef.current.filter((t) => t.folderName === folderName)
      : tracksRef.current;
    if (sourceTracks.length === 0) return;

    const newPlaylist: SavedPlaylist = {
      id: `pl-${Date.now()}`,
      name: trimmed,
      createdAt: Date.now(),
      folderName,
      trackIds: sourceTracks.map((t) => t.id),
      trackTitles: sourceTracks.map((t) => t.title),
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
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => startPlayback());
        navigator.mediaSession.setActionHandler('pause', () => pausePlayback());
        navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
        navigator.mediaSession.setActionHandler('previoustrack', () => previousTrack());
      } catch {
        // ignore unsupported MediaSession action
      }
    }
  }, [nextTrack, pausePlayback, previousTrack, startPlayback]);

  useEffect(() => {
    const onVisibility = () => {
      if (isPlayingRef.current && audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    return () => {
      stopBgTicker();
      if (tickerWorkerRef.current) {
        tickerWorkerRef.current.terminate();
        tickerWorkerRef.current = null;
      }
      if (tickerWorkerUrlRef.current) {
        URL.revokeObjectURL(tickerWorkerUrlRef.current);
        tickerWorkerUrlRef.current = null;
      }
      stopMonitorSource();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopBgTicker, stopMonitorSource]);

  const activeTrack = tracks.find((t) => t.id === activeTrackId) || null;

  return {
    wsConnected,
    receivers,
    settings,
    tracks,
    activeTrack,
    savedPlaylists,
    isScanning,
    isDecodingTrack,
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
