const express = require("express");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const { getActiveUserCount } = require("../socket/gameSocket");

const router = express.Router();
router.use(requireAuth);

/** Only lets the request through if the authenticated user is an admin. */
async function requireAdmin(req, res, next) {
  const user = await User.findById(req.userId).select("isAdmin");
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/**
 * GET /api/admin/stats
 * Powers the Admin dashboard's "Active Users" / "Registered Users" cards.
 */
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const registeredUsers = await User.countDocuments();
    res.json({
      activeUsers: getActiveUserCount(),
      registeredUsers,
    });
  } catch (err) {
    console.error("[GET /api/admin/stats] error:", err);
    res.status(500).json({ error: "Could not load admin stats" });
  }
});

module.exports = router;
