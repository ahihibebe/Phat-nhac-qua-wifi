import type { FC } from 'react';

export type ConsoleTab = 'console' | 'devices' | 'receiver';

interface TopBarProps {
  activeTab: ConsoleTab;
  onSelectTab: (tab: ConsoleTab) => void;
  onOpenPairing: () => void;
  receiverCount: number;
}

export const TopBar: FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onOpenPairing,
  receiverCount,
}) => {
  const navItems: { id: ConsoleTab; label: string }[] = [
    { id: 'console', label: 'Bảng điều khiển' },
    { id: 'devices', label: `Thiết bị nhận (${receiverCount})` },
    { id: 'receiver', label: 'Chế độ Máy nhận' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('console');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          MusicToBlutooth
        </a>

        <nav className="hidden md:flex items-center gap-7" aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-sm ${
                  active
                    ? 'text-sky-600'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-sky-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenPairing}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"
          >
            Mời thiết bị
          </button>
        </div>
      </div>

      {/* Mobile navigation row */}
      <div className="flex md:hidden items-center gap-3 overflow-x-auto border-t border-slate-200 px-4 py-2 bg-slate-50/70">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`text-xs font-medium py-1 px-2.5 rounded whitespace-nowrap shrink-0 ${
                active ? 'text-sky-700 bg-sky-100' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </header>
  );
};
