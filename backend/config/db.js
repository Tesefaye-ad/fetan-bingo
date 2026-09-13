const mongoose = require("mongoose");

let isConnecting = false;

/**
 * Connects to MongoDB. Safe to call once at boot - Server.js calls this
 * WITHOUT awaiting it before server.listen(), so the HTTP/Socket.io
 * server can bind to the port immediately (this avoids Render's
 * "no open port detected" boot timeout). Mongoose buffers queries made
 * before the connection is ready, so routes/sockets keep working once
 * the connection finishes.
 */
async function connectDB() {
  if (isConnecting || mongoose.connection.readyState === 1) return;
  isConnecting = true;

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoURI) {
    console.error("[db] MONGO_URI is missing from environment variables.");
    return;
  }

  mongoose.connection.on("connected", () => {
    console.log("[db] MongoDB connected successfully");
  });

  mongoose.connection.on("error", (err) => {
    console.error("[db] MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] MongoDB disconnected. Mongoose will retry automatically.");
  });

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 15000,
    });
  } catch (err) {
    console.error("[db] Initial MongoDB connection failed:", err.message);
    // Retry after a short delay instead of crashing the whole process -
    // Render will otherwise kill/restart the service in a crash loop.
    setTimeout(() => {
      isConnecting = false;
      connectDB();
    }, 5000);
  }
}

module.exports = connectDB;
