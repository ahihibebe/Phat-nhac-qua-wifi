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
      getDeviceName?: () => string;
      getBluetoothSpeakerName?: () => string;
      setBackgroundPlayback?: (active: boolean, title: string, subtitle: string) => void;
      scanDeviceMusic?: () => string;
    };
  }
}

const CUSTOM_ORIGIN_KEY = 'mtb_custom_server_origin';

export function detectDeviceIdentityName(): string {
  const nativeName = window.__MTB_ANDROID__?.getDeviceName?.()?.trim();
  if (nativeName) return nativeName;

  const ua = navigator.userAgent || '';
  // Try extracting Android model token e.g. "(Linux; Android 14; SM-S918B Build/...)"
  const androidMatch = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i);
  if (androidMatch && androidMatch[1]) {
    const model = androidMatch[1].trim();
    if (model && model.toUpperCase() !== 'K' && model.toLowerCase() !== 'wv') {
      return model;
    }
  }

  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows NT/i.test(ua)) return 'Windows PC';
  if (/Android/i.test(ua)) return 'Điện thoại Android';
  if (/Linux/i.test(ua)) return 'Thiết bị Linux';
  return 'Thiết bị nhận Wi-Fi';
}

export async function resolveHighEntropyDeviceName(): Promise<string> {
  const nativeName = window.__MTB_ANDROID__?.getDeviceName?.()?.trim();
  if (nativeName) return nativeName;

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string }>;
    };
  };

  if (nav.userAgentData?.getHighEntropyValues) {
    try {
      const info = await nav.userAgentData.getHighEntropyValues(['model', 'platform']);
      const model = info.model?.trim();
      if (model) return model;
    } catch {
      // ignore UA-CH error
    }
  }

  return detectDeviceIdentityName();
}

export function detectBluetoothSpeakerLabel(): string {
  const nativeBt = window.__MTB_ANDROID__?.getBluetoothSpeakerName?.()?.trim();
  if (nativeBt) return nativeBt;
  return 'Loa Bluetooth đang kết nối';
}

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
