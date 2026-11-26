import type { AudioFormatCategory } from '../types/audio';

export const DEFAULT_VINYL_COVER = '/src/assets/images/cover_default_vinyl_1795684915825.jpg';

const ALT_COVERS = [
  '/src/assets/images/cover_acoustic_pulse_1795684914389.jpg',
  '/src/assets/images/cover_warm_lofi_1795684915197.jpg',
  '/src/assets/images/cover_stereo_sub_1795684915076.jpg',
  DEFAULT_VINYL_COVER,
];

export function classifyAudioFormat(fileName: string): AudioFormatCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'mp3') return 'MP3';
  if (ext === 'flac') return 'FLAC';
  if (ext === 'wav' || ext === 'wave') return 'WAV';
  if (ext === 'm4a' || ext === 'aac' || ext === 'mp4') return 'M4A';
  if (ext === 'ogg' || ext === 'opus') return 'OGG';
  return 'KHÁC';
}

export function getFallbackCoverForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return ALT_COVERS[Math.abs(hash) % ALT_COVERS.length];
}

/**
 * Extracts embedded album cover art from MP3 (ID3v2 APIC frame) or FLAC (METADATA_BLOCK_PICTURE)
 * directly in browser memory. Returns a data URL if found, or a clean fallback cover path.
 */
export function extractCoverArtFromBuffer(buffer: ArrayBuffer, fileName: string): string {
  try {
    const bytes = new Uint8Array(buffer);
    const id3Cover = extractId3v2Cover(bytes);
    if (id3Cover) return id3Cover;

    const flacCover = extractFlacCover(bytes);
    if (flacCover) return flacCover;
  } catch {
    // Fall back cleanly if metadata header is malformed
  }
  return getFallbackCoverForName(fileName);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function extractId3v2Cover(bytes: Uint8Array): string | null {
  if (bytes.length < 10) return null;
  // "ID3"
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;

  const majorVersion = bytes[3];
  const tagSize =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);

  const tagEnd = Math.min(bytes.length, 10 + tagSize);
  let pos = 10;

  while (pos + 10 < tagEnd) {
    const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    if (frameId === '\0\0\0\0') break;

    let frameSize = 0;
    if (majorVersion === 4) {
      frameSize =
        ((bytes[pos + 4] & 0x7f) << 21) |
        ((bytes[pos + 5] & 0x7f) << 14) |
        ((bytes[pos + 6] & 0x7f) << 7) |
        (bytes[pos + 7] & 0x7f);
    } else {
      frameSize =
        (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
    }

    if (frameSize <= 0 || pos + 10 + frameSize > tagEnd) break;

    if (frameId === 'APIC') {
      const frameData = bytes.subarray(pos + 10, pos + 10 + frameSize);
      const encoding = frameData[0];
      let ptr = 1;

      // Read MIME type (null-terminated ASCII)
      let mime = '';
      while (ptr < frameData.length && frameData[ptr] !== 0) {
        mime += String.fromCharCode(frameData[ptr]);
        ptr++;
      }
      ptr++; // skip null
      if (ptr >= frameData.length) return null;

      ptr++; // skip picture type byte

      // Skip description (terminated by 0x00 or 0x00 0x00 for UTF-16)
      if (encoding === 1 || encoding === 2) {
        while (ptr + 1 < frameData.length && !(frameData[ptr] === 0 && frameData[ptr + 1] === 0)) {
          ptr += 2;
        }
        ptr += 2;
      } else {
        while (ptr < frameData.length && frameData[ptr] !== 0) {
          ptr++;
        }
        ptr++;
      }

      if (ptr < frameData.length) {
        const imgBytes = frameData.subarray(ptr);
        const safeMime = mime.startsWith('image/') ? mime : 'image/jpeg';
        return `data:${safeMime};base64,${uint8ToBase64(imgBytes)}`;
      }
    }

    pos += 10 + frameSize;
  }

  return null;
}

function extractFlacCover(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  // "fLaC"
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;

  let pos = 4;
  while (pos + 4 < bytes.length) {
    const header = bytes[pos];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLen = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;

    if (pos + blockLen > bytes.length) break;

    if (blockType === 6) {
      // METADATA_BLOCK_PICTURE
      const view = new DataView(bytes.buffer, bytes.byteOffset + pos, blockLen);
      let p = 4; // skip picture type
      const mimeLen = view.getUint32(p, false);
      p += 4;
      let mime = '';
      for (let i = 0; i < mimeLen && p + i < blockLen; i++) {
        mime += String.fromCharCode(bytes[pos + p + i]);
      }
      p += mimeLen;
      const descLen = view.getUint32(p, false);
      p += 4 + descLen + 16; // skip width, height, depth, colors
      const dataLen = view.getUint32(p, false);
      p += 4;

      if (p + dataLen <= blockLen) {
        const imgBytes = bytes.subarray(pos + p, pos + p + dataLen);
        const safeMime = mime.startsWith('image/') ? mime : 'image/jpeg';
        return `data:${safeMime};base64,${uint8ToBase64(imgBytes)}`;
      }
    }

    pos += blockLen;
    if (isLast) break;
  }

  return null;
}
