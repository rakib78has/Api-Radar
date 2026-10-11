/**
 * Endpoint pattern matching without regular expressions built from user
 * input, so an imported rule cannot cause catastrophic backtracking. Matching
 * costs O(pattern segments × path segments × segment length) at worst.
 */

/** Glob match where `*` matches any run of characters, including none. */
export function wildcardMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    const pc = pattern.charAt(p);
    if (p < pattern.length && pc !== '*' && pc === text.charAt(t)) {
      p++;
      t++;
    } else if (p < pattern.length && pc === '*') {
      star = p;
      p++;
      mark = t;
    } else if (star !== -1) {
      p = star + 1;
      mark++;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern.charAt(p) === '*') {
    p++;
  }
  return p === pattern.length;
}

function segmentMatches(patternSegment: string, segment: string): boolean {
  if (patternSegment.length > 1 && patternSegment.startsWith(':')) {
    return segment.length > 0;
  }
  return wildcardMatch(patternSegment, segment);
}

/** `pattern` and `path` segments exclude the leading empty segment. `**` matches zero or more segments. */
function segmentsMatch(pattern: readonly string[], path: readonly string[]): boolean {
  // next[j]: does pattern[i + 1 ..] match path[j ..]?
  let next: boolean[] = Array.from({ length: path.length + 1 }, (_, j) => j === path.length);
  for (let i = pattern.length - 1; i >= 0; i--) {
    const patternSegment = pattern[i] ?? '';
    const current: boolean[] = new Array<boolean>(path.length + 1).fill(false);
    for (let j = path.length; j >= 0; j--) {
      if (patternSegment === '**') {
        current[j] = next[j] === true || (j < path.length && current[j + 1] === true);
      } else {
        current[j] =
          j < path.length && next[j + 1] === true && segmentMatches(patternSegment, path[j] ?? '');
      }
    }
    next = current;
  }
  return next[0] === true;
}

function splitPath(path: string): string[] {
  return path.split('/').slice(1);
}

function normaliseOriginPattern(origin: string): string {
  try {
    const parsed = new URL(origin);
    return parsed.origin === 'null' ? origin.toLowerCase() : parsed.origin;
  } catch {
    return origin.toLowerCase();
  }
}

export type PathMatcher = (origin: string, path: string) => boolean;

/**
 * Compiles a pattern such as `/api/users/:id` or `https://*.example.com/v1/**`
 * (see `endpointPatternSchema`). The origin part may use `*` as a wildcard.
 */
export function compileEndpointPattern(pattern: string): PathMatcher {
  let originPattern: string | null = null;
  let pathPattern = pattern;

  const schemeEnd = /^https?:\/\//i.exec(pattern)?.[0].length;
  if (schemeEnd !== undefined) {
    const pathStart = pattern.indexOf('/', schemeEnd);
    originPattern = normaliseOriginPattern(
      pathStart === -1 ? pattern : pattern.slice(0, pathStart),
    );
    pathPattern = pathStart === -1 ? '/' : pattern.slice(pathStart);
  }

  // Consecutive `**` segments are equivalent to one.
  const patternSegments = splitPath(pathPattern).filter(
    (segment, index, all) => !(segment === '**' && all[index - 1] === '**'),
  );

  return (origin, path) =>
    (originPattern === null || wildcardMatch(originPattern, origin)) &&
    segmentsMatch(patternSegments, splitPath(path));
}
