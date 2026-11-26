import { useRef, useState, type FC } from 'react';

interface TortoiseProgressBarProps {
  currentSec: number;
  durationSec: number;
  isPlaying: boolean;
  peaks: number[];
  onSeek: (sec: number) => void;
}

function formatClock(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const TortoiseProgressBar: FC<TortoiseProgressBarProps> = ({
  currentSec,
  durationSec,
  isPlaying,
  peaks,
  onSeek,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const progressRatio = durationSec > 0 ? Math.max(0, Math.min(1, currentSec / durationSec)) : 0;
  const pct = progressRatio * 100;

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || durationSec <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * durationSec);
  };

  return (
    <div className="space-y-1.5">
      {/* Subtle waveform silhouette + interactive tortoise rail */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Thanh tiến trình con rùa bò"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(currentSec)}
        tabIndex={0}
        onPointerDown={(e) => {
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (isDragging) seekFromClientX(e.clientX);
        }}
        onPointerUp={() => setIsDragging(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(durationSec, currentSec + 5));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentSec - 5));
        }}
        className="relative pt-7 pb-3 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-md"
      >
        {/* Subtle micro waveform above the rail */}
        {peaks.length > 0 && (
          <div className="mb-1.5 flex h-6 items-end gap-[2px] opacity-80">
            {peaks.map((peak, idx) => {
              const barRatio = idx / peaks.length;
              const passed = barRatio <= progressRatio;
              return (
                <div
                  key={idx}
                  className={`flex-1 rounded-[1px] transition-colors ${
                    passed ? 'bg-sky-600' : 'bg-slate-200'
                  }`}
                  style={{ height: `${Math.max(14, Math.round(peak * 100))}%` }}
                />
              );
            })}
          </div>
        )}

        {/* Grass/Stone Progress Track */}
        <div className="relative h-2.5 w-full rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-600 transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Crawling Tortoise Indicator */}
        <div
          className="pointer-events-none absolute bottom-3.5 -translate-x-1/2 transition-[left] duration-75"
          style={{ left: `clamp(16px, ${pct}%, calc(100% - 16px))` }}
        >
          <div className={isPlaying ? 'tortoise-walking' : ''}>
            <svg
              width="34"
              height="24"
              viewBox="0 0 34 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              className="drop-shadow-xs"
            >
              {/* Tail */}
              <path d="M4 16L1 15L4 14.2" fill="#4D7C0F" />
              {/* Back & Front Legs */}
              <rect x="7" y="16" width="3.5" height="5" rx="1.5" fill="#65A30D" />
              <rect x="19" y="16" width="3.5" height="5" rx="1.5" fill="#65A30D" />
              {/* Neck & Head facing right */}
              <path
                d="M23 13.5C25.5 13 27 10.5 29 10.5C31.2 10.5 32.8 12 32.8 13.8C32.8 15.6 31.2 16.8 29 16.8H23V13.5Z"
                fill="#84CC16"
                stroke="#365314"
                strokeWidth="1.1"
              />
              {/* Eye */}
              <circle cx="30" cy="12.6" r="1" fill="#0F172A" />
              {/* Shell */}
              <path
                d="M4.5 16C4.5 9.6 9.2 5 15 5C20.8 5 24.5 9.6 24.5 16H4.5Z"
                fill="#15803D"
                stroke="#14532D"
                strokeWidth="1.2"
              />
              {/* Shell Hex Pattern */}
              <path
                d="M11 8.2L15 6.5L19 8.2L18 12.2H12L11 8.2Z"
                fill="#22C55E"
                fillOpacity="0.45"
              />
              {/* Shell Rim */}
              <rect x="3.8" y="14.8" width="21.4" height="2.4" rx="1.2" fill="#D97706" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between font-mono text-xs text-slate-500 tabular-nums">
        <span>{formatClock(currentSec)}</span>
        <span className="text-[11px] font-sans text-slate-400">
          Kéo hoặc chạm lên đường chạy để tua nhanh
        </span>
        <span>{formatClock(durationSec)}</span>
      </div>
    </div>
  );
};
