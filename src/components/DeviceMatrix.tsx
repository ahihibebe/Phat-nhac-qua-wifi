import { useState, type FC } from 'react';
import {
  BellRing,
  Bluetooth,
  ExternalLink,
  QrCode,
  Search,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ChannelRouting, ReceiverDevice } from '../types/audio';
import { getAppBaseOrigin } from '../utils/wsEndpoint';

interface DeviceMatrixProps {
  receivers: ReceiverDevice[];
  roomId: string;
  isAutoCalibrating?: boolean;
  onUpdateDevice: (
    receiverId: string,
    patch: Partial<
      Pick<ReceiverDevice, 'name' | 'speakerLabel' | 'volume' | 'muted' | 'delayOffsetMs' | 'channelMode'>
    >
  ) => void;
  onSendTestTone: (receiverId: string) => void;
  onKickDevice: (receiverId: string) => void;
  onOpenPairing: () => void;
  onAutoCalibrate?: (receiverId?: string) => void;
}

const CHANNEL_OPTIONS: { value: ChannelRouting; label: string }[] = [
  { value: 'stereo', label: 'Stereo' },
  { value: 'left', label: 'Trái (L)' },
  { value: 'right', label: 'Phải (R)' },
  { value: 'mono', label: 'Mono' },
];

export const DeviceMatrix: FC<DeviceMatrixProps> = ({
  receivers,
  roomId,
  isAutoCalibrating = false,
  onUpdateDevice,
  onSendTestTone,
  onKickDevice,
  onOpenPairing,
  onAutoCalibrate,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'muted'>('all');

  const baseOrigin = getAppBaseOrigin() || window.location.origin;
  const receiverUrl = `${baseOrigin}/?role=receiver&room=${encodeURIComponent(roomId)}`;

  const filtered = receivers.filter((dev) => {
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q ||
      dev.name.toLowerCase().includes(q) ||
      dev.speakerLabel.toLowerCase().includes(q) ||
      dev.outputDeviceLabel.toLowerCase().includes(q);

    if (!matchesQuery) return false;
    if (statusFilter === 'ready') return dev.audioReady && !dev.muted;
    if (statusFilter === 'muted') return dev.muted;
    return true;
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Thiết bị nhận qua Wi-Fi & Loa Bluetooth
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Cân chỉnh độ trễ Bluetooth (ms), âm lượng và phân kênh riêng cho từng điện thoại đang cắm loa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onAutoCalibrate && receivers.length > 0 && (
            <button
              type="button"
              onClick={() => onAutoCalibrate()}
              disabled={isAutoCalibrating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className={`h-3.5 w-3.5 ${isAutoCalibrating ? 'animate-spin' : ''}`} />
              {isAutoCalibrating ? 'Đang tự bù...' : 'Auto bù trễ'}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenPairing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <QrCode className="h-3.5 w-3.5 text-sky-600" />
            Mã QR phòng {roomId}
          </button>
          <a
            href={receiverUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 px-3 py-2 text-xs font-medium text-sky-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Mở tab Máy nhận
          </a>
        </div>
      </div>

      {receivers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm điện thoại hoặc tên loa..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {[
              { id: 'all', label: `Tất cả (${receivers.length})` },
              { id: 'ready', label: 'Đang phát' },
              { id: 'muted', label: 'Đang tắt tiếng' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as 'all' | 'ready' | 'muted')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {receivers.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-sky-600">
            <Bluetooth className="h-5 w-5" />
          </div>
          <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
            Chưa có điện thoại nào kết nối vào phòng {roomId}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
            Kết nối loa Bluetooth vào điện thoại, sau đó quét mã QR hoặc cài bản APK Nhận trên cùng mạng Wi-Fi để bắt đầu phát nhạc đồng bộ nhiều loa.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenPairing}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              <QrCode className="h-4 w-4" />
              Hiển thị mã QR Wi-Fi
            </button>
            <a
              href={receiverUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" />
              Mở tab Máy nhận thử nghiệm ngay
            </a>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5 py-8 text-center text-xs text-slate-500">
          Không tìm thấy thiết bị phù hợp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-200">
          {filtered.map((dev) => {
            const bufferHealth =
              dev.bufferMs >= 35 ? 'text-emerald-600' : dev.bufferMs > 0 ? 'text-amber-600' : 'text-slate-500';

            return (
              <div key={dev.id} className="py-4 first:pt-2 last:pb-1 space-y-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold text-slate-900">
                        {dev.name}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700">
                        <Bluetooth className="h-3.5 w-3.5" />
                        {dev.speakerLabel}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={dev.audioReady ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                        {dev.audioReady ? 'Âm thanh đã bật' : 'Chờ bấm bật tiếng trên máy nhận'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Ping {dev.rttMs} ms</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-mono tabular-nums ${bufferHealth}`}>
                        Đệm {dev.bufferMs} ms
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Nhận {dev.packetsReceived.toLocaleString('vi-VN')} gói (mất {dev.packetsDropped})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSendTestTone(dev.id)}
                      title="Gửi âm thanh chuông 880Hz riêng tới loa này"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
                    >
                      <BellRing className="h-3.5 w-3.5 text-sky-600" />
                      Thử loa
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateDevice(dev.id, { muted: !dev.muted })}
                      aria-label={dev.muted ? 'Bật tiếng loa' : 'Tắt tiếng loa'}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        dev.muted
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {dev.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {dev.muted ? 'Đang tắt' : 'Đang mở'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onKickDevice(dev.id)}
                      aria-label={`Ngắt kết nối ${dev.name}`}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-12 items-center">
                  <div className="md:col-span-4 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Âm lượng loa</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {Math.round(dev.volume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={dev.volume}
                      onChange={(e) => onUpdateDevice(dev.id, { volume: Number(e.target.value) })}
                      aria-label={`Âm lượng ${dev.name}`}
                      className="studio-slider w-full"
                    />
                  </div>

                  <div className="md:col-span-5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Bù trễ Bluetooth</span>
                      <div className="flex items-center gap-1.5">
                        {onAutoCalibrate && (
                          <button
                            type="button"
                            onClick={() => onAutoCalibrate(dev.id)}
                            disabled={isAutoCalibrating}
                            title="Tự động cân chỉnh bù trễ cho loa này"
                            className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 hover:bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 cursor-pointer disabled:opacity-50"
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            Auto
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateDevice(dev.id, {
                              delayOffsetMs: Math.max(-250, dev.delayOffsetMs - 10),
                            })
                          }
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:border-slate-300 cursor-pointer"
                        >
                          -10
                        </button>
                        <span className="font-mono font-semibold text-sky-600 tabular-nums min-w-[60px] text-center">
                          {dev.delayOffsetMs > 0 ? `+${dev.delayOffsetMs}` : dev.delayOffsetMs} ms
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateDevice(dev.id, {
                              delayOffsetMs: Math.min(250, dev.delayOffsetMs + 10),
                            })
                          }
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:border-slate-300 cursor-pointer"
                        >
                          +10
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-250}
                      max={250}
                      step={5}
                      value={dev.delayOffsetMs}
                      onChange={(e) =>
                        onUpdateDevice(dev.id, { delayOffsetMs: Number(e.target.value) })
                      }
                      aria-label={`Bù trễ Bluetooth cho ${dev.name}`}
                      className="studio-slider w-full"
                    />
                  </div>

                  <div className="md:col-span-3 flex justify-start md:justify-end">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      {CHANNEL_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => onUpdateDevice(dev.id, { channelMode: opt.value })}
                          className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                            dev.channelMode === opt.value
                              ? 'bg-white text-sky-700 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
