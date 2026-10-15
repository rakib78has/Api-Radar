import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { crc32 } from './crc32.ts';

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  readonly path: string;
  readonly data: Uint8Array;
}

/** 1980-01-01 00:00:00, the earliest MS-DOS timestamp, so builds are byte-for-byte reproducible. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** General-purpose flag bit 11: file names are UTF-8. */
const UTF8_FLAG = 0x0800;

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function assertSafePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(path)}`);
  }
}

/**
 * Creates a deterministic ZIP archive: entries sorted by path, fixed
 * timestamps, no extra fields or file attributes. The same input always
 * gives the same bytes, so release checksums can be reproduced.
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of sorted) {
    assertSafePath(entry.path);
    if (seen.has(entry.path)) {
      throw new Error(`Duplicate archive path: ${entry.path}`);
    }
    seen.add(entry.path);

    const name = encoder.encode(entry.path);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    const method = stored ? 0 : 8;
    const checksum = crc32(entry.data);

    const common = [
      u16(20), // version needed to extract
      u16(UTF8_FLAG),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(checksum),
      u32(body.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0), // extra field length
    ];
    const local = concat([u32(0x04034b50), ...common, name, body]);
    const central = concat([
      u32(0x02014b50),
      u16(20), // version made by: MS-DOS, spec 2.0
      ...common,
      u16(0), // comment length
      u16(0), // disk number
      u16(0), // internal attributes
      u32(0), // external attributes
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
    if (offset > 0xffffffff) {
      throw new Error('Archive too large (ZIP64 is not supported)');
    }
  }

  const centralDirectory = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(sorted.length),
    u16(sorted.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralDirectory, end]);
}

/**
 * Reads an archive written by createZip (stored or deflated entries, no
 * ZIP64), checking every CRC. Used to verify release archives.
 */
export function readZip(archive: Uint8Array): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const endOffset = archive.length - 22;
  if (endOffset < 0 || view.getUint32(endOffset, true) !== 0x06054b50) {
    throw new Error('Not a ZIP archive (no end-of-central-directory record)');
  }
  const count = view.getUint16(endOffset + 10, true);
  let pointer = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error('Corrupt central directory');
    }
    const method = view.getUint16(pointer + 10, true);
    const checksum = view.getUint32(pointer + 16, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const path = decoder.decode(archive.subarray(pointer + 46, pointer + 46 + nameLength));
    assertSafePath(path);

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const body = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? body : method === 8 ? new Uint8Array(inflateRawSync(body)) : null;
    if (data === null) {
      throw new Error(`${path}: unsupported compression method ${String(method)}`);
    }
    if (crc32(data) !== checksum) {
      throw new Error(`${path}: CRC mismatch`);
    }
    entries.push({ path, data });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
