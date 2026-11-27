export type ClientRole = 'host' | 'receiver';

export type ChannelRouting = 'stereo' | 'left' | 'right' | 'mono';

export type FrameDurationMs = 10 | 20 | 40;

export type SampleRateOption = 44100 | 48000;

export type AudioFormatCategory = 'MP3' | 'FLAC' | 'WAV' | 'M4A' | 'OGG' | 'PCM' | 'KHÁC';

export interface ReceiverDevice {
  id: string;
  name: string;
  speakerLabel: string;
  volume: number; // 0..1
  muted: boolean;
  delayOffsetMs: number; // -250..+250 ms for Bluetooth speaker latency calibration
  channelMode: ChannelRouting;
  rttMs: number;
  bufferMs: number;
  packetsReceived: number;
  packetsDropped: number;
  signalDb?: number;
  audioReady: boolean;
  outputDeviceLabel: string;
  connectedAt: number;
  lastSeenAt: number;
}

export interface RoomSettings {
  sampleRate: SampleRateOption;
  frameDurationMs: FrameDurationMs;
  jitterBufferMs: number;
  isPlaying: boolean;
  trackTitle: string;
  trackCoverUrl?: string;
  trackPositionSec: number;
  trackDurationSec: number;
}

export interface DecodedTrack {
  id: string;
  title: string;
  artistOrSource: string;
  folderName: string;
  formatLabel: string;
  formatCategory: AudioFormatCategory;
  coverUrl: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  buffer: AudioBuffer | null;
  peaks: number[]; // Normalized 0..1 waveform preview peaks
  isBuiltIn: boolean;
  fileSizeBytes?: number;
  rawBlob?: Blob;
  localMediaUrl?: string;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  createdAt: number;
  folderName?: string;
  trackIds: string[];
  trackTitles: string[];
}

export interface PacketPreview {
  seq: number;
  playAtServerMs: number;
  sampleRate: number;
  channels: number;
  frameSamples: number;
  byteLength: number;
  checksum: number;
  rmsDb: number;
  hexHeader: string;
  hexPayloadSample: string;
  timestamp: number;
}

export interface ReleaseAssetInfo {
  id: string;
  role: 'transmitter' | 'receiver';
  title: string;
  fileName: string;
  packageId: string;
  version: string;
  sizeLabel: string;
  description: string;
  downloadUrl: string;
}

export interface ReleasePayload {
  version: string;
  publishedAt: string;
  repoSlug: string | null;
  source: 'github' | 'bundled';
  releaseNotes: string;
  assets: ReleaseAssetInfo[];
}

export type ServerMessage =
  | {
      type: 'room:state';
      roomId: string;
      receivers: ReceiverDevice[];
      settings: RoomSettings;
      hostConnected: boolean;
    }
  | {
      type: 'sync:pong';
      clientSendMs: number;
      serverTimeMs: number;
    }
  | {
      type: 'device:config';
      device: ReceiverDevice;
    }
  | {
      type: 'room:settings';
      settings: RoomSettings;
    }
  | {
      type: 'host:disconnected';
    }
  | {
      type: 'error';
      message: string;
    };

export type ClientMessage =
  | {
      type: 'room:join';
      roomId: string;
      role: ClientRole;
      deviceName?: string;
      speakerLabel?: string;
    }
  | {
      type: 'sync:ping';
      clientSendMs: number;
    }
  | {
      type: 'host:settings';
      settings: Partial<RoomSettings>;
    }
  | {
      type: 'host:update-device';
      receiverId: string;
      patch: Partial<
        Pick<ReceiverDevice, 'name' | 'speakerLabel' | 'volume' | 'muted' | 'delayOffsetMs' | 'channelMode'>
      >;
    }
  | {
      type: 'host:kick-device';
      receiverId: string;
    }
  | {
      type: 'host:test-tone';
      receiverId: string;
    }
  | {
      type: 'receiver:telemetry';
      rttMs: number;
      bufferMs: number;
      packetsReceived: number;
      packetsDropped: number;
      signalDb?: number;
      audioReady: boolean;
      outputDeviceLabel: string;
    }
  | {
      type: 'receiver:update-self';
      name?: string;
      speakerLabel?: string;
      volume?: number;
      muted?: boolean;
      delayOffsetMs?: number;
    };
