// ═══════════════════════════════════════════════════════
// DEPOSITS — SMS ትንተና, አድሚን ማሳወቂያ, approve / reject (ለ bot እና ለ admin panel የሚጋራ)
// ═══════════════════════════════════════════════════════
const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");

const SMS_MAX_CHARS = 1500;

/** ADMIN_CHAT_ID="123,456" → ["123","456"] */
// ADMIN_CHAT_ID ካልተሞላ ቀድሞ በ App.jsx ውስጥ ተጽፎ የነበረው የባለቤቱ ID እንደ መጠባበቂያ ይሠራል
const FALLBACK_ADMIN_IDS = ["494653076"];

function adminChatIds() {
  const ids = String(process.env.ADMIN_CHAT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : FALLBACK_ADMIN_IDS;
}

function isAdminChatId(id) {
  return adminChatIds().includes(String(id));
}

function normalizeSms(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * ከ Telebirr SMS የብር መጠን እና የግብይት ቁጥር ለማውጣት ይሞክራል.
 * ማሳሰቢያ: ይህ ግምት ብቻ ነው — የመጨረሻውን ማረጋገጫ አድሚኑ ያደርጋል.
 */
function parseSms(text) {
  const raw = normalizeSms(text);
  let amount = null;
  const amountPatterns = [
    /(?:ETB|Birr|ብር)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:ETB|Birr|ብር)/i,
  ];
  for (const re of amountPatterns) {
    const m = re.exec(raw);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) {
        amount = n;
        break;
      }
    }
  }

  let txnId = null;
  const idMatch =
    /(?:transaction\s*(?:number|id|no\.?)|ref(?:erence)?\s*(?:number|no\.?)?|የግብይት\s*(?:ቁጥር|መለያ))\s*(?:is|:|፡)?\s*([A-Z0-9]{8,14})\b/i.exec(
      raw
    );
  if (idMatch) txnId = idMatch[1].toUpperCase();

  const smsHash = crypto
    .createHash("sha256")
    .update(raw.toLowerCase())
    .digest("hex");

  return { raw, amount, txnId, smsHash };
}

/** ጽሑፉ የክፍያ SMS ይመስላል? (ተጠቃሚው "Deposit" ሳይጫን ቢልከውም እንዲያልፍ) */
function looksLikeDepositSms(text) {
  const raw = normalizeSms(text);
  if (raw.length < 20) return false;
  const p = parseSms(raw);
  return (
    !!p.amount &&
    /telebirr|transaction|received|transfer|ተቀብለዋል|ተልኳል|ተላልፏል|ግብይት|ብር|ETB/i.test(raw)
  );
}

/** ይህ SMS / የግብይት ቁጥር ቀድሞ (pending ወይም completed) ገብቷል? */
async function findDuplicateDeposit({ txnId, smsHash }, excludeId) {
  const or = [{ "meta.smsHash": smsHash }];
  if (txnId) or.push({ "meta.txnId": txnId });
  const q = {
    type: "deposit",
    status: { $in: ["pending", "completed"] },
    $or: or,
  };
  if (excludeId) q._id = { $ne: excludeId };
  return Transaction.findOne(q).select("_id status amount user").lean();
}

// ───────────────────────── Telegram helpers ─────────────────────────
function getBot() {
  try {
    return require("../bot").bot || null;
  } catch {
    return null;
  }
}

async function notifyUserTelegram(telegramId, text) {
  const bot = getBot();
  if (!bot || !telegramId) return;
  try {
    await bot.telegram.sendMessage(String(telegramId), text);
  } catch (err) {
    console.error("[deposits] notify user failed:", err.message);
  }
}

/** አዲስ ዲፖዚት (ከ SMS ጋር) ለአድሚን ከ ✅ / ❌ ቁልፎች ጋር ይላካል */
async function notifyAdminsOfDeposit(tx, user, extra = {}) {
  const bot = getBot();
  const ids = adminChatIds();
  if (!bot || ids.length === 0) {
    console.warn("[deposits] ADMIN_CHAT_ID or bot missing — admin not notified");
    return false;
  }
  const lines = [
    "🆕 አዲስ Deposit (ማረጋገጫ ይጠብቃል)",
    `👤 ${user.firstName || ""} ${user.username ? "@" + user.username : ""} (ID: ${user.telegramId})`,
    `💰 መጠን: ${tx.amount} ETB`,
  ];
  if (extra.typedAmount && extra.typedAmount !== tx.amount) {
    lines.push(`⚠️ ተጠቃሚው የጻፈው መጠን ይለያል: ${extra.typedAmount} ETB`);
  }
  if (tx.meta?.txnId) lines.push(`🧾 Txn ID: ${tx.meta.txnId}`);
  lines.push(`🔖 Ref: ${tx.reference || tx._id}`);
  if (tx.meta?.sms) {
    lines.push("", "📩 SMS:", String(tx.meta.sms).slice(0, SMS_MAX_CHARS));
  }
  lines.push("", "ብሩ በ Telebirr አካውንትዎ መግባቱን ያረጋግጡ፣ ከዚያ ይወስኑ 👇");

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `dep_ok:${tx._id}` },
        { text: "❌ Reject", callback_data: `dep_no:${tx._id}` },
      ],
    ],
  };

  let sent = 0;
  for (const id of ids) {
    try {
      await bot.telegram.sendMessage(id, lines.join("\n"), {
        reply_markup: keyboard,
      });
      sent++;
    } catch (err) {
      console.error(`[deposits] admin notify failed (${id}):`, err.message);
    }
  }
  return sent > 0;
}

