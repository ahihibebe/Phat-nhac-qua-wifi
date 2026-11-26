import type { AudioFormatCategory, SavedPlaylist } from '../types/audio';

const DB_NAME = 'MusicToBlutoothStorage';
const DB_VERSION = 2;
const STORE_FILES = 'audio_files';
const PLAYLISTS_KEY = 'mtb_saved_playlists_v1';

export interface StoredAudioFileRecord {
  id: string;
  fileName: string;
  title: string;
  folderName: string;
  formatCategory: AudioFormatCategory;
  coverUrl: string;
  durationSec: number;
  fileSizeBytes: number;
  blob?: Blob;
  localMediaUrl?: string;
  addedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAudioFileRecord(record: StoredAudioFileRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      tx.objectStore(STORE_FILES).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export async function saveAudioFileRecordsBatch(records: StoredAudioFileRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function loadAllStoredAudioFiles(): Promise<StoredAudioFileRecord[]> {
  try {
    const db = await openDb();
    const records = await new Promise<StoredAudioFileRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const req = tx.objectStore(STORE_FILES).getAll();
      req.onsuccess = () => resolve((req.result as StoredAudioFileRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function deleteStoredAudioFile(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      tx.objectStore(STORE_FILES).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export function loadSavedPlaylists(): SavedPlaylist[] {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPlaylist[]) : [];
  } catch {
    return [];
  }
}

export function persistSavedPlaylists(playlists: SavedPlaylist[]): void {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch {
    // ignore
  }
}
