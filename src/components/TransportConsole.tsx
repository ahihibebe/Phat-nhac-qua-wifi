import { useEffect, useState, type FC } from 'react';
import {
  Disc3,
  Loader2,
  Pause,
  Play,
  Radio,
  Repeat,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ChannelRouting,
  DecodedTrack,
  FrameDurationMs,
  RoomSettings,
  SampleRateOption,
} from '../types/audio';
import { TortoiseProgressBar } from './TortoiseProgressBar';

const HOST_CHANNEL_OPTIONS: { value: ChannelRouting; label: string }[] = [
  { value: 'stereo', label: 'Stereo' },
  { value: 'left', label: 'Trái (L)' },
  { value: 'right', label: 'Phải (R)' },
  { value: 'mono', label: 'Mono' },
];

interface TransportConsoleProps {
  activeTrack: DecodedTrack | null;
  isPlaying: boolean;
  isDecodingTrack?: boolean;
  loopTrack: boolean;
  onToggleLoop: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  currentPositionSec: number;
  settings: RoomSettings;
  wsConnected: boolean;
  receiverCount: number;
  packetsSent: number;
  kbps: number;
  spectrumBands: number[];
  localMonitorEnabled: boolean;
  onToggleLocalMonitor: () => void;
  localMonitorVolume: number;
  onChangeLocalMonitorVolume: (val: number) => void;
  hostChannelMode: ChannelRouting;
  onChangeHostChannelMode: (mode: ChannelRouting) => void;
  isAutoCalibrating?: boolean;
  autoCalibNote?: string | null;
  onAutoCalibrate?: () => void;
  isSystemCaptureArmed?: boolean;
  isExternalMediaStreaming?: boolean;
  externalMediaDetectedOnDevice?: boolean;
  autoTransmitExternalMedia?: boolean;
  captureError?: string | null;
  onToggleAutoTransmitExternalMedia?: (enabled: boolean) => void;
  onStartDeviceMediaCapture?: () => void;
  onStopDeviceMediaCapture?: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (sec: number) => void;
  onUpdateSettings: (
    patch: Partial<Pick<RoomSettings, 'sampleRate' | 'frameDurationMs' | 'jitterBufferMs'>>
  ) => void;
}

