import { useMemo, useRef, useState, type FC } from 'react';
import {
  BookmarkPlus,
  Disc3,
  FolderSearch,
  FolderUp,
  ListMusic,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import type { AudioFormatCategory, DecodedTrack, SavedPlaylist } from '../types/audio';

interface TrackLibraryProps {
  tracks: DecodedTrack[];
  activeTrackId: string | null;
  savedPlaylists: SavedPlaylist[];
  isPlaying: boolean;
  isScanning: boolean;
  scanProgress: { scanned: number; total: number } | null;
  decodeError: string | null;
  onSelectTrack: (trackId: string, autoPlay?: boolean) => void;
  onRemoveTrack: (trackId: string) => void;
  onLoadFiles: (files: FileList | File[]) => void;
  onScanDirectoryFast: () => Promise<boolean>;
  onSavePlaylist: (name: string) => void;
  onLoadPlaylist: (playlistId: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const FORMAT_TABS: ('ALL' | AudioFormatCategory)[] = ['ALL', 'MP3', 'FLAC', 'WAV', 'M4A', 'OGG', 'PCM'];

export const TrackLibrary: FC<TrackLibraryProps> = ({
  tracks,
  activeTrackId,
  savedPlaylists,
  isPlaying,
  isScanning,
  scanProgress,
  decodeError,
  onSelectTrack,
  onRemoveTrack,
  onLoadFiles,
  onScanDirectoryFast,
  onSavePlaylist,
  onLoadPlaylist,
  onDeletePlaylist,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [formatFilter, setFormatFilter] = useState<'ALL' | AudioFormatCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [playlistName, setPlaylistName] = useState('');

  const formatCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: tracks.length };
    for (const t of tracks) {
      counts[t.formatCategory] = (counts[t.formatCategory] || 0) + 1;
    }
    return counts;
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tracks.filter((t) => {
      if (formatFilter !== 'ALL' && t.formatCategory !== formatFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.formatLabel.toLowerCase().includes(q) ||
        t.artistOrSource.toLowerCase().includes(q)
      );
    });
  }, [formatFilter, searchQuery, tracks]);

  const handleQuickFolderScan = async () => {
    const handled = await onScanDirectoryFast();
    if (!handled) {
      folderInputRef.current?.click();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onLoadFiles(e.dataTransfer.files);
    }
  };

  const handleSavePlaylistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistName.trim()) return;
    onSavePlaylist(playlistName.trim());
    setPlaylistName('');
    setShowSaveForm(false);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Kho nhạc & Danh sách phát
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Quét nhanh thư mục nhạc, phân loại định dạng và lưu danh sách phát ngay trên máy.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

          <button
            type="button"
            onClick={handleQuickFolderScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 px-3 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <FolderSearch className="h-3.5 w-3.5" />
            {isScanning && scanProgress
              ? `Đang quét ${scanProgress.scanned}/${scanProgress.total}...`
              : 'Quét nhạc nhanh'}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <FolderUp className="h-3.5 w-3.5 text-sky-600" />
            Thêm bài
          </button>

          <button
            type="button"
            onClick={() => setShowSaveForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-emerald-600" />
            Lưu danh sách
          </button>
        </div>
      </div>

      {/* Save Playlist Inline Form */}
      {showSaveForm && (
        <form
          onSubmit={handleSavePlaylistSubmit}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <input
            type="text"
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            placeholder="Nhập tên danh sách phát (ví dụ: Nhạc Phòng Khách)..."
            className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
          >
            Lưu ({tracks.length} bài)
          </button>
          <button
            type="button"
            onClick={() => setShowSaveForm(false)}
            className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Hủy
          </button>
        </form>
      )}

      {/* Saved Playlists Strip */}
      {savedPlaylists.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <ListMusic className="h-3.5 w-3.5 text-sky-600" />
            <span>Danh sách đã lưu ({savedPlaylists.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {savedPlaylists.map((pl) => (
              <div
                key={pl.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
              >
                <button
                  type="button"
                  onClick={() => onLoadPlaylist(pl.id)}
                  className="font-medium hover:text-sky-600 cursor-pointer"
                >
                  {pl.name} ({pl.trackIds.length} bài)
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
        </div>
      )}

      {/* Drag & Drop Quick Add Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-lg border border-dashed px-3.5 py-2.5 text-xs transition-colors ${
          dragging
            ? 'border-sky-600 bg-sky-50 text-sky-800'
            : 'border-slate-200 bg-slate-50/70 text-slate-500'
        }`}
      >
        Kéo thả cả thư mục hoặc nhiều tệp nhạc (MP3, FLAC, WAV, M4A, OGG) vào đây để tự động trích xuất ảnh cover và lưu vào trình duyệt.
      </div>

      {decodeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
          {decodeError}
        </div>
      )}

      {/* Search + Format Classification Tabs */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tên bài hát hoặc định dạng..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg border border-slate-200 bg-slate-50">
          {FORMAT_TABS.map((fmt) => {
            const count = formatCounts[fmt] || 0;
            const active = formatFilter === fmt;
            if (fmt !== 'ALL' && count === 0 && !active) return null;
            return (
              <button
                key={fmt}
                type="button"
                onClick={() => setFormatFilter(fmt)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {fmt === 'ALL' ? 'Tất cả' : fmt} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Track List with Cover Art */}
      <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto pr-1">
        {filteredTracks.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Không có bài hát nào khớp với định dạng {formatFilter}.
          </div>
        ) : (
          filteredTracks.map((track, idx) => {
            const isActive = track.id === activeTrackId;
            return (
              <div
                key={track.id}
                className={`flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg transition-colors ${
                  isActive ? 'bg-sky-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectTrack(track.id, true)}
                  className="flex flex-1 items-center gap-3 min-w-0 text-left cursor-pointer"
                >
                  <div className="relative h-11 w-11 rounded-md border border-slate-200 bg-slate-100 overflow-hidden shrink-0">
                    <img
                      src={track.coverUrl}
                      alt={`Ảnh bìa ${track.title}`}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                    <div
                      className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                        isActive
                          ? 'bg-slate-900/45 text-white opacity-100'
                          : 'bg-slate-900/35 text-white opacity-0 hover:opacity-100'
                      }`}
                    >
                      {isActive && isPlaying ? (
                        <Disc3 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 fill-current" />
                      )}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div
                      className={`truncate text-sm font-medium ${
                        isActive ? 'text-sky-700' : 'text-slate-900'
                      }`}
                    >
                      {String(idx + 1).padStart(2, '0')}. {track.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 truncate">
                      <span>{track.formatCategory}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{track.artistOrSource}</span>
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {formatDuration(track.durationSec)}
                  </span>
                  {!track.isBuiltIn && (
                    <button
                      type="button"
                      onClick={() => onRemoveTrack(track.id)}
                      aria-label={`Xóa ${track.title}`}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
