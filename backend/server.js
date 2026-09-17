require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const connectDB = require("./config/db");

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
app.use(express.json());

app.get("/", (req, res) => res.json({ name: "Fetan Bingo API", status: "running" }));
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);

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
// 👈 ራስ-ጥበቃ (Self Keep-Alive) — ሰርቨሩ እንዳይተኛ
// ═══════════════════════════════════════════════════════
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

setInterval(async () => {
  try {
    const res = await fetch(`${SELF_URL}/health`);
    if (res.ok) {
      console.log(`[keep-alive] pinged at ${new Date().toISOString()}`);
    }
  } catch (err) {
    console.error("[keep-alive] ping failed:", err.message);
  }
}, 4 * 60 * 1000); // 👈 በየ 4 ደቂቃው

// ሲጀመር ወዲያውኑ አንድ ጊዜ ጥቃ
setTimeout(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
    console.log("[keep-alive] initial ping sent");
  } catch (err) {}
}, 10000);

// ═══════════════════════════════════════════════════════
// 👈 ቦቱን ከ server.js ያለው Express app ጋር አገናኝ + Webhook አዘጋጅ
// ═══════════════════════════════════════════════════════
try {
  const { startBot, bot } = require("./bot");
  startBot(app).then(() => {
    // 👈 Webhook ን ከ server.listen በኋላ በእርግጠኝነት አዘጋጅ
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://fetan-bingo-he4x.onrender.com`;

    setTimeout(async () => {
      try {
        await bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`, {
          drop_pending_updates: true,
        });
        console.log(`[bot] Webhook set: ${RENDER_URL}${webhookPath}`);
      } catch (err) {
        console.error("[bot] setWebhook failed:", err.message);
      }
    }, 2000);
  });
} catch (err) {
  console.error("[server] Failed to start Telegram bot:", err.message);
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});