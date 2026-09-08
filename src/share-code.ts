import { isSavedTown } from './tide-postcard';
import type { SavedTown } from './types';

export const SHARE_CODE_PARAM = 't';
/** Typical towns stay below this size. Larger codes still work but the UI warns. */
export const SHARE_CODE_COMFORTABLE_BYTES = 8 * 1024;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

export async function encodeShareCode(town: SavedTown) {
  const json = new TextEncoder().encode(JSON.stringify(town));
  const compressed = await pipeThrough(json, new CompressionStream('deflate-raw'));
  return bytesToBase64Url(compressed);
}

export async function decodeShareCode(code: string): Promise<SavedTown | null> {
  try {
    const compressed = base64UrlToBytes(code.trim());
    const json = await pipeThrough(compressed, new DecompressionStream('deflate-raw'));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(json));
    return isSavedTown(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function shareUrl(code: string, base = location.href) {
  const url = new URL(base);
  url.hash = `${SHARE_CODE_PARAM}=${code}`;
  return url.toString();
}

export function shareCodeFromLocation(hash = location.hash) {
  const match = /^#?t=([A-Za-z0-9_-]+)/.exec(hash);
  return match ? match[1] : null;
}

export function shareCodeSupported() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}
