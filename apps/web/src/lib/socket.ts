import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arb/shared";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  "http://localhost:4000";

export type ArbSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): ArbSocket {
  // Prefer WebSocket but allow polling fallback for hosts that block WS upgrades.
  return io(SERVER_URL, {
    transports: ["websocket", "polling"],
    autoConnect: true,
  });
}
