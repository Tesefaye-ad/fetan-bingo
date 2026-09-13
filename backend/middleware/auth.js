const jwt = require("jsonwebtoken");

/**
 * Protects REST routes. Expects: Authorization: Bearer <jwt>
 * The JWT is issued by POST /api/auth/telegram after verifying Telegram initData.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    req.telegramId = payload.telegramId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Same idea, but for verifying a socket handshake token. */
function verifySocketToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { requireAuth, verifySocketToken };
