/**
 * Colors for the step maps (vote share, turnout, indicators): steps mixed in CIELAB (so they look
 * evenly spaced) from near-white for the lowest values up to the color darkened and saturated a
 * little for the highest.
 */

type Rgb = [number, number, number];
type Lab = [number, number, number];

const RAMP_LOW = '#f6f6f3';
/** The lowest step is already a faint tint of the color, not plain white. */
const RAMP_MIN_T = 0.06;

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const WHITE = [0.95047, 1, 1.08883];

function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE[0];
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE[1];
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labToRgb([l, a, bb]: Lab): Rgb {
  const fy = (l + 16) / 116;
  const x = fInv(fy + a / 500) * WHITE[0];
  const y = fInv(fy) * WHITE[1];
  const z = fInv(fy - bb / 200) * WHITE[2];
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const b = 0.0557 * x - 0.204 * y + 1.057 * z;
  return [r, g, b].map((c) => fromLinear(Math.min(1, Math.max(0, c))) * 255) as Rgb;
}

/** a -> b at t (0..1), in CIELAB. */
export function mix(a: string, b: string, t: number): string {
  const A = rgbToLab(hexToRgb(a));
  const B = rgbToLab(hexToRgb(b));
  return rgbToHex(labToRgb(A.map((v, i) => v + (B[i] - v) * t) as Lab));
}

/** Grey colors (independents, "?", parties without a color of their own) would ramp from near-white
 *  only to grey: they run to near-black instead. Grey = chroma under NEUTRAL_CHROMA (CIELAB). */
const NEUTRAL_TOP = '#121418';
const NEUTRAL_CHROMA = 12;

/** The top of a ramp: the color a little darker and a little more saturated (near-black for grey). */
export function deepened(hex: string): string {
  const [l, a, b] = rgbToLab(hexToRgb(hex));
  if (Math.hypot(a, b) < NEUTRAL_CHROMA) return NEUTRAL_TOP;
  return rgbToHex(labToRgb([l * 0.82, a * 1.2, b * 1.2]));
}

/**
 * Steps of a step map. Values are skewed (most areas close together, a few strongholds far
 * above), so the steps hold equal numbers of areas, a sixth each, with the top sixth split at the
 * top 5% so the strongholds still stand out. Breaks that coincide merge.
 */
const SHARE_CUTS = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 0.95];

export function shareBreaks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return [];
  return [...new Set(SHARE_CUTS.map((p) => sorted[Math.round(p * (n - 1))]))].filter((b) => b < sorted[n - 1]);
}

/** The step a share falls in; steps run (lower break, upper break]. */
export function shareStep(breaks: number[], value: number): number {
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
}

export function stepColor(color: string, breaks: number[], step: number): string {
  const t = breaks.length ? step / breaks.length : 1;
  return mix(RAMP_LOW, deepened(color), RAMP_MIN_T + (1 - RAMP_MIN_T) * t);
}
