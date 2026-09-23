import { getItem } from '../gameplay/Items';

/** Tiny DOM helpers for the UI layer. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function itemChip(id: string, size = 26): string {
  const it = getItem(id);
  return `<span class="chip" style="background:${it.color};width:${size}px;height:${size}px">${it.symbol}</span>`;
}

export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtCredits(n: number): string {
  return `${Math.round(n).toLocaleString()} ¢`;
}

export function bar(frac: number, color: string, low = 0.2): string {
  const f = Math.max(0, Math.min(1, frac));
  return `<div class="bar ${f < low ? 'low' : ''}"><i style="width:${(f * 100).toFixed(1)}%;background:${color};color:${color}"></i></div>`;
}
