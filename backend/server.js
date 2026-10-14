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
    r.aliases
      ? r.aliases.map((a) => process.env[a]).find(Boolean)
      : process.env[r.name];

  for (const r of req) {
    const v = pick(r);
    if (!v) {
      errors.push(
        `Missing: ${r.name}${r.aliases ? ` (or ${r.aliases.join(", ")})` : ""}`
      );
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
    console.error("");
    console.error("[env] ⚠️ Fix the variables above in Render → Environment.");
    if (process.env.NODE_ENV !== "test") process.exit(1); // ❗ ሳይስተካከል አይነሳም
  } else {
    console.log("[env] ✅ Validation passed");
  }

  const mask = (v) =>
    !v ? "(unset)" : String(v).length <= 8
      ? "****"
      : String(v).slice(0, 4) + "…" + String(v).slice(-4);

  console.log(`[env] ADMIN_TELEGRAM_IDS = ${process.env.ADMIN_TELEGRAM_IDS}`);
  console.log(`[env] JWT_SECRET = ${mask(process.env.JWT_SECRET)}`);
  console.log(`[env] TELEGRAM_BOT_TOKEN = ${mask(process.env.TELEGRAM_BOT_TOKEN)}`);
  if (process.env.MERCHANT_SMS_TOKEN) {
    console.log(
      `[env] MERCHANT_SMS_TOKEN = ${mask(process.env.MERCHANT_SMS_TOKEN)} (${process.env.MERCHANT_SMS_TOKEN.length} chars)`
    );
  } else {
    console.warn("[env] ⚠️ MERCHANT_SMS_TOKEN not set — merchant SMS DISABLED");
  }
})();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

// ═══════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════
const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const depositRoutes = require("./routes/deposit");
const gameRoutes = require("./routes/game");
const adminRoutes = require("./routes/admin");
const { initGameSocket } = require("./socket/gameSocket");
const merchantSmsRoutes = require("./routes/merchantSmsRoute");

// ═══════════════════════════════════════════════════════
// RATE LIMITERS
// ═══════════════════════════════════════════════════════
const {
  globalLimiter,
  authLimiter,
  depositLimiter,
  withdrawLimiter,
} = require("./middleware/rateLimit");

// ═══════════════════════════════════════════════════════
// DATABASE — single source of truth (config/db.js)
// ═══════════════════════════════════════════════════════
const connectDB = require("./config/db");

// ═══════════════════════════════════════════════════════
// APP SETUP
// ═══════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((o) => o.trim())
  : "*";

// ═══════════════════════════════════════════════════════
// SOCKET.IO — tuned for 6000+ users
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
// RATE LIMITERS
// ═══════════════════════════════════════════════════════
app.use("/api", globalLimiter);
app.use("/api/auth/telegram", authLimiter);
app.use("/api/wallet/deposit", depositLimiter);
app.use("/api/wallet/withdraw", withdrawLimiter);
app.use("/api/merchant-sms", merchantSmsRoutes);

// ═══════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════
app.use("/api/auth", authRoutes);
app.use("/api/user", authRoutes.userRouter);
app.use("/api/wallet", walletRoutes);
app.use("/api/wallet", depositRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);

// ═══════════════════════════════════════════════════════
// 404 + ERROR HANDLERS
// ═══════════════════════════════════════════════════════
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ═══════════════════════════════════════════════════════
// SOCKET
// ═══════════════════════════════════════════════════════
initGameSocket(io);

// ═══════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Running on port ${PORT}`);
});

connectDB();

// ═══════════════════════════════════════════════════════
// AUTO CLEANUP — every 2 weeks
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// AUTO CLEANUP — 👈 OPTIMIZED: daily instead of every 2 weeks
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

// ሰርቨር ሲነሳ ከ 60 ሰከንድ በኋላ አንድ ጊዜ
setTimeout(runCleanup, 60000);

// 👈 ከዚያ በየቀኑ (2 ሳምንት ሳይሆን)
setInterval(runCleanup, ONE_DAY);
// ═══════════════════════════════════════════════════════
// KEEP-ALIVE (Render cold start)
// ═══════════════════════════════════════════════════════
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

setInterval(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
  } catch (err) {}
}, 10 * 60 * 1000);

setTimeout(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
    console.log("[keep-alive] Initial ping");
  } catch (err) {}
}, 10000);

// ═══════════════════════════════════════════════════════
// TELEGRAM BOT WEBHOOK
// ═══════════════════════════════════════════════════════
try {
  const { startBot, bot } = require("./bot");
  startBot(app).then(() => {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const RENDER_URL =
      process.env.RENDER_EXTERNAL_URL || `https://fetan-bingo-ra58.onrender.com`;

    setTimeout(async () => {
      try {
        await bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`, {
          drop_pending_updates: true,
        });
        console.log(`[bot] Webhook: ${RENDER_URL}${webhookPath}`);
      } catch (err) {
        console.error("[bot] setWebhook failed:", err.message);
      }
    }, 2000);
  });
} catch (err) {
  console.error("[server] Bot failed:", err.message);
}

// ═══════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════
process.on("unhandledRejection", (r) =>
  console.error("[unhandledRejection]", r)
);
process.on("uncaughtException", (e) => {
  console.error("[uncaughtException]", e);
  // ሰርቨሩ በተበላሸ ሁኔታ እንዳይቀጥል — Render በራሱ እንደገና ያስነሳዋል
  setTimeout(() => process.exit(1), 1000).unref();
});