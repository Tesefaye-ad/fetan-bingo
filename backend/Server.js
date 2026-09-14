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
// NOTE: the Telegram bot does NOT run here.
// ==========================================
// Server.js used to also launch its own Telegraf bot using the same
// TELEGRAM_BOT_TOKEN as backend/bot.js. Telegram only allows ONE
// long-polling connection per bot token - running both at once (e.g. this
// web service + the bot.js background worker) makes Telegram return 409
// Conflict errors to whichever instance polls second, so the bot behaves
// inconsistently: menu button not set, commands not answered, etc.
// Run the bot exclusively via `npm run bot` (backend/bot.js), deployed as
// its own Render Background Worker, as documented in the README.

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Fetan Bingo backend running on port ${PORT}`);
});

connectDB();

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});