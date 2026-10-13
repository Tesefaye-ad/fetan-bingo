const mongoose = require("mongoose");

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
    setTimeout(() => connectDB(), 3000);
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
    console.error("[db] MONGO_URI is missing. Aborting DB connection.");
    return;
  }

  isConnecting = true;
  attachListeners();

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // ═══════════════════════════════════════════════════════
      // 👈 OPTIMIZED: 5→50 pool for 4500 concurrent users
      //    MongoDB Atlas M0 free tier allows 500 connections
      // ═══════════════════════════════════════════════════════
      maxPoolSize: 50,
      minPoolSize: 10,
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      w: "majority",
      compressors: ["zlib"],
    });
    console.log("[db] Connected (pool 50/10, zlib)");
  } catch (err) {
    console.error("[db] Initial connection failed:", err.message);
    isConnecting = false;
    setTimeout(() => connectDB(), 3000);
    return;
  }
  isConnecting = false;
}

module.exports = connectDB;