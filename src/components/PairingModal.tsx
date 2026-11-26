import { useEffect, useState, type FC } from 'react';
import { Check, Copy, ExternalLink, Smartphone, Wifi, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface PairingModalProps {
  open: boolean;
  onClose: () => void;
  roomId: string;
  onChangeRoomId: (nextRoomId: string) => void;
  onSwitchToReceiver: () => void;
}

interface NetworkInfo {
  lanIps: string[];
  port: number;
  suggestedUrls: string[];
  originUrl: string;
}

export const PairingModal: FC<PairingModalProps> = ({
  open,
  onClose,
  roomId,
  onChangeRoomId,
  onSwitchToReceiver,
}) => {
  const [roomInput, setRoomInput] = useState(roomId);
  const [copied, setCopied] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);

  useEffect(() => {
    setRoomInput(roomId);
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/network-info')
      .then((res) => res.json())
      .then((data: NetworkInfo) => setNetworkInfo(data))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const receiverUrl = `${window.location.origin}/?role=receiver&room=${encodeURIComponent(roomId)}`;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleApplyRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = roomInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (cleaned.length >= 2) {
      onChangeRoomId(cleaned);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairing-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 id="pairing-title" className="font-display text-lg font-bold text-slate-900">
              Kết nối điện thoại phát loa Bluetooth qua Wi-Fi
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Quét mã QR hoặc mở đường dẫn dưới đây trên từng điện thoại đang ghép nối loa Bluetooth.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-[200px_1fr] items-start">
          <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-slate-50 p-4">
            <QRCodeSVG value={receiverUrl} size={164} level="M" />
            <span className="mt-2 font-mono text-xs font-semibold text-slate-900 tabular-nums">
              PHÒNG: {roomId}
            </span>
          </div>

          <div className="space-y-4">
            <form onSubmit={handleApplyRoom} className="space-y-1.5">
              <label htmlFor="room-code-input" className="block text-xs font-medium text-slate-700">
                Mã phòng Wi-Fi đồng bộ
              </label>
              <div className="flex gap-2">
                <input
                  id="room-code-input"
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  maxLength={12}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                  placeholder="MB48"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Đổi mã
                </button>
              </div>
            </form>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">Đường dẫn cho điện thoại</span>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="truncate font-mono text-xs text-sky-700">{receiverUrl}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(receiverUrl)}
                  className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Đã chép' : 'Sao chép'}
                </button>
              </div>
            </div>

            {networkInfo && networkInfo.lanIps.length > 0 && (
              <div className="space-y-1 text-xs text-slate-500">
                <div className="flex items-center gap-1.5 font-medium text-slate-700">
                  <Wifi className="h-3.5 w-3.5 text-sky-600" />
                  <span>Địa chỉ Wi-Fi LAN nội bộ</span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-slate-500">
                  {networkInfo.suggestedUrls.map((url) => {
                    const lanLink = `${url}/?role=receiver&room=${encodeURIComponent(roomId)}`;
                    return (
                      <div key={url} className="flex items-center justify-between gap-2 truncate">
                        <span className="truncate">{lanLink}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(lanLink)}
                          className="text-sky-600 hover:text-sky-700 shrink-0 cursor-pointer"
                        >
                          Chép
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <a
                href={receiverUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Mở tab Máy nhận thử nghiệm
              </a>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchToReceiver();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                <Smartphone className="h-3.5 w-3.5" />
                Chuyển màn hình này thành Máy nhận
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
