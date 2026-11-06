// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
/**
 * The canvas follows the UI brightness (LT / DRK). On a UI mode change, each effect's
 * background colour is mirrored in lightness when it sits on the wrong side of 50%, and its
 * Blend mode is set to match (DRK -> Screen, LT -> Multiply). Nothing here runs when the
 * user edits a colour or the blend mode, or when a preset loads.
 *
 * Lightness is CIELAB L* (D65), not OKLab L: L* has a linear segment near black, so a light
 * paper mirrors to a visible near-black (#F7F7F5 -> #0A0A09) and the round trip through 8-bit
 * hex comes back to where it started. OKLab's cube root crushes the mirrored darks to #000.
 * Mirror: same hue and chroma (LCh), L*' = 100 - L*, chroma reduced until the colour fits sRGB.
 */
import type { ParamValues } from './params';

export type UiMode = 'light' | 'dark';

/** Blend mode param shared by every effect: 'multiply' (light paper) or 'screen' (dark). */
export const BLEND_ID = 'blend';
export type BlendMode = 'multiply' | 'screen';
export const blendFor = (mode: UiMode): BlendMode => (mode === 'dark' ? 'screen' : 'multiply');

// D65 white, sRGB <-> XYZ
const XN = 0.95047, YN = 1, ZN = 1.08883;
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const E = 216 / 24389, K = 24389 / 27;
const f = (t: number) => (t > E ? Math.cbrt(t) : (K * t + 16) / 116);
const fInv = (t: number) => (t * t * t > E ? t * t * t : (116 * t - 16) / K);

export type Lab = [number, number, number];

export function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const r = toLin(((n >> 16) & 255) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / YN;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab -> linear sRGB (may be out of 0..1). */
function labToLinear([L, a, b]: Lab): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x = fInv(fx) * XN, y = (L > K * E ? fy * fy * fy : L / K) * YN, z = fInv(fz) * ZN;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const EPS = 1e-4;
const inGamut = (rgb: number[]) => rgb.every((c) => c >= -EPS && c <= 1 + EPS);

function linearToHex(rgb: number[]): string {
  return '#' + rgb.map((c) => Math.round(toGam(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Perceived lightness, CIELAB L* 0..100. */
export const lightness = (hex: string): number => hexToLab(hex)[0];

/** Same hue and chroma, L* -> 100 - L*; chroma is reduced (bisection) until it fits sRGB. */
export function mirrorLightness(hex: string): string {
  const [L, a, b] = hexToLab(hex);
  const C = Math.hypot(a, b), h = Math.atan2(b, a);
  const L2 = Math.min(100, Math.max(0, 100 - L));
  const at = (c: number): Lab => [L2, c * Math.cos(h), c * Math.sin(h)];
  let rgb = labToLinear(at(C));
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinear(at(mid)))) lo = mid; else hi = mid;
    }
    rgb = labToLinear(at(lo));
  }
  return linearToHex(rgb);
}

/** Mirrored colour -> the colour it came from, so LT -> DRK -> LT returns exactly (8-bit
 *  rounding would otherwise drift by one step, e.g. #F7F7F5 -> #0A0A08 -> #F7F7F6). */
const mirroredFrom = new Map<string, string>();

/**
 * Values to apply to one effect when the UI switches to `mode`: the blend mode for the new
 * background, and the background mirrored when its lightness is on the wrong side of 50.
 */
export function canvasPatch(values: Readonly<ParamValues>, backgroundId: string | undefined, mode: UiMode): ParamValues {
  const out: ParamValues = { [BLEND_ID]: blendFor(mode) };
  const bg = backgroundId ? values[backgroundId] : undefined;
  if (typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg)) {
    const L = lightness(bg);
    if ((mode === 'dark' && L > 50) || (mode === 'light' && L < 50)) {
      const key = bg.toUpperCase();
      const to = mirroredFrom.get(key) ?? mirrorLightness(key);
      mirroredFrom.set(to, key);
      out[backgroundId!] = to;
    }
  }
  return out;
}
