import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { DeviceMatrix } from './components/DeviceMatrix';
import { PairingModal } from './components/PairingModal';
import { ReceiverView } from './components/ReceiverView';
import { ReleaseSection } from './components/ReleaseSection';
import { TopBar, type ConsoleTab } from './components/TopBar';
import { TrackLibrary } from './components/TrackLibrary';
import { TransportConsole } from './components/TransportConsole';
import { useHostStreamer } from './hooks/useHostStreamer';

function getInitialUrlState(): { role: 'host' | 'receiver'; roomId: string } {
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role');
  const roomParam = (params.get('room') || 'MB48').trim().toUpperCase().slice(0, 12) || 'MB48';
  return {
    role: roleParam === 'receiver' ? 'receiver' : 'host',
    roomId: roomParam,
  };
}

function HostDashboard({
  roomId,
  onChangeRoomId,
  onSwitchToStandaloneReceiver,
}: {
  roomId: string;
  onChangeRoomId: (room: string) => void;
  onSwitchToStandaloneReceiver: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('console');
  const [pairingOpen, setPairingOpen] = useState(false);
  const [releasesOpen, setReleasesOpen] = useState(false);

  const host = useHostStreamer(roomId);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.delete('role');
    window.history.replaceState({}, '', url.toString());
  }, [roomId]);

  if (activeTab === 'receiver') {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        <TopBar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onOpenPairing={() => setPairingOpen(true)}
          receiverCount={host.receivers.length}
        />
        <ReceiverView
          roomId={roomId}
          onChangeRoomId={onChangeRoomId}
          onBackToHost={() => setActiveTab('console')}
          isStandaloneReceiver={false}
        />
        <PairingModal
          open={pairingOpen}
          onClose={() => setPairingOpen(false)}
          roomId={roomId}
          onChangeRoomId={onChangeRoomId}
          onSwitchToReceiver={onSwitchToStandaloneReceiver}
        />
      </div>
    );
  }

  return (
    <div id="top" className="min-h-screen flex flex-col bg-white text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenPairing={() => setPairingOpen(true)}
        receiverCount={host.receivers.length}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 py-6 space-y-6">
        {activeTab === 'console' && (
          <>
            <TransportConsole
              activeTrack={host.activeTrack}
              isPlaying={host.isPlaying}
              isDecodingTrack={host.isDecodingTrack}
              loopTrack={host.loopTrack}
              onToggleLoop={() => host.setLoopTrack((v) => !v)}
              shuffle={host.shuffle}
              onToggleShuffle={() => host.setShuffle((v) => !v)}
              currentPositionSec={host.currentPositionSec}
              settings={host.settings}
              wsConnected={host.wsConnected}
              receiverCount={host.receivers.length}
              packetsSent={host.metrics.packetsSent}
              kbps={host.metrics.kbps}
              spectrumBands={host.spectrumBands}
              localMonitorEnabled={host.localMonitorEnabled}
              onToggleLocalMonitor={() => host.setLocalMonitorEnabled((v) => !v)}
              localMonitorVolume={host.localMonitorVolume}
              onChangeLocalMonitorVolume={host.setLocalMonitorVolume}
              onPlay={() => host.startPlayback()}
              onPause={host.pausePlayback}
              onStop={host.stopAndRewind}
              onNext={host.nextTrack}
              onPrevious={host.previousTrack}
              onSeek={host.seekTo}
              onUpdateSettings={host.updateStreamSettings}
            />

            <TrackLibrary
              tracks={host.tracks}
              activeTrackId={host.activeTrack?.id || null}
              savedPlaylists={host.savedPlaylists}
              isPlaying={host.isPlaying}
              isScanning={host.isScanning}
              scanProgress={host.scanProgress}
              decodeError={host.decodeError}
              onSelectTrack={host.selectTrack}
              onRemoveTrack={host.removeTrack}
              onLoadFiles={host.loadLocalAudioFiles}
              onScanDirectoryFast={host.scanDirectoryFast}
              onSavePlaylist={host.saveCurrentPlaylist}
              onLoadPlaylist={host.loadPlaylist}
              onDeletePlaylist={host.deletePlaylist}
            />
          </>
        )}

        {activeTab === 'devices' && (
          <DeviceMatrix
            receivers={host.receivers}
            roomId={roomId}
            onUpdateDevice={host.updateDevice}
            onSendTestTone={host.sendTestTone}
            onKickDevice={host.kickDevice}
            onOpenPairing={() => setPairingOpen(true)}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 py-4 px-6 text-xs text-slate-500 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4">
          <span>MusicToBlutooth · Phòng đồng bộ {roomId}</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setReleasesOpen(true)}
              className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Phiên bản APK (Truyền & Nhận)
            </button>
            <button
              type="button"
              onClick={() => setPairingOpen(true)}
              className="text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Hướng dẫn ghép nối điện thoại qua Wi-Fi
            </button>
          </div>
        </div>
      </footer>

      <PairingModal
        open={pairingOpen}
        onClose={() => setPairingOpen(false)}
        roomId={roomId}
        onChangeRoomId={onChangeRoomId}
        onSwitchToReceiver={onSwitchToStandaloneReceiver}
      />

      {releasesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Phát hành Android APK song song"
          onClick={() => setReleasesOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setReleasesOpen(false)}
              aria-label="Đóng cửa sổ tải APK"
              className="absolute right-4 top-4 z-10 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <ReleaseSection />
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const initial = getInitialUrlState();
  const [role, setRole] = useState<'host' | 'receiver'>(initial.role);
  const [roomId, setRoomId] = useState<string>(initial.roomId);

  const switchToStandaloneReceiver = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('role', 'receiver');
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url.toString());
    setRole('receiver');
  };

  const switchToHost = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('role');
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url.toString());
    setRole('host');
  };

  if (role === 'receiver') {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        <header className="border-b border-slate-200 bg-white/95 px-4 py-3.5">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
            <span className="font-display text-base font-bold text-slate-900">
              MusicToBlutooth
            </span>
            <button
              type="button"
              onClick={switchToHost}
              className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 cursor-pointer"
            >
              Chế độ Máy chủ
            </button>
          </div>
        </header>
        <ReceiverView
          roomId={roomId}
          onChangeRoomId={setRoomId}
          isStandaloneReceiver={true}
        />
      </div>
    );
  }

  return (
    <HostDashboard
      roomId={roomId}
      onChangeRoomId={setRoomId}
      onSwitchToStandaloneReceiver={switchToStandaloneReceiver}
    />
  );
}
