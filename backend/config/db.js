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
    // 👈 ራስ-ሰር ዳግም ግንኙነት
    setTimeout(() => connectDB(), 3000);
  });
  mongoose.connection.on("reconnected", () =>
    console.log("[db] MongoDB reconnected")
  );
}

async function connectDB() {
  // ቀድሞ ከተገናኘ ወይም በመገናኘት ላይ ከሆነ ተወው
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
    setTimeout(() => connectDB(), 3000);
    return;
  }
  isConnecting = false;
}

module.exports = connectDB;