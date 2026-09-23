import type { RGB } from '../universe/types';
import { RNG } from '../core/Random';

export function hsl(h: number, s: number, l: number): RGB {
  h = ((h % 1) + 1) % 1;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleRGB(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Jitter a colour in HSL-ish space. */
export function jitter(rng: RNG, c: RGB, amount: number): RGB {
  return [
    Math.min(1, Math.max(0, c[0] + rng.range(-amount, amount))),
    Math.min(1, Math.max(0, c[1] + rng.range(-amount, amount))),
    Math.min(1, Math.max(0, c[2] + rng.range(-amount, amount))),
  ];
}

export function rgbToHex(c: RGB): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

export function rgbToCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
}
