/**
 * Draws the extension icon: a blue rounded square with a radar (rings, a
 * sweep and a blip). Rendered with 4x4 supersampling, so it is smooth at
 * every size and identical on every machine.
 */
export const ICON_SIZES = [16, 32, 48, 128] as const;

type Rgba = readonly [number, number, number, number];

const BACKGROUND: Rgba = [36, 89, 214, 255];
const RING: Rgba = [255, 255, 255, 150];
const SWEEP: Rgba = [255, 255, 255, 235];
const BLIP: Rgba = [255, 196, 61, 255];

/** Colour at a point in the unit square [0, 1)², or null for transparent. */
function sample(x: number, y: number): Rgba | null {
  // Rounded square with corner radius 0.22.
  const radius = 0.22;
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  if (dx * dx + dy * dy > radius * radius) {
    return null;
  }
  const cx = x - 0.5;
  const cy = y - 0.5;
  const distance = Math.hypot(cx, cy);

  // Blip at the upper right.
  if (Math.hypot(x - 0.69, y - 0.33) < 0.07) {
    return BLIP;
  }
  // Sweep: a line from the centre towards the upper right.
  const angle = Math.atan2(-cy, cx);
  if (distance < 0.36 && Math.abs(angle - Math.PI / 4) < 0.09 && distance > 0.02) {
    return SWEEP;
  }
  // Rings and the centre dot.
  if (distance < 0.045 || Math.abs(distance - 0.18) < 0.025 || Math.abs(distance - 0.34) < 0.025) {
    return RING;
  }
  return BACKGROUND;
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] / 255;
  return [
    top[0] * alpha + bottom[0] * (1 - alpha),
    top[1] * alpha + bottom[1] * (1 - alpha),
    top[2] * alpha + bottom[2] * (1 - alpha),
    255,
  ];
}

/** RGBA pixels for a `size` × `size` icon. */
export function renderIcon(size: number): Uint8Array {
  const samples = 4;
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const colour = sample(
            (px + (sx + 0.5) / samples) / size,
            (py + (sy + 0.5) / samples) / size,
          );
          if (colour !== null) {
            const solid =
              colour === BACKGROUND || colour === BLIP ? colour : over(colour, BACKGROUND);
            r += solid[0];
            g += solid[1];
            b += solid[2];
            a += 255;
          }
        }
      }
      const count = samples * samples;
      const offset = (py * size + px) * 4;
      // Colours are averaged over covered samples only, so edges fade without darkening.
      const covered = a / 255;
      pixels[offset] = covered === 0 ? 0 : Math.round(r / covered);
      pixels[offset + 1] = covered === 0 ? 0 : Math.round(g / covered);
      pixels[offset + 2] = covered === 0 ? 0 : Math.round(b / covered);
      pixels[offset + 3] = Math.round(a / count);
    }
  }
  return pixels;
}
