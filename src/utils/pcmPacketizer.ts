import type { PacketPreview } from '../types/audio';

export const PCM_HEADER_BYTES = 24;
export const PCM_MAGIC_0 = 0x4d; // 'M'
export const PCM_MAGIC_1 = 0x42; // 'B'
export const PCM_PROTOCOL_VERSION = 1;

export interface ParsedPcmPacket {
  seq: number;
  playAtServerMs: number;
  sampleRate: number;
  channels: number;
  frameSamples: number;
  isTestTone: boolean;
  targetReceiverIndex: number;
  checksumValid: boolean;
  left: Float32Array;
  right: Float32Array;
  rmsDb: number;
}

/**
 * Encodes stereo/mono Float32 PCM slices into a compact 24-byte header + Int16LE binary frame.
 * Also supports an optional targetReceiverHash byte for targeted speaker test chimes,
 * or 0 for broadcast to all receivers in the Wi-Fi room.
 */
export function encodePcmPacket(params: {
  seq: number;
  playAtServerMs: number;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  channels: 1 | 2;
  isTestTone?: boolean;
}): { buffer: ArrayBuffer; preview: PacketPreview } {
  const { seq, playAtServerMs, sampleRate, left, right, channels, isTestTone = false } = params;
  const frameSamples = left.length;
  const payloadBytes = frameSamples * channels * 2;
  const totalBytes = PCM_HEADER_BYTES + payloadBytes;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header bytes 0..3
  view.setUint8(0, PCM_MAGIC_0);
  view.setUint8(1, PCM_MAGIC_1);
  view.setUint8(2, PCM_PROTOCOL_VERSION);
  const flags = (channels === 2 ? 0x01 : 0x00) | (isTestTone ? 0x02 : 0x00);
  view.setUint8(3, flags);

  // Header bytes 4..7: Sequence Number
  view.setUint32(4, seq >>> 0, true);
  // Header bytes 8..15: Target Server Playback Timestamp (ms)
  view.setFloat64(8, playAtServerMs, true);
  // Header bytes 16..19: Sample Rate (Hz)
  view.setUint32(16, sampleRate >>> 0, true);
  // Header bytes 20..21: Samples per channel
  view.setUint16(20, frameSamples & 0xffff, true);

  // Encode Int16LE PCM samples and accumulate energy + checksum
  let sumSq = 0;
  let checksum = (seq ^ sampleRate ^ frameSamples ^ flags) & 0xffff;
  let offset = PCM_HEADER_BYTES;

  for (let i = 0; i < frameSamples; i++) {
    const lSample = Math.max(-1, Math.min(1, left[i]));
    const lInt = lSample < 0 ? Math.round(lSample * 32768) : Math.round(lSample * 32767);
    view.setInt16(offset, lInt, true);
    offset += 2;
    sumSq += lSample * lSample;

    if (channels === 2) {
      const rSample = Math.max(-1, Math.min(1, right[i]));
      const rInt = rSample < 0 ? Math.round(rSample * 32768) : Math.round(rSample * 32767);
      view.setInt16(offset, rInt, true);
      offset += 2;
      sumSq += rSample * rSample;
    }

    if ((i & 15) === 0) {
      checksum = (checksum + (lInt & 0xffff)) & 0xffff;
    }
  }

  view.setUint16(22, checksum, true);

  const rms = Math.sqrt(sumSq / Math.max(1, frameSamples * channels));
  const rmsDb = rms > 0.00001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;

  const hexHeader = formatHexSlice(bytes, 0, PCM_HEADER_BYTES);
  const hexPayloadSample = formatHexSlice(bytes, PCM_HEADER_BYTES, Math.min(totalBytes, PCM_HEADER_BYTES + 16));

  return {
    buffer,
    preview: {
      seq,
      playAtServerMs,
      sampleRate,
      channels,
      frameSamples,
      byteLength: totalBytes,
      checksum,
      rmsDb,
      hexHeader,
      hexPayloadSample,
      timestamp: Date.now(),
    },
  };
}

export function decodePcmPacket(data: ArrayBuffer): ParsedPcmPacket | null {
  if (data.byteLength < PCM_HEADER_BYTES) {
    return null;
  }

  const view = new DataView(data);
  if (view.getUint8(0) !== PCM_MAGIC_0 || view.getUint8(1) !== PCM_MAGIC_1) {
    return null;
  }

  const flags = view.getUint8(3);
  const channels = (flags & 0x01) !== 0 ? 2 : 1;
  const isTestTone = (flags & 0x02) !== 0;
  const seq = view.getUint32(4, true);
  const playAtServerMs = view.getFloat64(8, true);
  const sampleRate = view.getUint32(16, true);
  const frameSamples = view.getUint16(20, true);
  const expectedChecksum = view.getUint16(22, true);

  const expectedLength = PCM_HEADER_BYTES + frameSamples * channels * 2;
  if (data.byteLength < expectedLength) {
    return null;
  }

  const left = new Float32Array(frameSamples);
  const right = new Float32Array(frameSamples);

  let checksum = (seq ^ sampleRate ^ frameSamples ^ flags) & 0xffff;
  let sumSq = 0;
  let offset = PCM_HEADER_BYTES;

  for (let i = 0; i < frameSamples; i++) {
    const lInt = view.getInt16(offset, true);
    offset += 2;
    const lFloat = lInt < 0 ? lInt / 32768 : lInt / 32767;
    left[i] = lFloat;
    sumSq += lFloat * lFloat;

    if (channels === 2) {
      const rInt = view.getInt16(offset, true);
      offset += 2;
      const rFloat = rInt < 0 ? rInt / 32768 : rInt / 32767;
      right[i] = rFloat;
      sumSq += rFloat * rFloat;
    } else {
      right[i] = lFloat;
    }

    if ((i & 15) === 0) {
      checksum = (checksum + (lInt & 0xffff)) & 0xffff;
    }
  }

  const rms = Math.sqrt(sumSq / Math.max(1, frameSamples * channels));
  const rmsDb = rms > 0.00001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;

  return {
    seq,
    playAtServerMs,
    sampleRate,
    channels,
    frameSamples,
    isTestTone,
    targetReceiverIndex: 0,
    checksumValid: checksum === expectedChecksum,
    left,
    right,
    rmsDb,
  };
}

export function extractWaveformPeaks(buffer: AudioBuffer, bucketCount = 120): number[] {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const blockSize = Math.max(1, Math.floor(ch0.length / bucketCount));
  const peaks: number[] = [];

  for (let b = 0; b < bucketCount; b++) {
    const start = b * blockSize;
    const end = Math.min(ch0.length, start + blockSize);
    let maxVal = 0;
    const step = Math.max(1, Math.floor((end - start) / 64));
    for (let i = start; i < end; i += step) {
      const val = (Math.abs(ch0[i]) + Math.abs(ch1[i])) * 0.5;
      if (val > maxVal) maxVal = val;
    }
    peaks.push(Math.min(1, maxVal));
  }
  return peaks;
}

function formatHexSlice(bytes: Uint8Array, start: number, end: number): string {
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0').toUpperCase());
  }
  return parts.join(' ');
}
