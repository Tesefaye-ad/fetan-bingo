require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const gameRoutes = require("./routes/game");
const adminRoutes = require("./routes/admin");
const { initGameSocket } = require("./socket/gameSocket");

// ═══════════════════════════════════════════════════════
// DATABASE CONNECTION
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
      maxPoolSize: 10,
      minPoolSize: 2,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    });
    console.log("[db] Connected");
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

// 👈 Telegram Mini App — ሁሉንም origin ፍቀድ
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
});

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.options("*", cors());

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) =>
  res.json({ name: "Fetan Bingo API", status: "running" })
);
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
});

initGameSocket(io);

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Running on port ${PORT}`);
});

connectDB();

// ═══════════════════════════════════════════════════════
// KEEP-ALIVE — በየ 2 ደቂቃው (Render cold start ለመከላከል)
// ═══════════════════════════════════════════════════════
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

setInterval(async () => {
  try {
    const res = await fetch(`${SELF_URL}/health`);
    if (res.ok) console.log(`[keep-alive] pinged`);
  } catch (err) {
    console.error("[keep-alive] failed:", err.message);
  }
}, 2 * 60 * 1000); // 👈 2 ደቂቃ

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

process.on("unhandledRejection", (r) =>
  console.error("[unhandledRejection]", r)
);