import type { SavedTown } from './types';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TIDE_CHUNK = 'ltID';
const FORMAT = 'little-tides-postcard';
const MAX_POSTCARD_BYTES = 30 * 1024 * 1024;
const MAX_TIDE_BYTES = 5 * 1024 * 1024;

type TidePostcard = {
  format: typeof FORMAT;
  formatVersion: 1;
  exportedAt: string;
  town: SavedTown;
};

export class TidePostcardError extends Error {}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(payload.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, payload.length);
  result.set(typeBytes, 4);
  result.set(payload, 8);
  view.setUint32(payload.length + 8, crc32(result.subarray(4, payload.length + 8)));
  return result;
}

function isPng(bytes: Uint8Array) {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function isSavedTown(value: unknown): value is SavedTown {
  if (!value || typeof value !== 'object') return false;
  const town = value as Partial<SavedTown>;
  const validVersion = town.version === 10;
  const validCells = Array.isArray(town.cells) && town.cells.length <= 1024 && town.cells.every((cell) =>
    cell && typeof cell === 'object'
    && Number.isFinite(cell.x) && Number.isFinite(cell.z)
    && Number.isFinite(cell.height) && Number.isFinite(cell.color)
    && Number.isFinite(cell.placedAt));
  return validVersion && Number.isFinite(town.seed) && validCells;
}

export async function makeTidePostcard(png: Blob, town: SavedTown) {
  const pngBytes = new Uint8Array(await png.arrayBuffer());
  if (!isPng(pngBytes)) throw new TidePostcardError('The captured image was not a PNG.');

  const postcard: TidePostcard = {
    format: FORMAT,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    town,
  };
  const tideBytes = new TextEncoder().encode(JSON.stringify(postcard));
  if (tideBytes.length > MAX_TIDE_BYTES) throw new TidePostcardError('This tide is too large to fit in a postcard.');

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= pngBytes.length) {
    const length = new DataView(pngBytes.buffer, pngBytes.byteOffset + offset, 4).getUint32(0);
    const end = offset + length + 12;
    if (end > pngBytes.length) break;
    const type = new TextDecoder('ascii').decode(pngBytes.subarray(offset + 4, offset + 8));
    if (type === 'IEND') {
      return new Blob([
        pngBytes.subarray(0, offset),
        chunk(TIDE_CHUNK, tideBytes),
        pngBytes.subarray(offset),
      ], { type: 'image/png' });
    }
    offset = end;
  }
  throw new TidePostcardError('The captured PNG was incomplete.');
}

export async function readTidePostcard(file: Blob): Promise<SavedTown> {
  if (file.size > MAX_POSTCARD_BYTES) throw new TidePostcardError('That postcard is too large to open.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPng(bytes)) throw new TidePostcardError('Choose a Little Tides PNG postcard.');

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const end = offset + length + 12;
    if (end > bytes.length) throw new TidePostcardError('This PNG appears to be damaged.');
    const type = new TextDecoder('ascii').decode(bytes.subarray(offset + 4, offset + 8));
    if (type === TIDE_CHUNK) {
      if (length > MAX_TIDE_BYTES) throw new TidePostcardError('The saved tide in this postcard is too large.');
      const expectedCrc = new DataView(bytes.buffer, bytes.byteOffset + offset + 8 + length, 4).getUint32(0);
      const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
      if (actualCrc !== expectedCrc) throw new TidePostcardError('The saved tide in this postcard appears to be damaged.');
      try {
        const postcard = JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + length))) as Partial<TidePostcard>;
        if (postcard.format !== FORMAT || postcard.formatVersion !== 1 || !isSavedTown(postcard.town)) throw new Error();
        return postcard.town;
      } catch {
        throw new TidePostcardError('The saved tide in this postcard could not be read.');
      }
    }
    if (type === 'IEND') break;
    offset = end;
  }
  throw new TidePostcardError('This is a PNG, but it does not contain a saved Little Tides town.');
}
