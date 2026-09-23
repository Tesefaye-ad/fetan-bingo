require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

// ═══════════════════════════════════════════════════════
// DB CONNECTION (ከ config/db.js የተዋሃደ)
// ═══════════════════════════════════════════════════════
let isConnecting = false;
let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on("connected", () =>
    console.log("[db] MongoDB connected successfully")
  );
  mongoose.connection.on("error", (err) =>
    console.error("[db] MongoDB error:", err.message)
  );
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] MongoDB disconnected. Will retry...");
    isConnecting = false;
    setTimeout(connectDB, 3000);
  });
  mongoose.connection.on("reconnected", () =>
    console.log("[db] MongoDB reconnected")
  );
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (isConnecting) return;
  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error("[db] MONGO_URI is missing.");
    return;
  }
  isConnecting = true;
  attachListeners();
  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      w: "majority",
    });
    console.log("[db] MongoDB connection pool initialized");
  } catch (err) {
    console.error("[db] Initial connection failed:", err.message);
    isConnecting = false;
    setTimeout(connectDB, 3000);
    return;
  }
  isConnecting = false;
}

// ═══════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════
const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const gameRoutes = require("./routes/game");
const adminRoutes = require("./routes/admin");
const { initGameSocket } = require("./socket/gameSocket");

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((o) => o.trim())
  : "*";

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) =>
  res.json({ name: "Fetan Bingo API", status: "running" })
);
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);
// 👈 user routes ወደ admin ተዋህዷል — አሁን /api/user/* በ auth ውስጥ ነው
app.use("/api/user", authRoutes.userRouter);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
});

initGameSocket(io);

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Fetan Bingo backend running on port ${PORT}`);
});

connectDB();

// ═══════════════════════════════════════════════════════
// KEEP-ALIVE
// ═══════════════════════════════════════════════════════
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    const res = await fetch(`${SELF_URL}/health`);
    if (res.ok) console.log(`[keep-alive] pinged`);
  } catch (err) {
    console.error("[keep-alive] failed:", err.message);
  }
}, 4 * 60 * 1000);

setTimeout(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
    console.log("[keep-alive] initial ping sent");
  } catch (err) {}
}, 10000);

// ═══════════════════════════════════════════════════════
// BOT WEBHOOK
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
  console.error("[server] Failed to start bot:", err.message);
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

module.exports = { connectDB };