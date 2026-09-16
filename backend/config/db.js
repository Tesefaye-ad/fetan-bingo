const mongoose = require("mongoose");

let isConnecting = false;

async function connectDB() {
  if (isConnecting || mongoose.connection.readyState === 1) return;
  isConnecting = true;

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error("[db] MONGO_URI is missing from environment variables.");
    return;
  }

  mongoose.connection.on("connected", () => console.log("[db] MongoDB connected successfully"));
  mongoose.connection.on("error", (err) => console.error("[db] MongoDB error:", err.message));
  mongoose.connection.on("disconnected", () => console.warn("[db] MongoDB disconnected."));

  try {
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 15000 });
  } catch (err) {
    console.error("[db] Initial connection failed:", err.message);
    setTimeout(() => { isConnecting = false; connectDB(); }, 5000);
  }
}

module.exports = connectDB;