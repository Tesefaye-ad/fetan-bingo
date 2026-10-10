// ═══════════════════════════════════════════════════════
// RATE LIMITING — DoS/Spam መከላከያ
// ═══════════════════════════════════════════════════════
const rateLimit = require("express-rate-limit");

// ─── Global limit ───
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 ደቂቃ
  max: 300,                  // 300 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "ብዙ ጥያቄዎች — እባክዎ ይጠብቁ" },
});

// ─── Auth limit (login) ───
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,                   // 10 login/min per IP
  message: { error: "ብዙ login ሙከራዎች — 1 ደቂቃ ይጠብቁ" },
});

// ─── Deposit limit ───
const depositLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,                    // 5 deposit/min
  message: { error: "ብዙ deposit ሙከራዎች — ይጠብቁ" },
});

// ─── Withdraw limit ───
const withdrawLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,   // 5 ደቂቃ
  max: 3,                    // 3 withdraw/5min
  message: { error: "ብዙ withdraw ሙከራዎች — ይጠብቁ" },
});

module.exports = {
  globalLimiter,
  authLimiter,
  depositLimiter,
  withdrawLimiter,
};