import type { DecodedTrack } from '../types/audio';
import { extractWaveformPeaks } from './pcmPacketizer';

/**
 * Creates mathematical PCM calibration and musical test tracks with curated cover art
 * so users can immediately test multi-speaker Wi-Fi sync before scanning local folders.
 */
export function buildBuiltInTracks(sampleRate = 48000): DecodedTrack[] {
  const ctx = new OfflineAudioContext(2, sampleRate * 1, sampleRate);

  const track1 = createAcousticPulseBuffer(ctx, sampleRate, 24);
  const track2 = createWarmLoFiChordBuffer(ctx, sampleRate, 28);
  const track3 = createStereoBassSyncBuffer(ctx, sampleRate, 16);

  return [
    {
      id: 'builtin-pulse-120',
      title: 'Nhịp Đồng Bộ Acoustic (120 BPM)',
      artistOrSource: 'Tín hiệu kiểm chuẩn đa loa',
      formatLabel: 'PCM · 48 kHz · Stereo',
      formatCategory: 'PCM',
      coverUrl: '/src/assets/images/cover_acoustic_pulse_1795684914389.jpg',
      durationSec: track1.duration,
      sampleRate,
      channels: 2,
      buffer: track1,
      peaks: extractWaveformPeaks(track1),
      isBuiltIn: true,
    },
    {
      id: 'builtin-lofi-chords',
      title: 'Hòa Âm Điện Tử Warm Pad',
      artistOrSource: 'Tín hiệu thử dải trung & cao',
      formatLabel: 'PCM · 48 kHz · Stereo',
      formatCategory: 'PCM',
      coverUrl: '/src/assets/images/cover_warm_lofi_1795684915197.jpg',
      durationSec: track2.duration,
      sampleRate,
      channels: 2,
      buffer: track2,
      peaks: extractWaveformPeaks(track2),
      isBuiltIn: true,
    },
    {
      id: 'builtin-stereo-sub',
      title: 'Kiểm Tra Pha Trái / Phải & Sub-Bass',
      artistOrSource: 'Tín hiệu cân chỉnh trễ Bluetooth',
      formatLabel: 'PCM · 48 kHz · Stereo',
      formatCategory: 'PCM',
      coverUrl: '/src/assets/images/cover_stereo_sub_1795684915076.jpg',
      durationSec: track3.duration,
      sampleRate,
      channels: 2,
      buffer: track3,
      peaks: extractWaveformPeaks(track3),
      isBuiltIn: true,
    },
  ];
}

function createAcousticPulseBuffer(
  ctx: OfflineAudioContext,
  sampleRate: number,
  durationSec: number
): AudioBuffer {
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const beatInterval = 0.5;
  const scale = [261.63, 329.63, 392.0, 493.88, 523.25, 392.0, 329.63, 293.66];

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const beatIndex = Math.floor(t / beatInterval);
    const tInBeat = t - beatIndex * beatInterval;

    let kick = 0;
    if (beatIndex % 2 === 0 && tInBeat < 0.22) {
      const pitch = 135 * Math.exp(-tInBeat * 28) + 46;
      kick = Math.sin(2 * Math.PI * pitch * tInBeat) * Math.exp(-tInBeat * 12) * 0.55;
    }

    let click = 0;
    if (tInBeat < 0.045) {
      const env = Math.exp(-tInBeat * 95);
      const clickFreq = beatIndex % 4 === 0 ? 1320 : 880;
      click = Math.sin(2 * Math.PI * clickFreq * tInBeat) * env * 0.3;
    }

    const noteFreq = scale[beatIndex % scale.length];
    const pluckEnv = Math.exp(-tInBeat * 6.5);
    const pluck =
      (Math.sin(2 * Math.PI * noteFreq * tInBeat) * 0.7 +
        Math.sin(2 * Math.PI * noteFreq * 2 * tInBeat) * 0.2) *
      pluckEnv *
      0.28;

    const pan = Math.sin(beatIndex * 0.8) * 0.35;
    left[i] = Math.tanh(kick + click + pluck * (1 - pan));
    right[i] = Math.tanh(kick + click + pluck * (1 + pan));
  }

  return buffer;
}

function createWarmLoFiChordBuffer(
  ctx: OfflineAudioContext,
  sampleRate: number,
  durationSec: number
): AudioBuffer {
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const chords = [
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 220.0, 261.63, 329.63],
    [196.0, 246.94, 293.66, 349.23],
    [164.81, 196.0, 246.94, 293.66],
  ];

  const barSec = 2.0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const barIdx = Math.floor(t / barSec) % chords.length;
    const tInBar = t % barSec;
    const chord = chords[barIdx];

    const env = Math.min(1, tInBar / 0.18) * Math.min(1, (barSec - tInBar) / 0.25);

    let sigL = 0;
    let sigR = 0;
    for (let n = 0; n < chord.length; n++) {
      const f = chord[n];
      const detune = n % 2 === 0 ? 1.0025 : 0.9975;
      sigL += Math.sin(2 * Math.PI * f * t) * 0.14;
      sigR += Math.sin(2 * Math.PI * f * detune * t) * 0.14;
    }

    const bassBeat = tInBar % 0.5;
    const bassEnv = Math.exp(-bassBeat * 5.5);
    const bass = Math.sin(2 * Math.PI * (chord[0] * 0.5) * t) * bassEnv * 0.35;

    left[i] = Math.tanh((sigL * env + bass) * 0.9);
    right[i] = Math.tanh((sigR * env + bass) * 0.9);
  }

  return buffer;
}

function createStereoBassSyncBuffer(
  ctx: OfflineAudioContext,
  sampleRate: number,
  durationSec: number
): AudioBuffer {
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const step = Math.floor(t / 1.0) % 4;
    const localT = t % 1.0;

    let l = 0;
    let r = 0;

    if (step === 0) {
      const env = Math.exp(-localT * 8);
      l = Math.sin(2 * Math.PI * 523.25 * localT) * env * 0.55;
    } else if (step === 1) {
      const env = Math.exp(-localT * 8);
      r = Math.sin(2 * Math.PI * 659.25 * localT) * env * 0.55;
    } else if (step === 2) {
      const env = Math.exp(-localT * 3.5);
      const freq = 55 + 65 * Math.exp(-localT * 6);
      const mono = Math.sin(2 * Math.PI * freq * localT) * env * 0.6;
      l = mono;
      r = mono;
    } else {
      const env = Math.exp(-localT * 30);
      const mono = Math.sin(2 * Math.PI * 1046.5 * localT) * env * 0.5;
      l = mono;
      r = mono;
    }

    left[i] = l;
    right[i] = r;
  }

  return buffer;
}
