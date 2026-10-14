const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    // Fail fast — ይህ የደህንነት አደጋ ነው
    throw new Error(
      "[auth] JWT_SECRET is missing or too short. Set a strong secret in .env"
    );
  }
  return secret;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Missing auth token" });

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.userId = payload.userId;
    req.telegramId = payload.telegramId;
    next();
  } catch (err) {
    if (err.message?.includes("JWT_SECRET")) {
      console.error(err.message);
      return res.status(500).json({ error: "Server auth misconfigured" });
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function verifySocketToken(token) {
  try {
    if (!token) return null;
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

module.exports = { requireAuth, verifySocketToken };