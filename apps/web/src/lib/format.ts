export function usd(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function num(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function btc(n: number): string {
  return `${n.toFixed(6)} ₿`;
}

export function pct(fraction: number, digits = 3): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function ms(n: number | null): string {
  if (n == null) return "—";
  if (n < 1) return `${(n * 1000).toFixed(0)}µs`;
  return `${n.toFixed(n < 10 ? 2 : 0)}ms`;
}

export function time(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour12: false });
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact elapsed time since `ms` epoch, e.g. "3d 4h", "5h 12m", or "8m". */
export function uptime(sinceMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