export const TransportConsole: FC<TransportConsoleProps> = ({
  activeTrack,
  isPlaying,
  isDecodingTrack = false,
  loopTrack,
  onToggleLoop,
  shuffle,
  onToggleShuffle,
  currentPositionSec,
  settings,
  wsConnected,
  receiverCount,
  packetsSent,
  kbps,
  spectrumBands,
  localMonitorEnabled,
  onToggleLocalMonitor,
  localMonitorVolume,
  onChangeLocalMonitorVolume,
  hostChannelMode,
  onChangeHostChannelMode,
  isAutoCalibrating = false,
  autoCalibNote = null,
  onAutoCalibrate,
  isSystemCaptureArmed = false,
  isExternalMediaStreaming = false,
  externalMediaDetectedOnDevice = false,
  autoTransmitExternalMedia = true,
  captureError = null,
  onToggleAutoTransmitExternalMedia,
  onStartDeviceMediaCapture,
  onStopDeviceMediaCapture,
  onPlay,
  onPause,
  onStop,
  onNext,
  onPrevious,
  onSeek,
  onUpdateSettings,
}) => {
  const [imgError, setImgError] = useState(false);

  const duration = activeTrack?.durationSec || 0;
  const peaks = activeTrack?.peaks || [];
  const coverUrl = activeTrack?.coverUrl;

  useEffect(() => {
    setImgError(false);
  }, [activeTrack?.id, coverUrl]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      {/* Header with Cover Art + Metadata + 4 Readouts */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          {/* Album Cover Art with Zero-Broken-Image fallback */}
          <div className="relative h-24 w-24 sm:h-28 sm:w-28 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden shrink-0">
            {isSystemCaptureArmed ? (
              <div className="flex h-full w-full flex-col items-center justify-center bg-sky-50 text-sky-600">
                <Radio className={`h-8 w-8 ${isExternalMediaStreaming ? 'animate-pulse' : ''}`} />
              </div>
            ) : coverUrl && !imgError ? (
              <img
                src={coverUrl}
                alt={activeTrack ? `Ảnh bìa ${activeTrack.title}` : 'Ảnh bìa bản nhạc'}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                <Disc3 className={`h-8 w-8 ${isPlaying ? 'animate-spin' : ''}`} />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className={wsConnected ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                {wsConnected ? 'Máy chủ Wi-Fi sẵn sàng' : 'Đang kết nối máy chủ'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{settings.sampleRate / 1000} kHz 16-bit PCM</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{settings.frameDurationMs} ms/gói</span>
              {isDecodingTrack && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-sky-600 font-medium">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Đang nạp âm thanh...
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-1.5 font-display text-xl sm:text-2xl font-bold text-slate-900 truncate">
              {isSystemCaptureArmed
                ? isExternalMediaStreaming
                  ? 'Đang tự nhận & truyền Media trên máy'
                  : 'Đang chờ phát Media trên thiết bị...'
                : activeTrack
                  ? activeTrack.title
                  : 'Chưa có bài nhạc'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 truncate">
              {isSystemCaptureArmed
                ? 'Tự động truyền qua Wi-Fi khi YouTube, Spotify, Zing MP3 hoặc trình duyệt phát âm thanh'
                : activeTrack
                  ? `${activeTrack.folderName} · ${activeTrack.formatLabel}`
                  : 'Quét thư mục hoặc chọn tệp nhạc để bắt đầu phát đa loa'}
            </p>
          </div>
        </div>

        {/* 4 compact live stream readouts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200 w-full sm:w-auto">
          <div>
            <div className="text-[11px] text-slate-500">Loa đang nhận</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
              {receiverCount}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Tốc độ Wi-Fi</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-sky-600 tabular-nums">
              {isPlaying || isExternalMediaStreaming ? `${kbps} kbps` : '0 kbps'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Gói đã gửi</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
              {packetsSent.toLocaleString('vi-VN')}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Bộ đệm Jitter</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
              {settings.jitterBufferMs} ms
            </div>
          </div>
        </div>
      </div>

      {/* Crawling Tortoise Progress Bar */}
      <div className="mt-4">
        <TortoiseProgressBar
          currentSec={currentPositionSec}
          durationSec={duration}
          isPlaying={isPlaying}
          peaks={peaks}
          onSeek={onSeek}
        />
      </div>

      {/* Full Player Transport + Spectrum */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Bài trước"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2.5 text-slate-700 transition-colors cursor-pointer"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          {isPlaying ? (
            <button
              type="button"
              onClick={onPause}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white transition-colors cursor-pointer"
            >
              <Pause className="h-4 w-4 fill-current" />
              Tạm dừng
            </button>
          ) : (
            <button
              type="button"
              onClick={onPlay}
              disabled={!activeTrack}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              Phát & Truyền Wi-Fi
            </button>
          )}

          <button
            type="button"
            onClick={onNext}
            aria-label="Bài tiếp theo"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2.5 text-slate-700 transition-colors cursor-pointer"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onStop}
            aria-label="Dừng và tua về đầu"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Về đầu
          </button>

          <button
            type="button"
            onClick={onToggleShuffle}
            aria-pressed={shuffle}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
              shuffle
                ? 'border-sky-300 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
            Ngẫu nhiên
          </button>

          <button
            type="button"
            onClick={onToggleLoop}
            aria-pressed={loopTrack}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
              loopTrack
                ? 'border-sky-300 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
            Lặp bài
          </button>
        </div>

        {/* Real-time 32-band PCM Energy Monitor */}
        <div
          className="hidden xl:flex h-9 w-52 items-end gap-[3px] rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5"
          aria-label="Phổ âm thanh trực tiếp"
        >
          {spectrumBands.map((val, i) => (
            <div
              key={i}
              className="flex-1 rounded-[1px] bg-sky-600/85 transition-transform duration-75 origin-bottom"
              style={{
                height: '100%',
                transform: `scaleY(${Math.max(0.08, val)})`,
              }}
            />
          ))}
        </div>

        {/* Local Host Monitor Speaker Control */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleLocalMonitor}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
              localMonitorEnabled
                ? 'border-slate-200 bg-slate-50 text-slate-800'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            {localMonitorEnabled ? (
              <Volume2 className="h-4 w-4 text-sky-600" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
            <span>Loa máy chủ</span>
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={localMonitorVolume}
            onChange={(e) => onChangeLocalMonitorVolume(Number(e.target.value))}
            aria-label="Âm lượng loa máy chủ"
            className="studio-slider w-24"
          />
        </div>
      </div>

      {/* Auto-detect & Transmit Device Media */}
      {onStartDeviceMediaCapture && onStopDeviceMediaCapture && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-800">
              <Radio
                className={`h-4 w-4 shrink-0 ${
                  isExternalMediaStreaming
                    ? 'text-emerald-600 animate-pulse'
                    : isSystemCaptureArmed
                      ? 'text-sky-600'
                      : 'text-slate-500'
                }`}
              />
              <span>Tự nhận & truyền media đang phát trên máy</span>
              {isSystemCaptureArmed && (
                <span
                  className={`font-medium ${
                    isExternalMediaStreaming ? 'text-emerald-600' : 'text-sky-600'
                  }`}
                >
                  · {isExternalMediaStreaming ? 'Đang thu & phát trực tiếp' : 'Đang chờ có âm thanh...'}
                </span>
              )}
              {!isSystemCaptureArmed && externalMediaDetectedOnDevice && (
                <span className="font-medium text-amber-600">
                  · Phát hiện thiết bị đang phát nhạc
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Khi phát YouTube, Spotify, Zing MP3 hoặc video trên máy, hệ thống tự thu âm thanh nội bộ và truyền sang các loa Bluetooth.
            </p>
            {captureError && (
              <p className="mt-1 text-[11px] font-medium text-rose-600">{captureError}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onToggleAutoTransmitExternalMedia && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoTransmitExternalMedia}
                  onChange={(e) => onToggleAutoTransmitExternalMedia(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>Tự động truyền khi phát media</span>
              </label>
            )}

            {isSystemCaptureArmed ? (
              <button
                type="button"
                onClick={onStopDeviceMediaCapture}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Dừng thu media
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartDeviceMediaCapture}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white hover:bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-700 transition-colors cursor-pointer"
              >
                <Radio className="h-3.5 w-3.5" />
                {externalMediaDetectedOnDevice ? 'Thu & truyền media ngay' : 'Bật thu media trên máy'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Wi-Fi Stream, Host Channel Routing & Jitter Buffer Settings */}
      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="block text-xs font-medium text-slate-600 mb-2">Kênh phát máy chủ</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {HOST_CHANNEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeHostChannelMode(opt.value)}
                aria-pressed={hostChannelMode === opt.value}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  hostChannelMode === opt.value
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-600 mb-2">Chất lượng truyền PCM</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {([44100, 48000] as SampleRateOption[]).map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => onUpdateSettings({ sampleRate: rate })}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors cursor-pointer ${
                  settings.sampleRate === rate
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {(rate / 1000).toFixed(1)} kHz
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-600 mb-2">Độ dài khung truyền</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {([10, 20, 40] as FrameDurationMs[]).map((ms) => (
              <button
                key={ms}
                type="button"
                onClick={() => onUpdateSettings({ frameDurationMs: ms })}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors cursor-pointer ${
                  settings.frameDurationMs === ms
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ms} ms
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-2">
            <span className="font-medium text-slate-600">Bộ đệm chống giật Wi-Fi</span>
            <div className="flex items-center gap-2">
              {onAutoCalibrate && (
                <button
                  type="button"
                  onClick={onAutoCalibrate}
                  disabled={isAutoCalibrating}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className={`h-3 w-3 ${isAutoCalibrating ? 'animate-spin' : ''}`} />
                  {isAutoCalibrating ? 'Đang đo...' : 'Auto bù trễ'}
                </button>
              )}
              <span className="font-mono font-semibold text-sky-600 tabular-nums">
                {settings.jitterBufferMs} ms
              </span>
            </div>
          </div>
          <input
            type="range"
            min={40}
            max={220}
            step={10}
            value={settings.jitterBufferMs}
            onChange={(e) => onUpdateSettings({ jitterBufferMs: Number(e.target.value) })}
            aria-label="Độ lớn bộ đệm Jitter Buffer"
            className="studio-slider w-full"
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>40 ms (Nhanh)</span>
            <span>220 ms (Ổn định)</span>
          </div>
          {autoCalibNote && (
            <p className="mt-1 text-[11px] font-medium text-emerald-700">{autoCalibNote}</p>
          )}
        </div>
      </div>
    </section>
  );
};