// ───────────────────────── Approve / Reject ─────────────────────────
// ሁለት አድሚኖች (ወይም ሁለት ጊዜ ጠቅታ) በአንድ ጊዜ ቢጫኑ ብሩ ሁለት ጊዜ እንዳይገባ —
// መጀመሪያ status ን በ atomic ስራ pending → completed/failed እናደርጋለን.
async function approveTransaction(id) {
  const existing = await Transaction.findById(id);
  if (!existing) return { ok: false, code: 404, error: "Not found" };
  if (existing.status !== "pending")
    return { ok: false, code: 400, error: "Already processed" };

  if (existing.type === "deposit" && existing.meta?.smsHash) {
    const dup = await findDuplicateDeposit(
      { txnId: existing.meta.txnId, smsHash: existing.meta.smsHash },
      existing._id
    );
    if (dup && dup.status === "completed") {
      return {
        ok: false,
        code: 409,
        error: "ይህ SMS / Txn ID ቀድሞ ተቀባይነት አግኝቷል (ድርብ ክፍያ)",
      };
    }
  }

  const tx = await Transaction.findOneAndUpdate(
    { _id: id, status: "pending" },
    { $set: { status: "completed" } },
    { new: true }
  );
  if (!tx) return { ok: false, code: 400, error: "Already processed" };

  let user = null;
  if (tx.type === "deposit") {
    user = await User.findByIdAndUpdate(
      tx.user,
      { $inc: { balance: tx.amount, totalDeposits: tx.amount } },
      { new: true }
    );
  } else if (tx.type === "withdrawal") {
    user = await User.findByIdAndUpdate(
      tx.user,
      { $inc: { totalWithdrawals: tx.amount } },
      { new: true }
    );
  }
  if (!user) {
    await Transaction.updateOne({ _id: tx._id }, { $set: { status: "pending" } });
    return { ok: false, code: 404, error: "User not found" };
  }
  if (tx.type === "deposit") {
    tx.balanceAfter = user.balance;
    await tx.save();
  }

  const isDep = tx.type === "deposit";
  await Notification.create({
    user: user._id,
    title: isDep ? "✅ Deposit Approved" : "✅ Withdrawal Approved",
    body: isDep
      ? `Your deposit of ${tx.amount} ETB has been added.`
      : `Your withdrawal of ${tx.amount} ETB has been processed.`,
    type: isDep ? "deposit" : "withdraw",
  });
  notifyUserTelegram(
    user.telegramId,
    isDep
      ? `✅ ዲፖዚትዎ ተቀባይነት አግኝቷል: ${tx.amount} ETB ወደ ዋሌትዎ ገብቷል። አዲስ ቀሪ ሂሳብ: ${user.balance} ETB`
      : `✅ ወጪ ጥያቄዎ ተፈጽሟል: ${tx.amount} ETB`
  );
  return { ok: true, transaction: tx, user };
}

async function rejectTransaction(id, reason) {
  const existing = await Transaction.findById(id);
  if (!existing) return { ok: false, code: 404, error: "Not found" };
  if (existing.status !== "pending")
    return { ok: false, code: 400, error: "Already processed" };

  const why = reason || "Rejected";
  const tx = await Transaction.findOneAndUpdate(
    { _id: id, status: "pending" },
    { $set: { status: "failed", meta: { ...(existing.meta || {}), rejectReason: why } } },
    { new: true }
  );
  if (!tx) return { ok: false, code: 400, error: "Already processed" };

  let user = null;
  if (tx.type === "withdrawal") {
    user = await User.findByIdAndUpdate(
      tx.user,
      { $inc: { balance: tx.amount } },
      { new: true }
    );
    if (user) {
      tx.balanceAfter = user.balance;
      await tx.save();
    }
  } else {
    user = await User.findById(tx.user);
  }

  if (user) {
    const isDep = tx.type === "deposit";
    await Notification.create({
      user: user._id,
      title: isDep ? "❌ Deposit Rejected" : "❌ Withdrawal Rejected",
      body: reason || `Your ${tx.type} of ${tx.amount} ETB was rejected.`,
      type: "warning",
    });
    notifyUserTelegram(
      user.telegramId,
      isDep
        ? `❌ ዲፖዚትዎ (${tx.amount} ETB) ተቀባይነት አላገኘም። ችግር ካለ Support ያግኙ።`
        : `❌ ወጪ ጥያቄዎ (${tx.amount} ETB) ውድቅ ሆኗል፤ ገንዘቡ ወደ ዋሌትዎ ተመልሷል።`
    );
  }
  return { ok: true, transaction: tx, user };
}

module.exports = {
  adminChatIds,
  isAdminChatId,
  parseSms,
  looksLikeDepositSms,
  findDuplicateDeposit,
  notifyAdminsOfDeposit,
  approveTransaction,
  rejectTransaction,
  SMS_MAX_CHARS,
};
