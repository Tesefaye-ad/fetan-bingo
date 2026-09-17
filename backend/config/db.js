const mongoose = require("mongoose");

let isConnecting = false;

async function connectDB() {
  if (isConnecting || mongoose.connection.readyState === 1) return;
  isConnecting = true;

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error("[db] MONGO_URI is missing.");
    return;
  }

  mongoose.connection.on("connected", () => console.log("[db] MongoDB connected successfully"));
  mongoose.connection.on("error", (err) => console.error("[db] MongoDB error:", err.message));
  mongoose.connection.on("disconnected", () => console.warn("[db] MongoDB disconnected."));

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      // 👇 አዲስ የተጨመሩ
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      w: "majority",
    });
    console.log("[db] MongoDB connection pool initialized");
  } catch (err) {
    console.error("[db] Initial connection failed:", err.message);
    setTimeout(() => { isConnecting = false; connectDB(); }, 3000);
  }
}

module.exports = connectDB;