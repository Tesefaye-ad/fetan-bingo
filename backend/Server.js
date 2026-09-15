require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Telegraf } = require("telegraf");

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
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ name: "Fetan Bingo API", status: "running" });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
});

initGameSocket(io);

// ==========================================
// Telegram Bot Integration (በዚሁ ሰርቨር ውስጥ አብሮ የሚሰራ)
// ==========================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.BOT_WEBAPP_URL || process.env.CLIENT_URL || "https://fetan-bingo.vercel.app";

if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    ctx.reply("እንኳን ወደ Fetan Lottery በሰላም መጡ! 🎮\nጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ።", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 ጨዋታውን ክፈት (Open Game)", web_app: { url: WEBAPP_URL } }]
        ]
      }
    });
  });

  bot.launch()
    .then(() => console.log("[telegram-bot] Bot started successfully alongside the server!"))
    .catch((err) => console.error("[telegram-bot] Startup error:", err));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
} else {
  console.warn("[telegram-bot] TELEGRAM_BOT_TOKEN is not defined in environment variables.");
}

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Fetan Bingo backend running on port ${PORT}`);
});

connectDB();

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});