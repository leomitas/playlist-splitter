// Color math for the contrast checks: hex and OKLCH to linear sRGB, WCAG 2 contrast ratio,
// alpha compositing and color-mix(in oklch). Out-of-gamut colors are reported, not clipped.

export type Rgb = [number, number, number]; // linear sRGB, 0..1
export type Oklch = [l: number, c: number, h: number];

const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToLinear(hex: string): Rgb {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? [...n].map((c) => c + c).join("") : n;
  return [0, 2, 4].map((i) => decode(parseInt(full.slice(i, i + 2), 16) / 255)) as Rgb;
}

export function oklchToLinear([l, c, h]: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function linearToOklch([r, g, b]: Rgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

export const inGamut = (rgb: Rgb, eps = 1e-4) => rgb.every((v) => v >= -eps && v <= 1 + eps);

// CSS Color 4 style gamut mapping: keep lightness and hue, lower chroma until it fits
export function toGamut([l, c, h]: Oklch): Rgb {
  if (inGamut(oklchToLinear([l, c, h]))) return oklchToLinear([l, c, h]);
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear([l, mid, h]))) lo = mid;
    else hi = mid;
  }
  return oklchToLinear([l, lo, h]);
}
const clamp = (rgb: Rgb): Rgb => rgb.map((v) => Math.min(1, Math.max(0, v))) as Rgb;

export const luminance = (rgb: Rgb) => {
  const [r, g, b] = clamp(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// `fg` at `alpha` over an opaque `bg`, blended in gamma-encoded sRGB as browsers do
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return clamp(fg).map((v, i) => decode(alpha * encode(v) + (1 - alpha) * encode(clamp(bg)[i]))) as Rgb;
}

// color-mix(in oklch, a p%, b): shorter hue arc; an achromatic side takes the other's hue
export function mixOklch(a: Oklch, p: number, b: Oklch): Rgb {
  const t = 1 - p;
  let [ha, hb] = [a[2], b[2]];
  if (a[1] < 0.02) ha = hb;
  if (b[1] < 0.02) hb = ha;
  let d = hb - ha;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return oklchToLinear([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ha + d * t]);
}
