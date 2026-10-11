/**
 * 64-bit FNV-1a over the UTF-8 encoding of `input`, as 16 lowercase hex digits.
 * Lone surrogates are encoded as U+FFFD, as TextEncoder does.
 *
 * Fast, deterministic and identical in every runtime, which is what
 * fingerprints need. It is not a cryptographic hash, so only sanitised data
 * is ever hashed (see docs/detection-rules.md).
 */
export function fnv1a64(input: string): string {
  // The 64-bit state is kept in four 16-bit lanes, least significant first, so
  // every intermediate product stays exact in a double.
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;

  const update = (byte: number): void => {
    h0 ^= byte;
    // Multiply by the FNV prime 2^40 + 0x1b3 (mod 2^64).
    const t0 = h0 * 0x1b3;
    let t1 = h1 * 0x1b3;
    let t2 = h2 * 0x1b3 + (h0 << 8);
    let t3 = h3 * 0x1b3 + (h1 << 8);
    t1 += t0 >>> 16;
    t2 += t1 >>> 16;
    t3 += t2 >>> 16;
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  };

  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      update(code);
    } else if (code < 0x800) {
      update(0xc0 | (code >> 6));
      update(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      update(0xe0 | (code >> 12));
      update(0x80 | ((code >> 6) & 0x3f));
      update(0x80 | (code & 0x3f));
    } else {
      update(0xf0 | (code >> 18));
      update(0x80 | ((code >> 12) & 0x3f));
      update(0x80 | ((code >> 6) & 0x3f));
      update(0x80 | (code & 0x3f));
    }
  }

  return [h3, h2, h1, h0].map((lane) => lane.toString(16).padStart(4, '0')).join('');
}

/** Hashes a list of fields. Length prefixes keep `["ab", "c"]` and `["a", "bc"]` distinct. */
export function hashFields(fields: readonly string[]): string {
  return fnv1a64(fields.map((field) => `${String(field.length)}:${field}`).join(''));
}
