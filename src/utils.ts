export const COLORS = {
  bg: "#0a0e17",
  bgGrad1: "#0d1320",
  bgGrad2: "#070a12",
  grid: "rgba(40, 80, 120, 0.12)",
  primary: "#22d3ee",
  primaryDim: "#0e7490",
  accent: "#f59e0b",
  accentDim: "#b45309",
  success: "#34d399",
  successDim: "#059669",
  danger: "#f43f5e",
  dangerDim: "#be123c",
  warning: "#fbbf24",
  warningDim: "#d97706",
  white: "#f1f5f9",
  gray: "#64748b",
  grayDim: "#334155",
  panel: "rgba(15, 23, 42, 0.85)",
  panelBorder: "rgba(34, 211, 238, 0.25)",
};

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
