import { createServer } from "node:http";
import type { Client } from "discord.js";

/**
 * A tiny health endpoint and a heartbeat, so the bot can be watched.
 *
 *  - GET /healthz   200 when the bot is logged in to Discord and connected, 503 otherwise. Railway uses this to decide a deploy worked.
 *                   It returns only status and counts, never tokens, server names or user information.
 *  - Heartbeat      Every minute, while connected, the bot pings KENER_HEARTBEAT_URL (set in the host's settings). The status page
 *                   marks the bot down if the pings stop, with no public address needed for the bot.
 */
export function startHealth(client: Client): void {
  const started = Date.now();
  const port = Number(process.env.BOT_HEALTH_PORT || process.env.PORT) || 3000;

  createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (url !== "/healthz" && url !== "/") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const ready = client.isReady();
    const body = { status: ready ? "ok" : "down", ready, gatewayPingMs: ready ? Math.round(client.ws.ping) : null, uptimeSeconds: Math.floor((Date.now() - started) / 1000), commands: ready ? client.application?.commands.cache.size ?? null : null };
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(req.method === "HEAD" ? undefined : JSON.stringify(body));
  }).listen(port, () => console.log(`Health endpoint listening on port ${port}`));

  const beat = process.env.KENER_HEARTBEAT_URL?.trim();
  if (beat) {
    const ping = async () => {
      if (!client.isReady()) return;
      try {
        await fetch(beat, { method: "GET", signal: AbortSignal.timeout(8000) });
      } catch {
        /* the status page will notice if pings keep failing */
      }
    };
    setInterval(() => void ping(), 60_000);
    client.once("ready", () => void ping());
  }
}
