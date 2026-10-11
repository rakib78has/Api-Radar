import { describe, expect, it } from 'vitest';

import { fnv1a64, hashFields } from '../src/index.js';

/** UTF-8 bytes via encodeURIComponent, which percent-encodes every non-ASCII byte. */
function utf8Bytes(text: string): number[] {
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded.charAt(i) === '%') {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

/** Straightforward BigInt FNV-1a 64 used as an oracle. */
function referenceFnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of utf8Bytes(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Deterministic PRNG (mulberry32) so the randomised cases are repeatable. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0x80, 0x7ff],
  [0x800, 0xd7ff],
  [0xe000, 0xffff],
  [0x10000, 0x10ffff],
];

function randomString(random: () => number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) {
    const [low, high] = CODE_POINT_RANGES[Math.floor(random() * CODE_POINT_RANGES.length)] ?? [
      0x20, 0x7e,
    ];
    text += String.fromCodePoint(low + Math.floor(random() * (high - low + 1)));
  }
  return text;
}

describe('fnv1a64', () => {
  it.each([
    ['', 'cbf29ce484222325'],
    ['a', 'af63dc4c8601ec8c'],
    ['foobar', '85944171f73967e8'],
  ])('matches the published FNV-1a 64 test vector for %j', (input, expected) => {
    expect(fnv1a64(input)).toBe(expected);
  });

  it('matches a BigInt reference implementation on 500 random multilingual strings', () => {
    const random = prng(20261012);
    for (let i = 0; i < 500; i++) {
      const text = randomString(random, Math.floor(random() * 40));
      expect(fnv1a64(text), JSON.stringify(text)).toBe(referenceFnv1a64(text));
    }
  });

  it('encodes lone surrogates as U+FFFD, like TextEncoder', () => {
    expect(fnv1a64('\uD800')).toBe(fnv1a64('�'));
    expect(fnv1a64('a\uDC00b')).toBe(fnv1a64('a�b'));
    expect(fnv1a64('\uD83D')).toBe(fnv1a64('�'));
  });

  it('always returns 16 lowercase hex digits', () => {
    expect(fnv1a64('x'.repeat(100_000))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('hashFields', () => {
  it('distinguishes field boundaries', () => {
    expect(hashFields(['ab', 'c'])).not.toBe(hashFields(['a', 'bc']));
    expect(hashFields(['a', ''])).not.toBe(hashFields(['a']));
  });

  it('is deterministic', () => {
    expect(hashFields(['GET', '/x'])).toBe(hashFields(['GET', '/x']));
  });
});
