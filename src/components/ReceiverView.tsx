import { useEffect, useRef, useState, type FC } from 'react';
import {
  ArrowLeft,
  Bluetooth,
  CheckCircle2,
  Disc3,
  Radio,
  RefreshCw,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { useReceiverClient } from '../hooks/useReceiverClient';
import {
  detectBluetoothSpeakerLabel,
  detectDeviceIdentityName,
  getSavedServerOrigin,
  isRunningInAndroidApk,
  resolveHighEntropyDeviceName,
  saveServerOrigin,
} from '../utils/wsEndpoint';

interface ReceiverViewProps {
  roomId: string;
  onChangeRoomId: (room: string) => void;
  onBackToHost?: () => void;
  isStandaloneReceiver: boolean;
}

export const ReceiverView: FC<ReceiverViewProps> = ({
  roomId,
  onChangeRoomId,
  onBackToHost,
  isStandaloneReceiver,
}) => {
  const [deviceName, setDeviceName] = useState(() => detectDeviceIdentityName());
  const [speakerLabel, setSpeakerLabel] = useState(() => detectBluetoothSpeakerLabel());
  const userEditedNameRef = useRef(false);
  const [roomDraft, setRoomDraft] = useState(roomId);
  const [serverOrigin, setServerOrigin] = useState(() => getSavedServerOrigin());
  const [serverInput, setServerInput] = useState(() => getSavedServerOrigin());
  const inApk = isRunningInAndroidApk();

  useEffect(() => {
    if (!inApk || serverOrigin) return;
    const timer = window.setInterval(() => {
      const discovered = window.__MTB_ANDROID__?.getDiscoveredHost?.() || '';
      if (discovered) {
        setServerOrigin(discovered);
        setServerInput(discovered);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [inApk, serverOrigin]);

  const {
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
    isAutoCalibrating,
    autoCalibNote,
    enableAudio,
    selectAudioOutput,
    updateSelf,
    autoCalibrateDelay,
  } = useReceiverClient(roomId, deviceName, speakerLabel, serverOrigin || undefined);

  useEffect(() => {
    let active = true;
    resolveHighEntropyDeviceName().then((resolved) => {
      if (!active || userEditedNameRef.current) return;
      if (resolved && resolved !== deviceName) {
        setDeviceName(resolved);
        updateSelf({ name: resolved });
      }
    });
    return () => {
      active = false;
    };
  }, [wsConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const meterLevel = Math.max(0, Math.min(100, ((signalDb + 60) / 60) * 100));

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSelf({ name: deviceName, speakerLabel });
  };

  const handleRefreshHardwareIdentity = async () => {
    userEditedNameRef.current = false;
    const detectedName = await resolveHighEntropyDeviceName();
    const detectedBt = detectBluetoothSpeakerLabel();
    setDeviceName(detectedName);
    setSpeakerLabel(detectedBt);
    updateSelf({ name: detectedName, speakerLabel: detectedBt });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = roomDraft.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (cleaned.length >= 2) {
      onChangeRoomId(cleaned);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 space-y-5">
      {!isStandaloneReceiver && onBackToHost && (
        <button
          type="button"
          onClick={onBackToHost}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Quay lại Bảng điều khiển Máy chủ
        </button>
      )}

      {/* Primary Receiver Status & Cover Art */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shrink-0">
            {roomSettings.trackCoverUrl ? (
              <img
                src={roomSettings.trackCoverUrl}
                alt="Ảnh bìa đang phát"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-400">
                <Disc3 className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className={wsConnected ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                {wsConnected ? 'Đã nối Wi-Fi' : 'Đang kết nối Wi-Fi'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Phòng {roomId}</span>
              <span aria-hidden="true">·</span>
              <span>{hostConnected ? 'Máy chủ đang trực tuyến' : 'Chờ máy chủ phát nhạc'}</span>
            </div>
            <h1 className="mt-1 font-display text-xl font-bold text-slate-900 truncate">
              {deviceConfig?.name || deviceName}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-sky-700">
              <Bluetooth className="h-3.5 w-3.5" />
              {deviceConfig?.speakerLabel || speakerLabel}
            </p>
          </div>
        </div>

        {!audioReady ? (
          <button
            type="button"
            onClick={enableAudio}
            className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 py-4 px-5 text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            <Radio className="h-5 w-5" />
            Chạm để bật bộ thu âm thanh ra Loa Bluetooth
          </button>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>Bộ thu đã mở khóa & sẵn sàng phát ra loa Bluetooth</span>
              </div>
              <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                {roomSettings.isPlaying ? 'Đang nhận' : 'Đang chờ'}
              </span>
            </div>

            <div className="text-xs text-slate-700 truncate">
              Bài đang phát: <span className="font-semibold">{roomSettings.trackTitle}</span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Mức tín hiệu nhận qua Wi-Fi</span>
                <span className="font-mono tabular-nums">{signalDb.toFixed(1)} dBFS</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white border border-emerald-200 overflow-hidden">
                <div
                  className="h-full bg-sky-600 transition-all duration-75"
                  style={{ width: `${meterLevel}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-slate-200 pt-4 text-xs">
          <div>
            <div className="text-slate-500">Độ trễ Wi-Fi</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {rttMs} ms
            </div>
          </div>
          <div>
            <div className="text-slate-500">Đệm Jitter</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-sky-600 tabular-nums">
              {bufferMs} ms
            </div>
          </div>
          <div>
            <div className="text-slate-500">Gói đã nhận</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {packetsReceived.toLocaleString('vi-VN')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Gói rớt</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {packetsDropped}
            </div>
          </div>
        </div>
      </section>

      {/* Local Controls */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <h2 className="font-display text-base font-bold text-slate-900">
          Âm thanh & Bù trễ Loa Bluetooth
        </h2>

        {sinkSupported && outputDevices.length > 0 ? (
          <div>
            <label htmlFor="bt-output-select" className="block text-xs font-medium text-slate-700 mb-1.5">
              Chọn đầu ra loa Bluetooth
            </label>
            <select
              id="bt-output-select"
              value={selectedOutputId}
              onChange={(e) => selectAudioOutput(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
            >
              <option value="default">Mặc định hệ thống (Bluetooth đang kết nối)</option>
              {outputDevices.map((opt) => (
                <option key={opt.deviceId} value={opt.deviceId}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-slate-500">
            Hãy kết nối điện thoại này với 1 loa Bluetooth trong phần Cài đặt Bluetooth của máy — mọi âm thanh nhận qua Wi-Fi sẽ phát thẳng ra loa Bluetooth đó.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-700">Âm lượng máy này</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-slate-900 tabular-nums">
                {Math.round((deviceConfig?.volume ?? 1) * 100)}%
              </span>
              <button
                type="button"
                onClick={() => updateSelf({ muted: !(deviceConfig?.muted ?? false) })}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 cursor-pointer"
              >
                {deviceConfig?.muted ? (
                  <>
                    <VolumeX className="h-3.5 w-3.5 text-amber-600" />
                    Đang tắt
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5 text-sky-600" />
                    Mở tiếng
                  </>
                )}
              </button>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={deviceConfig?.volume ?? 1}
            onChange={(e) => updateSelf({ volume: Number(e.target.value) })}
            className="studio-slider w-full"
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-700">Bù trễ loa Bluetooth (đồng bộ nhiều máy)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={autoCalibrateDelay}
                disabled={isAutoCalibrating}
                className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 hover:bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className={`h-3 w-3 ${isAutoCalibrating ? 'animate-spin' : ''}`} />
                {isAutoCalibrating ? 'Đang đo...' : 'Auto bù trễ'}
              </button>
              <span className="font-mono font-semibold text-sky-600 tabular-nums">
                {(deviceConfig?.delayOffsetMs ?? 0) > 0
                  ? `+${deviceConfig?.delayOffsetMs}`
                  : deviceConfig?.delayOffsetMs ?? 0}{' '}
                ms
              </span>
            </div>
          </div>
          <input
            type="range"
            min={-250}
            max={250}
            step={5}
            value={deviceConfig?.delayOffsetMs ?? 0}
            onChange={(e) => updateSelf({ delayOffsetMs: Number(e.target.value) })}
            className="studio-slider w-full"
          />
          {autoCalibNote && (
            <p className="text-[11px] text-emerald-700 font-medium">{autoCalibNote}</p>
          )}
        </div>
      </section>

      {/* Device Identity & Room Switch */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <form onSubmit={handleRenameSubmit} className="space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Thông tin định danh thiết bị
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rec-name" className="block text-xs text-slate-600 mb-1">
                Tên thiết bị
              </label>
              <input
                id="rec-name"
                type="text"
                value={deviceName}
                onChange={(e) => {
                  userEditedNameRef.current = true;
                  setDeviceName(e.target.value);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rec-speaker" className="block text-xs text-slate-600 mb-1">
                Tên loa Bluetooth đang cắm
              </label>
              <input
                id="rec-speaker"
                type="text"
                value={speakerLabel}
                onChange={(e) => setSpeakerLabel(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-slate-100 hover:bg-slate-200 px-4 py-2 text-xs font-medium text-slate-800 cursor-pointer"
            >
              Lưu tên hiển thị lên Máy chủ
            </button>
            <button
              type="button"
              onClick={handleRefreshHardwareIdentity}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5 text-sky-600" />
              Lấy tên thiết bị
            </button>
          </div>
        </form>

        <form onSubmit={handleJoinRoom} className="border-t border-slate-200 pt-4 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="rec-room" className="block text-xs text-slate-600 mb-1">
              Đổi mã phòng Wi-Fi
            </label>
            <input
              id="rec-room"
              type="text"
              value={roomDraft}
              onChange={(e) => setRoomDraft(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Vào phòng
          </button>
        </form>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const val = serverInput.trim();
            saveServerOrigin(val);
            setServerOrigin(val);
          }}
          className="border-t border-slate-200 pt-4 space-y-2"
        >
          <label htmlFor="rec-host-ip" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <Wifi className="h-3.5 w-3.5 text-sky-600" />
            <span>Địa chỉ Máy chủ / Điện thoại Truyền Wi-Fi (tự dò hoặc nhập IP)</span>
          </label>
          <div className="flex gap-2">
            <input
              id="rec-host-ip"
              type="text"
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              placeholder="vd: http://192.168.1.15:8765"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 text-xs font-medium text-slate-800 cursor-pointer"
            >
              Kết nối
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
