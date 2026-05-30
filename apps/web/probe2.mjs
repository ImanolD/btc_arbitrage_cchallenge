import { io } from "socket.io-client";

const s = io("http://localhost:4000", { transports: ["websocket", "polling"] });
let best = 0;
s.on("opportunity", (o) => {
  if (o.actionable && o.netProfit > best) best = o.netProfit;
});
s.on("portfolio", (p) => {
  console.log("trades:", p.totalTrades, "| realizedPnl:", p.realizedPnlUsd);
  console.log("rebalancing:", JSON.stringify(p.rebalancing));
  console.log("wallets BTC drift:", p.wallets.map((w) => `${w.exchange}:${w.btc}`).join("  "));
  console.log("best actionable net seen:", best.toFixed(2));
  process.exit(0);
});
setTimeout(() => {
  console.log("no portfolio event - server down?");
  process.exit(1);
}, 8000);
