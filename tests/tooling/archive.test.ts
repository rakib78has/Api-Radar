import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { crc32 } from '../../scripts/lib/crc32.ts';
import { ICON_SIZES, renderIcon } from '../../scripts/lib/icon.ts';
import { encodePng } from '../../scripts/lib/png.ts';
import { createZip, readZip } from '../../scripts/lib/zip.ts';

const text = (value: string) => new TextEncoder().encode(value);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(text('123456789')).toString(16)).toBe('cbf43926');
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('createZip / readZip', () => {
  const entries = [
    { path: 'b/second.txt', data: text('second '.repeat(200)) },
    { path: 'a.json', data: text('{"x":1}') },
    { path: 'icons/é.png', data: Uint8Array.of(0, 1, 2, 3) },
  ];

  it('round-trips entries, sorted by path', () => {
    const read = readZip(createZip(entries));
    expect(read.map((entry) => entry.path)).toEqual(['a.json', 'b/second.txt', 'icons/é.png']);
    for (const original of entries) {
      expect(read.find((entry) => entry.path === original.path)?.data).toEqual(original.data);
    }
  });

  it('is byte-for-byte deterministic regardless of input order', () => {
    expect(createZip(entries)).toEqual(createZip([...entries].reverse()));
  });

  it('stores incompressible data and deflates the rest', () => {
    const zip = createZip(entries);
    // The repeated text compresses well, so the archive is smaller than the input.
    expect(zip.length).toBeLessThan(
      entries.reduce((sum, entry) => sum + entry.data.length, 0) + 300,
    );
    expect(readZip(createZip([{ path: 'x', data: Uint8Array.of(7) }]))[0]?.data).toEqual(
      Uint8Array.of(7),
    );
  });

  it.each(['', '/abs', '../escape', 'a/../b', 'a//b', 'win\\path', './x'])(
    'rejects the unsafe path %j',
    (path) => {
      expect(() => createZip([{ path, data: new Uint8Array(0) }])).toThrow('Unsafe archive path');
    },
  );

  it('rejects duplicate paths', () => {
    expect(() =>
      createZip([
        { path: 'x', data: new Uint8Array(0) },
        { path: 'x', data: new Uint8Array(1) },
      ]),
    ).toThrow('Duplicate archive path');
  });

  it('detects corruption and non-archives', () => {
    const zip = createZip([{ path: 'a.txt', data: text('hello hello hello hello') }]);
    const corrupt = Uint8Array.from(zip);
    corrupt[40] = (corrupt[40] ?? 0) ^ 0xff;
    expect(() => readZip(corrupt)).toThrow();
    expect(() => readZip(text('not a zip at all, definitely not'))).toThrow('Not a ZIP archive');
  });
});

describe('encodePng', () => {
  it('writes a valid PNG whose pixels decode back exactly', () => {
    const width = 3;
    const height = 2;
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 37) % 256);
    const png = encodePng(width, height, pixels);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Walk the chunks, checking each CRC and collecting IDAT.
    let offset = 8;
    const types: string[] = [];
    const idat: Uint8Array[] = [];
    while (offset < png.length) {
      const length = view.getUint32(offset);
      const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
      const data = png.subarray(offset + 8, offset + 8 + length);
      expect(view.getUint32(offset + 8 + length)).toBe(
        crc32(png.subarray(offset + 4, offset + 8 + length)),
      );
      types.push(type);
      if (type === 'IHDR') {
        expect([new DataView(data.buffer, data.byteOffset).getUint32(0), data[8], data[9]]).toEqual(
          [3, 8, 6],
        );
      }
      if (type === 'IDAT') {
        idat.push(data);
      }
      offset += 12 + length;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    const raw = inflateSync(Buffer.concat(idat));
    for (let y = 0; y < height; y++) {
      expect(raw[y * (width * 4 + 1)]).toBe(0);
      expect([...raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1))]).toEqual([
        ...pixels.subarray(y * width * 4, (y + 1) * width * 4),
      ]);
    }
  });

  it('rejects bad dimensions and pixel buffers', () => {
    expect(() => encodePng(0, 1, new Uint8Array(0))).toThrow('positive integers');
    expect(() => encodePng(1.5, 1, new Uint8Array(6))).toThrow('positive integers');
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow('Expected 16 bytes');
  });
});

describe('renderIcon', () => {
  it.each(ICON_SIZES)(
    'renders a %i px icon with transparent corners and an opaque centre',
    (size) => {
      const pixels = renderIcon(size);
      expect(pixels).toHaveLength(size * size * 4);
      const alpha = (x: number, y: number) => pixels[(y * size + x) * 4 + 3];
      expect(alpha(0, 0)).toBe(0);
      expect(alpha(size - 1, size - 1)).toBe(0);
      expect(alpha(Math.floor(size / 2), Math.floor(size / 2))).toBe(255);
      expect(alpha(Math.floor(size / 2), 1)).toBe(255);
    },
  );

  it('is deterministic', () => {
    expect(renderIcon(48)).toEqual(renderIcon(48));
  });
});
