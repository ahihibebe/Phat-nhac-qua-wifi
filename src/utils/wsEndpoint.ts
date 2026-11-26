export interface AndroidBridgeConfig {
  androidRole?: 'host' | 'receiver';
  wsUrl?: string;
  lanOrigin?: string;
  discoveredHostOrigin?: string;
}

export interface AndroidScannedSong {
  id: string;
  title: string;
  artist: string;
  folderName: string;
  formatCategory: string;
  durationSec: number;
  fileSizeBytes: number;
  localMediaUrl: string;
  coverUrl: string;
}

declare global {
  interface Window {
    __MTB_CONFIG__?: AndroidBridgeConfig;
    __MTB_ANDROID__?: {
      getDiscoveredHost?: () => string;
      getLanOrigin?: () => string;
      getWsUrl?: () => string;
      getRole?: () => string;
      scanDeviceMusic?: () => string;
    };
  }
}

const CUSTOM_ORIGIN_KEY = 'mtb_custom_server_origin';

export function isRunningInAndroidApk(): boolean {
  return (
    Boolean(window.__MTB_ANDROID__?.getRole?.()) ||
    Boolean(window.__MTB_CONFIG__?.androidRole) ||
    window.location.hostname === 'appassets.androidplatform.net'
  );
}

export function getSavedServerOrigin(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('server');
    if (fromQuery) return fromQuery.trim().replace(/\/+$/, '');
    return localStorage.getItem(CUSTOM_ORIGIN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveServerOrigin(origin: string): void {
  try {
    const cleaned = origin.trim().replace(/\/+$/, '');
    if (cleaned) {
      localStorage.setItem(CUSTOM_ORIGIN_KEY, cleaned);
    } else {
      localStorage.removeItem(CUSTOM_ORIGIN_KEY);
    }
  } catch {
    // ignore
  }
}

export function getAppBaseOrigin(): string {
  const custom = getSavedServerOrigin();
  if (custom) return custom;

  const nativeLan = window.__MTB_ANDROID__?.getLanOrigin?.();
  if (nativeLan) return nativeLan.replace(/\/+$/, '');

  if (window.__MTB_CONFIG__?.lanOrigin) {
    return window.__MTB_CONFIG__.lanOrigin.replace(/\/+$/, '');
  }

  const discovered =
    window.__MTB_ANDROID__?.getDiscoveredHost?.() ||
    window.__MTB_CONFIG__?.discoveredHostOrigin;
  if (discovered) return discovered.replace(/\/+$/, '');

  if (window.location.hostname === 'appassets.androidplatform.net') {
    return '';
  }

  return window.location.origin;
}

export function getWebSocketUrl(overrideOrigin?: string): string {
  if (overrideOrigin) {
    const clean = overrideOrigin.trim().replace(/\/+$/, '');
    if (clean.startsWith('ws://') || clean.startsWith('wss://')) {
      return clean.endsWith('/ws') ? clean : `${clean}/ws`;
    }
    if (clean.startsWith('https://')) {
      return `wss://${clean.slice(8)}/ws`;
    }
    if (clean.startsWith('http://')) {
      return `ws://${clean.slice(7)}/ws`;
    }
    return `ws://${clean}/ws`;
  }

  const saved = getSavedServerOrigin();
  if (saved) {
    return getWebSocketUrl(saved);
  }

  const nativeWs = window.__MTB_ANDROID__?.getWsUrl?.();
  if (nativeWs) {
    return nativeWs;
  }

  if (window.__MTB_CONFIG__?.wsUrl) {
    return window.__MTB_CONFIG__.wsUrl;
  }

  const discovered = window.__MTB_ANDROID__?.getDiscoveredHost?.();
  if (discovered) {
    return getWebSocketUrl(discovered);
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function getApiBaseUrl(): string {
  const origin = getAppBaseOrigin();
  return origin || '';
}
