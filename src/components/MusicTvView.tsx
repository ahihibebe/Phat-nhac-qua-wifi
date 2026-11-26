import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  Disc3,
  Folder,
  FolderOpen,
  FolderSearch,
  FolderUp,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Tv,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AudioFormatCategory, DecodedTrack, SavedPlaylist } from '../types/audio';
import { TortoiseProgressBar } from './TortoiseProgressBar';

interface MusicTvViewProps {
  roomId: string;
  tracks: DecodedTrack[];
  activeTrack: DecodedTrack | null;
  savedPlaylists: SavedPlaylist[];
  isPlaying: boolean;
  isScanning: boolean;
  isDecodingTrack: boolean;
  scanProgress: { scanned: number; total: number } | null;
  loopTrack: boolean;
  onToggleLoop: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  currentPositionSec: number;
  receiverCount: number;
  wsConnected: boolean;
  localMonitorEnabled: boolean;
  onToggleLocalMonitor: () => void;
  localMonitorVolume: number;
  onChangeLocalMonitorVolume: (val: number) => void;
  spectrumBands: number[];
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (sec: number) => void;
  onSelectTrack: (trackId: string, autoPlay?: boolean) => void;
  onLoadFiles: (files: FileList | File[]) => void;
  onScanDirectoryFast: () => Promise<boolean>;
  onSavePlaylist: (name: string, folderName?: string) => void;
  onLoadPlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onOpenPairing: () => void;
  onExitTvMode: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const FORMAT_FILTERS: ('ALL' | AudioFormatCategory)[] = ['ALL', 'MP3', 'FLAC', 'WAV', 'M4A', 'OGG', 'PCM'];

export const MusicTvView: FC<MusicTvViewProps> = ({
  roomId,
  tracks,
  activeTrack,
  savedPlaylists,
  isPlaying,
  isScanning,
  isDecodingTrack,
  scanProgress,
  loopTrack,
  onToggleLoop,
  shuffle,
  onToggleShuffle,
  currentPositionSec,
  receiverCount,
  wsConnected,
  localMonitorEnabled,
  onToggleLocalMonitor,
  localMonitorVolume,
  onChangeLocalMonitorVolume,
  spectrumBands,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  onSeek,
  onSelectTrack,
  onLoadFiles,
  onScanDirectoryFast,
  onSavePlaylist,
  onLoadPlaylist,
  onDeletePlaylist,
  onOpenPairing,
  onExitTvMode,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL');
  const [formatFilter, setFormatFilter] = useState<'ALL' | AudioFormatCategory>('ALL');
  const [heroImgError, setHeroImgError] = useState(false);
  const [brokenCovers, setBrokenCovers] = useState<Record<string, boolean>>({});
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setHeroImgError(false);
  }, [activeTrack?.id, activeTrack?.coverUrl]);

  const folders = useMemo(() => {
    const map = new Map<string, { name: string; tracks: DecodedTrack[]; coverUrl: string }>();
    for (const t of tracks) {
      const folder = t.folderName || 'Nhạc trên máy';
      const existing = map.get(folder);
      if (existing) {
        existing.tracks.push(t);
      } else {
        map.set(folder, { name: folder, tracks: [t], coverUrl: t.coverUrl });
      }
    }
    return Array.from(map.values());
  }, [tracks]);

  const effectiveSelectedFolder =
    selectedFolder !== 'ALL' && !folders.some((f) => f.name === selectedFolder)
      ? 'ALL'
      : selectedFolder;

  const visibleTracks = useMemo(() => {
    return tracks.filter((t) => {
      if (effectiveSelectedFolder !== 'ALL' && (t.folderName || 'Nhạc trên máy') !== effectiveSelectedFolder) {
        return false;
      }
      if (formatFilter !== 'ALL' && t.formatCategory !== formatFilter) {
        return false;
      }
      return true;
    });
  }, [effectiveSelectedFolder, formatFilter, tracks]);

  const handleQuickScan = async () => {
    const handled = await onScanDirectoryFast();
    if (!handled) {
      folderInputRef.current?.click();
    }
  };

  const handleSaveFolder = (folderName: string) => {
    onSavePlaylist(folderName, folderName);
    setSavedNotice(`Đã lưu danh sách "${folderName}"`);
    setTimeout(() => setSavedNotice(null), 2600);
  };

  const handlePlayFolder = (folderName: string) => {
    const found = folders.find((f) => f.name === folderName);
    if (!found || found.tracks.length === 0) return;
    setSelectedFolder(folderName);
    onSelectTrack(found.tracks[0].id, true);
  };

