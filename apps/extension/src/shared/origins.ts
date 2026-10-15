/** `https://shop.test` for an http(s) URL; `null` for anything else. */
export function httpOrigin(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** True when `value` is exactly an http(s) origin, with no path, query or credentials. */
export function isHttpOrigin(value: string): boolean {
  return httpOrigin(value) === value;
}

/** Chrome match pattern covering every URL of an origin, e.g. `https://shop.test/*`. */
export function matchPatternFor(origin: string): string {
  const url = new URL(origin);
  // Match patterns do not include ports; the host pattern covers every port.
  return `${url.protocol}//${url.hostname}/*`;
}

/** Parses free text (one origin or URL per line or comma) into unique http(s) origins. */
export function parseOriginList(text: string): { origins: string[]; invalid: string[] } {
  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const entry of text.split(/[\s,]+/).filter((piece) => piece.length > 0)) {
    const origin = httpOrigin(entry);
    if (origin === null) {
      invalid.push(entry);
    } else {
      origins.add(origin);
    }
  }
  return { origins: [...origins], invalid };
}
