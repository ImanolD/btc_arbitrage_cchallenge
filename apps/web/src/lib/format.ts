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
