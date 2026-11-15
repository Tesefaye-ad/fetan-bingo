require("dotenv").config();

// ═══════════════════════════════════════════════════════
// ENV VALIDATION — Fail fast on missing secrets
// ═══════════════════════════════════════════════════════
(function validateEnv() {
  const errors = [];
  const req = [
    { name: "MONGO_URI", aliases: ["MONGODB_URI"] },
    { name: "TELEGRAM_BOT_TOKEN", minLen: 20 },
    { name: "JWT_SECRET", minLen: 32 },
    { name: "ADMIN_TELEGRAM_IDS", minLen: 1 },
    { name: "DEPOSIT_TELEBIRR_PHONE", minLen: 9 },
  ];
  const opt = [{ name: "MERCHANT_SMS_TOKEN", minLen: 24 }];

  const pick = (r) =>
    [r.name, ...(r.aliases || [])]
      .map((n) => (process.env[n] || "").trim())
      .find(Boolean);

  for (const r of req) {
    const v = pick(r);
    if (!v) {
      errors.push(`Missing: ${r.name}`);
      continue;
    }
    if (r.minLen && String(v).length < r.minLen) {
      errors.push(`${r.name} too short (min ${r.minLen})`);
    }
  }
  for (const r of opt) {
    const v = process.env[r.name];
    if (v && String(v).length < r.minLen) {
      errors.push(`${r.name} too short (min ${r.minLen})`);
    }
  }

  if (errors.length) {
    console.error("\n❌ ENV VALIDATION FAILED:");
    for (const e of errors) console.error("  • " + e);
    console.error("[env] ⚠️ Fix the variables above in Render/Pxxl → Environment.");
    if (process.env.NODE_ENV !== "test") process.exit(1);
  } else {
    console.log("[env] ✅ Validation passed");
  }
})();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { createAdapter } = require("@socket.io/redis-adapter");
const { pubClient, subClient } = require("./config/redis");

// ═══════════════════════════════════════════════════════
// ROUTES & MIDDLEWARE
// ═══════════════════════════════════════════════════════
const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const depositRoutes = require("./routes/deposit");
const gameRoutes = require("./routes/game");
const adminRoutes = require("./routes/admin");
const { initGameSocket } = require("./socket/gameSocket");
const merchantSmsRoutes = require("./routes/merchantSmsRoute");

const {
  globalLimiter,
  authLimiter,
  depositLimiter,
  withdrawLimiter,
} = require("./middleware/rateLimit");

const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((o) => o.trim())
  : "*";

// ═══════════════════════════════════════════════════════
// SOCKET.IO SETUP
// ═══════════════════════════════════════════════════════
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  serveClient: false,
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: { level: 6 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
  },
  httpCompression: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  upgradeTimeout: 10000,
  connectTimeout: 45000,
});

io.adapter(createAdapter(pubClient, subClient));

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "256kb" }));

app.get("/", (req, res) =>
  res.json({ name: "Fetan Bingo API", status: "running" })
);

app.get("/health", (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    ts: Date.now(),
    uptime: Math.floor(process.uptime()),
    sockets: io.engine.clientsCount,
    mem: {
      rss: Math.round(mem.rss / 1048576) + "MB",
      heap: Math.round(mem.heapUsed / 1048576) + "MB",
    },
  });
});

// ═══════════════════════════════════════════════════════
// ROUTES SETUP
// ═══════════════════════════════════════════════════════
app.use("/api", globalLimiter);
app.use("/api/auth/telegram", authLimiter);
app.use("/api/wallet/deposit", depositLimiter);
app.use("/api/wallet/withdraw", withdrawLimiter);
app.use("/api/merchant-sms", merchantSmsRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/user", authRoutes.userRouter);
app.use("/api/wallet", walletRoutes);
app.use("/api/wallet", depositRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ═══════════════════════════════════════════════════════
// START SERVER & CONNECT DATABASE
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Running on port ${PORT}`);
});

// 🔴 FIX: ዳታቤዙ ከተገናኘ በኋላ ብቻ Socket እንዲጀመር ማድረግ (Crash እንዳያመጣ)
connectDB().then(() => {
  console.log("[db] Connected. Starting game socket engine...");
  initGameSocket(io);
}).catch((err) => {
  console.error("[db] Failed to connect on startup:", err.message);
});

// ═══════════════════════════════════════════════════════
// AUTO CLEANUP (Daily)
// ═══════════════════════════════════════════════════════
const ONE_DAY = 24 * 60 * 60 * 1000;
async function runCleanup() {
  try {
    const { cleanup } = require("./scripts/cleanup");
    const result = await cleanup();
    console.log("[cleanup]", JSON.stringify(result));
  } catch (err) {
    console.error("[cleanup] failed:", err.message);
  }
}

setTimeout(runCleanup, 60000);
setInterval(runCleanup, ONE_DAY);

// ═══════════════════════════════════════════════════════
// KEEP-ALIVE (Render/Pxxl cold start)
// ═══════════════════════════════════════════════════════
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.PXXL_URL || `https://fetan-bingo-ra58.onrender.com`;

setInterval(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
    console.log("[keep-alive] Ping sent");
  } catch (err) {}
}, 4 * 60 * 1000);

setTimeout(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
    console.log("[keep-alive] Initial ping");
  } catch (err) {}
}, 5000);

// ═══════════════════════════════════════════════════════
// TELEGRAM BOT WEBHOOK
// ═══════════════════════════════════════════════════════
try {
  const { startBot, bot } = require("./bot");
  startBot(app).then(() => {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;

    (async () => {
      const url = `${SELF_URL}${webhookPath}`;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await bot.telegram.setWebhook(url);
          console.log(`[bot] Webhook: ${url}`);
          return;
        } catch (err) {
          console.error(`[bot] setWebhook failed (try ${attempt}/4):`, err.message);
          await new Promise((r) => setTimeout(r, attempt * 3000));
        }
      }
    })();
  });
} catch (err) {
  console.error("[server] Bot failed:", err.message);
}

// ═══════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════
let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[shutdown] Received ${signal}. Shutting down gracefully...`);
  
  try {
    io.close();
    server.close();
    await mongoose.disconnect();
    console.log("[shutdown] Server closed.");
    process.exit(0);
  } catch (err) {
    console.error("[shutdown] Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (r) => console.error("[unhandledRejection]", r));
process.on("uncaughtException", (e) => {
  console.error("[uncaughtException]", e);
  shutdown("uncaughtException");
});