  // Remote / D-pad keyboard shortcuts for Music TV
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'MediaPlayPause' || e.key === ' ') {
        e.preventDefault();
        if (isPlaying) onPause();
        else onPlay();
      } else if (e.key === 'MediaTrackNext') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'MediaTrackPrevious') {
        e.preventDefault();
        onPrevious();
      } else if (e.key === 'Escape') {
        onExitTvMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlaying, onExitTvMode, onNext, onPause, onPlay, onPrevious]);

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Hidden pickers */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            onLoadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            onLoadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Top TV Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-md px-5 sm:px-8 py-4">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onExitTvMode}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-800 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <ArrowLeft className="h-4 w-4" />
              Thoát Music TV
            </button>
            <div className="flex items-center gap-2">
              <Tv className="h-5 w-5 text-sky-600" />
              <span className="font-display text-lg font-bold text-slate-900">
                MusicToBlutooth
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-sm font-medium text-sky-700">Chế độ Music TV</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {savedNotice && (
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                {savedNotice}
              </span>
            )}
            <button
              type="button"
              onClick={handleQuickScan}
              disabled={isScanning}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
            >
              <FolderSearch className="h-4 w-4" />
              {isScanning && scanProgress
                ? `Đang quét ${scanProgress.scanned}/${scanProgress.total}...`
                : 'Quét thư mục nhạc'}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
            >
              <FolderUp className="h-4 w-4 text-sky-600" />
              Thêm bài
            </button>
            <button
              type="button"
              onClick={onOpenPairing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <Radio className="h-4 w-4" />
              Phòng {roomId} · {receiverCount} loa
            </button>
          </div>
        </div>
      </header>

      {/* Main 2-Column Living-Room Layout */}
      <main className="mx-auto w-full max-w-[1520px] flex-1 px-5 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Stage: Now Playing TV Card */}
        <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 space-y-6">
          <div className="flex flex-col sm:flex-row lg:flex-col items-center sm:items-start lg:items-center gap-6">
            <div className="relative h-56 w-56 sm:h-64 sm:w-64 rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden shadow-xs shrink-0">
              {activeTrack?.coverUrl && !heroImgError ? (
                <img
                  src={activeTrack.coverUrl}
                  alt={activeTrack ? `Ảnh bìa ${activeTrack.title}` : 'Ảnh bìa'}
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                  <Disc3 className={`h-16 w-16 ${isPlaying ? 'animate-spin' : ''}`} />
                </div>
              )}
            </div>

            <div className="w-full text-center sm:text-left lg:text-center min-w-0">
              <div className="flex flex-wrap items-center justify-center sm:justify-start lg:justify-center gap-2 text-xs text-slate-500">
                <span className={wsConnected ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                  {wsConnected ? 'Đang phát Wi-Fi' : 'Chế độ nội bộ'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{activeTrack?.folderName || 'Chưa chọn thư mục'}</span>
                {activeTrack && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{activeTrack.formatCategory}</span>
                  </>
                )}
              </div>

              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-slate-900 truncate">
                {activeTrack ? activeTrack.title : 'Chọn thư mục hoặc bài nhạc'}
              </h1>

              {isDecodingTrack ? (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-sky-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Đang giải mã âm thanh chất lượng cao...
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500 truncate">
                  {activeTrack ? activeTrack.formatLabel : 'Bấm Quét thư mục nhạc để nạp toàn bộ danh sách'}
                </p>
              )}
            </div>
          </div>

          {/* Spectrum bar */}
          <div className="flex h-10 items-end gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            {spectrumBands.map((val, i) => (
              <div
                key={i}
                className="flex-1 rounded-[1px] bg-sky-600/85 transition-transform duration-75 origin-bottom"
                style={{ height: '100%', transform: `scaleY(${Math.max(0.08, val)})` }}
              />
            ))}
          </div>

          {/* Crawling Tortoise Progress Bar */}
          <TortoiseProgressBar
            currentSec={currentPositionSec}
            durationSec={activeTrack?.durationSec || 0}
            isPlaying={isPlaying}
            peaks={activeTrack?.peaks || []}
            onSeek={onSeek}
          />

          {/* Large Remote-Friendly Transport Controls */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-pressed={shuffle}
              aria-label="Phát ngẫu nhiên"
              className={`rounded-xl border p-3.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-600 ${
                shuffle
                  ? 'border-sky-300 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Shuffle className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={onPrevious}
              aria-label="Bài trước"
              className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 p-3.5 text-slate-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <SkipBack className="h-5 w-5" />
            </button>

            {isPlaying ? (
              <button
                type="button"
                onClick={onPause}
                className="inline-flex items-center gap-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-7 py-4 text-sm font-semibold text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                <Pause className="h-5 w-5 fill-current" />
                Tạm dừng
              </button>
            ) : (
              <button
                type="button"
                onClick={onPlay}
                disabled={!activeTrack}
                className="inline-flex items-center gap-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 px-7 py-4 text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                <Play className="h-5 w-5 fill-current" />
                Phát nhạc
              </button>
            )}

            <button
              type="button"
              onClick={onNext}
              aria-label="Bài tiếp theo"
              className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 p-3.5 text-slate-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <SkipForward className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={loopTrack}
              aria-label="Lặp bài"
              className={`rounded-xl border p-3.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-600 ${
                loopTrack
                  ? 'border-sky-300 bg-sky-50 text-sky-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Repeat className="h-5 w-5" />
            </button>
          </div>

          {/* Local Speaker Output Volume */}
          <div className="flex items-center justify-center gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onToggleLocalMonitor}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer ${
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
              Loa máy này
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={localMonitorVolume}
              onChange={(e) => onChangeLocalMonitorVolume(Number(e.target.value))}
              aria-label="Âm lượng loa máy này"
              className="studio-slider w-36"
            />
          </div>
        </section>

        {/* Right Stage: Folders + Saved Playlists + Track Grid */}
        <section className="lg:col-span-7 space-y-5">
          {/* Folder Cards Grid */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900">
                Thư mục nhạc trên máy ({folders.length})
              </h2>
              {effectiveSelectedFolder !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setSelectedFolder('ALL')}
                  className="text-xs font-medium text-sky-600 hover:text-sky-700 cursor-pointer"
                >
                  Hiển thị tất cả ({tracks.length} bài)
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {folders.map((folder) => {
                const active = effectiveSelectedFolder === folder.name;
                return (
                  <div
                    key={folder.name}
                    className={`rounded-xl border p-3.5 transition-colors flex items-center justify-between gap-3 ${
                      active
                        ? 'border-sky-600 bg-sky-50'
                        : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedFolder(active ? 'ALL' : folder.name)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      {active ? (
                        <FolderOpen className="h-6 w-6 text-sky-600 shrink-0" />
                      ) : (
                        <Folder className="h-6 w-6 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {folder.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {folder.tracks.length} bài hát
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePlayFolder(folder.name)}
                        title={`Phát cả thư mục ${folder.name}`}
                        aria-label={`Phát cả thư mục ${folder.name}`}
                        className="rounded-lg bg-sky-600 hover:bg-sky-700 p-2 text-white cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveFolder(folder.name)}
                        title={`Lưu danh sách thư mục ${folder.name}`}
                        aria-label={`Lưu danh sách thư mục ${folder.name}`}
                        className="rounded-lg border border-slate-200 bg-white hover:bg-slate-100 p-2 text-slate-600 cursor-pointer"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Saved Playlists Row */}
            {savedPlaylists.length > 0 && (
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 mr-1">
                  <ListMusic className="h-3.5 w-3.5 text-emerald-600" />
                  Danh sách đã lưu:
                </span>
                {savedPlaylists.map((pl) => (
                  <div
                    key={pl.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-800"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (pl.folderName) setSelectedFolder(pl.folderName);
                        onLoadPlaylist(pl.id);
                      }}
                      className="font-medium hover:text-sky-600 cursor-pointer"
                    >
                      {pl.name} ({pl.trackIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePlaylist(pl.id)}
                      aria-label={`Xóa danh sách ${pl.name}`}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Track List inside Selected Folder */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-bold text-slate-900">
                {effectiveSelectedFolder === 'ALL'
                  ? `Tất cả bài hát (${visibleTracks.length})`
                  : `${effectiveSelectedFolder} (${visibleTracks.length} bài)`}
              </h2>

              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                {FORMAT_FILTERS.map((fmt) => {
                  const active = formatFilter === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormatFilter(fmt)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer ${
                        active ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {fmt === 'ALL' ? 'Tất cả' : fmt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[500px] overflow-y-auto pr-1">
              {visibleTracks.map((track, idx) => {
                const isActive = track.id === activeTrack?.id;
                const coverFailed = brokenCovers[track.id];
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => onSelectTrack(track.id, true)}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                      isActive
                        ? 'border-sky-600 bg-sky-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative h-12 w-12 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shrink-0">
                        {!coverFailed && track.coverUrl ? (
                          <img
                            src={track.coverUrl}
                            alt={`Ảnh bìa ${track.title}`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenCovers((prev) => ({ ...prev, [track.id]: true }))
                            }
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <Disc3 className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div
                          className={`truncate text-sm font-semibold ${
                            isActive ? 'text-sky-700' : 'text-slate-900'
                          }`}
                        >
                          {String(idx + 1).padStart(2, '0')}. {track.title}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 truncate">
                          {track.formatCategory} · {track.folderName}
                        </div>
                      </div>
                    </div>

                    <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                      {formatDuration(track.durationSec)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
