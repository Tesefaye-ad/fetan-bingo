require("dotenv").config();
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

// ═══════════════════════════════════════════════════════
// RATE LIMITERS (ለ DoS/Spam መከላከያ)
// ═══════════════════════════════════════════════════════
const {
  globalLimiter,
  authLimiter,
  depositLimiter,
  withdrawLimiter,
} = require("./middleware/rateLimit");

// ═══════════════════════════════════════════════════════
// DATABASE CONNECTION — የተስተካከለ (512MB Render)
// ═══════════════════════════════════════════════════════
let isConnecting = false;
let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("connected", () =>
    console.log("[db] MongoDB connected")
  );
  mongoose.connection.on("error", (err) =>
    console.error("[db] Error:", err.message)
  );
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] Disconnected. Retrying...");
    isConnecting = false;
    setTimeout(connectDB, 3000);
  });
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (isConnecting) return;

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error("[db] MONGO_URI missing");
    return;
  }

  isConnecting = true;
  attachListeners();

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // 👈 የተስተካከለ ለ 512MB Render
      maxPoolSize: 5,          // 10 → 5
      minPoolSize: 1,          // 2  → 1
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      // 👈 Network compression — bandwidth ይቆጥባል
      compressors: ["zlib"],
    });
    console.log("[db] Connected (pool 5/1, zlib)");
  } catch (err) {
    console.error("[db] Failed:", err.message);
    isConnecting = false;
    setTimeout(connectDB, 3000);
    return;
  }
  isConnecting = false;
}

// ═══════════════════════════════════════════════════════
// APP SETUP
// ═══════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((o) => o.trim())
  : "*";

// ═══════════════════════════════════════════════════════
// SOCKET.IO — ለ 6000+ ተጠቃሚ የተስተካከለ
// ═══════════════════════════════════════════════════════
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },

  // 👈 ዋና ማስተካከያዎች
  serveClient: false,                // ~180KB/client ይቆጥባል
  perMessageDeflate: {
    threshold: 1024,                 // > 1KB ብቻ compress
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
app.use(express.json({ limit: "256kb" })); // 👈 1mb → 256kb

app.get("/", (req, res) =>
  res.json({ name: "Fetan Bingo API", status: "running" })
);

// 👈 የማህደረ ትውስታ መከታተያ
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
// RATE LIMITERS — ከ route mounting በፊት
// ═══════════════════════════════════════════════════════
app.use("/api", globalLimiter);
app.use("/api/auth/telegram", authLimiter);
app.use("/api/wallet/deposit", depositLimiter);
app.use("/api/wallet/withdraw", withdrawLimiter);

// ═══════════════════════════════════════════════════════
// ROUTES — MOUNT
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
// AUTO CLEANUP — በየ 2 ሳምንቱ አላስፈላጊ ውሂብ ያጠፋል
// ═══════════════════════════════════════════════════════
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

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

// ከዚያ በየ 2 ሳምንቱ
setInterval(runCleanup, TWO_WEEKS);

// ═══════════════════════════════════════════════════════
// KEEP-ALIVE (Render cold start ለመከላከል)
// ═══════════════════════════════════════════════════════
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

setInterval(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
  } catch (err) {}
}, 10 * 60 * 1000); // 👈 4 ደቂቃ → 10 ደቂቃ

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
      process.env.RENDER_EXTERNAL_URL ||
      `https://fetan-bingo-he4x.onrender.com`;

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
  // አይወጣ — Render በራሱ ያስተዳድረዋል
});