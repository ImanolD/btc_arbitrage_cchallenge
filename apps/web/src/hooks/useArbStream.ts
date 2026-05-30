import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EngineConfig,
  ExchangeId,
  FeedStatus,
  LatencyStats,
  Opportunity,
  PortfolioStats,
  SimulatedTrade,
  TopOfBook,
} from "@arb/shared";
import { createSocket, type ArbSocket } from "@/lib/socket";

const MAX_FEED_ITEMS = 60;

export interface ArbState {
  connected: boolean;
  config: EngineConfig | null;
  books: Record<string, TopOfBook>;
  opportunities: Opportunity[];
  trades: SimulatedTrade[];
  portfolio: PortfolioStats | null;
  latency: LatencyStats | null;
  feeds: FeedStatus[];
}

const initialState: ArbState = {
  connected: false,
  config: null,
  books: {},
  opportunities: [],
  trades: [],
  portfolio: null,
  latency: null,
  feeds: [],
};

/**
 * Subscribes to the server's Socket.IO stream and keeps a live view of market
 * state. High-frequency events (books) are buffered and flushed on an animation
 * frame so the browser never becomes the bottleneck — we log every event but
 * render at most ~60fps.
 */
export interface ArbStream extends ArbState {
  setDemo: (enabled: boolean) => void;
}

export function useArbStream(): ArbStream {
  const [state, setState] = useState<ArbState>(initialState);
  const bookBuffer = useRef<Record<string, TopOfBook>>({});
  const rafPending = useRef(false);
  const socketRef = useRef<ArbSocket | null>(null);

  const setDemo = useCallback((enabled: boolean) => {
    socketRef.current?.emit("setDemo", enabled);
  }, []);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    const flushBooks = () => {
      rafPending.current = false;
      const buffered = bookBuffer.current;
      bookBuffer.current = {};
      setState((prev) => ({ ...prev, books: { ...prev.books, ...buffered } }));
    };

    socket.on("connect", () => setState((p) => ({ ...p, connected: true })));
    socket.on("disconnect", () => setState((p) => ({ ...p, connected: false })));

    socket.on("config", (config: EngineConfig) =>
      setState((p) => ({ ...p, config })),
    );

    socket.on("book", (book: TopOfBook) => {
      bookBuffer.current[book.exchange] = book;
      if (!rafPending.current) {
        rafPending.current = true;
        requestAnimationFrame(flushBooks);
      }
    });

    socket.on("opportunity", (opp: Opportunity) =>
      setState((p) => ({
        ...p,
        opportunities: [opp, ...p.opportunities].slice(0, MAX_FEED_ITEMS),
      })),
    );

    socket.on("trade", (trade: SimulatedTrade) =>
      setState((p) => ({
        ...p,
        trades: [trade, ...p.trades].slice(0, MAX_FEED_ITEMS),
      })),
    );

    socket.on("portfolio", (portfolio: PortfolioStats) =>
      setState((p) => ({ ...p, portfolio })),
    );

    socket.on("latency", (latency: LatencyStats) =>
      setState((p) => ({ ...p, latency })),
    );

    socket.on("feeds", (feeds: FeedStatus[]) =>
      setState((p) => ({ ...p, feeds })),
    );

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return { ...state, setDemo };
}

export type { ExchangeId };
