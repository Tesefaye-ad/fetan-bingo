// ═══════════════════════════════════════════════════════
// REDIS — Shared state between multiple Node processes
// ═══════════════════════════════════════════════════════
const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Publisher client
const pubClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: (err) => err.message.includes("READONLY"),
});

// Subscriber client (must be separate for Pub/Sub)
const subClient = pubClient.duplicate();

// Cache client (for get/set)
const cacheClient = pubClient.duplicate();

pubClient.on("error", (err) => console.error("[redis:pub]", err.message));
subClient.on("error", (err) => console.error("[redis:sub]", err.message));
cacheClient.on("error", (err) => console.error("[redis:cache]", err.message));

pubClient.on("connect", () => console.log("[redis] ✅ Connected"));

module.exports = {
  pubClient,
  subClient,
  cacheClient,
  REDIS_URL,
};