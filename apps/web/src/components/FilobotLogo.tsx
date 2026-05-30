import { cn } from "@/lib/utils";

/**
 * Filobot mark: a minimal cat head (a nod to Filomena) housing a lightning bolt
 * for low-latency execution. Uses the app's primary→cyan gradient.
 */
export function FilobotLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-full w-full", className)}
      role="img"
      aria-label="Filobot"
    >
      <defs>
        <linearGradient id="filobot-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(189 94% 55%)" />
        </linearGradient>
      </defs>
      {/* ears */}
      <path d="M7 10 L7.5 2.5 L13.5 7 Z" fill="url(#filobot-grad)" />
      <path d="M25 10 L24.5 2.5 L18.5 7 Z" fill="url(#filobot-grad)" />
      {/* head */}
      <rect x="5" y="6" width="22" height="22" rx="8" fill="url(#filobot-grad)" />
      {/* lightning bolt = speed */}
      <path
        d="M17.6 11 L12.4 18 L15.4 18 L14.4 23 L19.6 16 L16.6 16 Z"
        fill="hsl(var(--primary-foreground))"
      />
    </svg>
  );
}
