import { useEffect, useState, type FC } from 'react';
import { Download, FolderArchive, RefreshCw, Smartphone } from 'lucide-react';
import type { ReleasePayload } from '../types/audio';

const REPO_STORAGE_KEY = 'mtb_github_repo_slug';

export const ReleaseSection: FC = () => {
  const [repoSlug, setRepoSlug] = useState(() => localStorage.getItem(REPO_STORAGE_KEY) || '');
  const [repoInput, setRepoInput] = useState(repoSlug);
  const [release, setRelease] = useState<ReleasePayload | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRelease = async (slug: string) => {
    setLoading(true);
    try {
      const url = slug.trim()
        ? `/api/releases?repo=${encodeURIComponent(slug.trim())}`
        : '/api/releases';
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as ReleasePayload;
        setRelease(data);
      }
    } catch {
      // ignore fetch error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRelease(repoSlug);
  }, [repoSlug]);

  const handleBindRepo = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = repoInput.trim();
    localStorage.setItem(REPO_STORAGE_KEY, cleaned);
    setRepoSlug(cleaned);
  };

  return (
    <section
      id="releases"
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-900">Phát hành Android APK song song</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-sky-700">{release?.version || 'v1.0.0'}</span>
            <span aria-hidden="true">·</span>
            <span>{release?.publishedAt || '2026-11-26'}</span>
            {release?.source === 'github' && release.repoSlug && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-600 font-medium">Đã đồng bộ GitHub Releases ({release.repoSlug})</span>
              </>
            )}
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-slate-900">
            Tải ứng dụng Android (Bản Truyền & Bản Nhận)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {release?.releaseNotes ||
              'Hai bản APK tách biệt chạy song song: Bản Truyền dùng cho máy phát nhạc chính, Bản Nhận cài trên từng điện thoại gắn loa Bluetooth.'}
          </p>
        </div>

        <a
          href="/api/download/android-project.zip"
          download="MusicToBlutooth-Android-DualAPK.zip"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FolderArchive className="h-4 w-4 text-sky-600" />
          Tải mã nguồn Gradle + CI (.zip)
        </a>
      </div>

      {/* Parallel APK Cards: Transmitter & Receiver */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(release?.assets || []).map((asset) => {
          const isTransmitter = asset.role === 'transmitter';
          return (
            <div
              key={asset.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-5 space-y-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Smartphone className={`h-4 w-4 ${isTransmitter ? 'text-sky-600' : 'text-emerald-600'}`} />
                    {asset.title}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{asset.version}</span>
                </div>

                <div className="mt-2 font-mono text-sm font-semibold text-slate-900">
                  {asset.fileName}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                  {asset.packageId} · {asset.sizeLabel}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {asset.description}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <a
                  href={asset.downloadUrl}
                  download={asset.downloadUrl.startsWith('/api/') ? undefined : asset.fileName}
                  target={asset.downloadUrl.startsWith('http') ? '_blank' : undefined}
                  rel={asset.downloadUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                    isTransmitter
                      ? 'bg-slate-900 hover:bg-slate-800 text-white'
                      : 'bg-sky-600 hover:bg-sky-700 text-white'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  {release?.source === 'github'
                    ? `Tải ${asset.fileName}`
                    : `Tải gói build ${isTransmitter ? 'Bản Truyền' : 'Bản Nhận'}`}
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* Optional GitHub Repository Release Linker */}
      <form
        onSubmit={handleBindRepo}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
      >
        <div className="text-xs text-slate-600">
          <span className="font-medium text-slate-800">Liên kết GitHub Release trực tiếp:</span>{' '}
          Nhập <code className="font-mono text-slate-800">owner/repo</code> đã chạy workflow{' '}
          <code className="font-mono text-slate-800">build-apks.yml</code> để gắn link tải .apk trực tiếp lên trang chủ.
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="vd: username/MusicToBlutooth"
            className="flex-1 sm:w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Đồng bộ
          </button>
        </div>
      </form>
    </section>
  );
};
