"use strict";
// ═══════════════════════════════════════════════════════
// ADMIN DEPOSIT / WITHDRAWAL SERVICE
//
// ይህ ፋይል በ bot.js, routes/admin.js, telebirr/merchantSms.js እና
// telebirr/depositVerifier.js የሚጠበቁትን ተግባራት ይይዛል፦
//
//   approveTransaction(txId, opts?)      → { ok, transaction, user } | { ok:false, error, code }
//   rejectTransaction(txId, reason?, opts?)
//   isAdminChatId(id)
//   notifyAdminsOfDeposit(tx, user)      → ✅/❌ ቁልፎች ያለው መልዕክት ለአድሚን
//   notifyAdminsOfRejection(user, sms, reason, extra?)
//   maybeAlertReject(user, sms, reason, extra?)
//
// ማስታወሻ፦ የ verifyAndCreditDeposit ቦታው services/telebirr/depositVerifier.js ነው።
// ═══════════════════════════════════════════════════════
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { Notification } = require("../models/User");

// ─── helpers ───────────────────────────────────────────
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fail = (error, code = 400) => ({ ok: false, error, code });

function adminTelegramIds() {
  return String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdminChatId(id) {
  const chat = process.env.ADMIN_CHAT_ID;
  return !!chat && String(id) === String(chat);
}

// መልዕክት የሚደርሰው ቦታ፦ ADMIN_CHAT_ID ካለ እሱ፣ ከሌለ ሁሉም አድሚኖች
function adminTargets() {
  const chat = process.env.ADMIN_CHAT_ID;
  return chat ? [String(chat)] : adminTelegramIds();
}

// Telegram Bot API በቀጥታ (bot.js ን ማስገባት circular dependency ስለሚፈጥር)
async function sendTelegram(chatId, text, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "HTML", ...extra },
      { timeout: 10000 }
    );
    return true;
  } catch (err) {
    console.error(
      "[deposits] telegram send failed:",
      (err.response && err.response.data && err.response.data.description) ||
        err.message
    );
    return false;
  }
}

async function sendToAdmins(text, extra) {
  const targets = adminTargets();
  if (!targets.length) {
    console.warn("[deposits] no admin target (ADMIN_CHAT_ID / ADMIN_TELEGRAM_IDS)");
    return false;
  }
  const results = await Promise.allSettled(
    targets.map((t) => sendTelegram(t, text, extra))
  );
  return results.some((r) => r.status === "fulfilled" && r.value);
}

// ተጠቃሚውን ማሳወቅ (Telegram + በመተግበሪያ ውስጥ) — ስህተት ዋናውን ስራ አያቆምም
async function notifyUser(user, { title, body, type, tgText }) {
  if (!user) return;
  try {
    await Notification.create({ user: user._id, title, body, type });
  } catch (e) {
    console.error("[deposits] notification failed:", e.message);
  }
  if (user.telegramId) await sendTelegram(user.telegramId, tgText || body);
}

// ═══════════════════════════════════════════════════════
// APPROVE
// ዋና መከላከያ፦ status "pending" → "completed" በአንድ atomic ክወና ይገለበጣል፤
// ስለዚህ ሁለት አድሚን (ወይም አድሚን + የመርቻንት SMS) በአንድ ጊዜ ቢያጸድቁ አንዱ ብቻ ያልፋል።
// ═══════════════════════════════════════════════════════
async function approveTransaction(txId, opts = {}) {
  const by = opts.by || "admin";

  const tx = await Transaction.findOneAndUpdate(
    {
      _id: txId,
      status: "pending",
      type: { $in: ["deposit", "withdrawal"] },
      amount: { $gt: 0 },
    },
    {
      $set: {
        status: "completed",
        "meta.approvedAt": new Date(),
        "meta.approvedBy": by,
      },
    },
    { new: true }
  );

  if (!tx) {
    const existing = await Transaction.findById(txId).lean();
    if (!existing) return fail("Transaction not found", 404);
    if (!["deposit", "withdrawal"].includes(existing.type)) {
      return fail("Only deposits/withdrawals can be approved", 400);
    }
    return fail(`Already ${existing.status}`, 409);
  }

  try {
    // ── ተቀማጭ፦ ብሩ ወደ ዋሌት ይገባል ──
    if (tx.type === "deposit") {
      const user = await User.findOneAndUpdate(
        { _id: tx.user },
        { $inc: { balance: tx.amount, totalDeposits: tx.amount } },
        { new: true }
      );
      if (!user) {
        await Transaction.updateOne(
          { _id: tx._id },
          { $set: { status: "failed", "meta.creditError": "user_missing" } }
        );
        return fail("User not found", 404);
      }
      await Transaction.updateOne(
        { _id: tx._id },
        { $set: { balanceAfter: user.balance } }
      );
      tx.balanceAfter = user.balance;

      await notifyUser(user, {
        title: "✅ Deposit Approved",
        body: `Your deposit of ${tx.amount} ETB has been added.`,
        type: "deposit",
        tgText: `✅ <b>ተቀማጭዎ ጸድቋል</b>\n💰 ${fmt(tx.amount)} ETB ወደ ዋሌትዎ ገብቷል።\n💳 ቀሪ ሂሳብ: <b>${fmt(user.balance)} ETB</b>`,
      });
      return { ok: true, transaction: tx, user };
    }

    // ── ወጪ፦ ብሩ ቀድሞ ተቀንሷል፤ እዚህ "ተከፍሏል" ተብሎ ብቻ ይመዘገባል ──
    const user = await User.findOneAndUpdate(
      { _id: tx.user },
      { $inc: { totalWithdrawals: tx.amount } },
      { new: true }
    );
    await notifyUser(user, {
      title: "✅ Withdrawal Approved",
      body: `Your withdrawal of ${tx.amount} ETB has been approved.`,
      type: "withdraw",
      tgText: `✅ <b>የወጪ ጥያቄዎ ጸድቋል</b>\n💰 ${fmt(tx.amount)} ETB${
        tx.meta && tx.meta.phone ? ` ወደ <code>${esc(tx.meta.phone)}</code>` : ""
      } ተልኳል።`,
    });
    return { ok: true, transaction: tx, user };
  } catch (err) {
    // ያልታሰበ ስህተት → ሁኔታውን መልስ (ብር አልተነካም ማለት ነው ወይም $inc አልተሳካም)
    console.error("[deposits] approve failed, reverting:", err);
    await Transaction.updateOne(
      { _id: tx._id, status: "completed" },
      { $set: { status: "pending", "meta.approveError": String(err.message).slice(0, 200) } }
    ).catch(() => {});
    return fail("Could not approve — try again", 500);
  }
}

// ═══════════════════════════════════════════════════════
// REJECT
// ወጪ ከተከለከለ ቀድሞ የተቀነሰው ብር ወደ ተጠቃሚው ይመለሳል።
// ═══════════════════════════════════════════════════════
async function rejectTransaction(txId, reason, opts = {}) {
  const by = opts.by || "admin";
  const cleanReason = reason ? String(reason).slice(0, 300) : "Rejected by admin";

  const tx = await Transaction.findOneAndUpdate(
    {
      _id: txId,
      status: "pending",
      type: { $in: ["deposit", "withdrawal"] },
    },
    {
      $set: {
        status: "failed",
        "meta.rejectedAt": new Date(),
        "meta.rejectedBy": by,
        "meta.rejectReason": cleanReason,
      },
    },
    { new: true }
  );

  if (!tx) {
    const existing = await Transaction.findById(txId).lean();
    if (!existing) return fail("Transaction not found", 404);
    if (!["deposit", "withdrawal"].includes(existing.type)) {
      return fail("Only deposits/withdrawals can be rejected", 400);
    }
    return fail(`Already ${existing.status}`, 409);
  }

  try {
    // ── ወጪ፦ ብሩን መመለስ ──
    if (tx.type === "withdrawal") {
      const user = await User.findOneAndUpdate(
        { _id: tx.user },
        { $inc: { balance: tx.amount } },
        { new: true }
      );
      if (!user) {
        // ተጠቃሚው ከሌለ መመለስ አይቻልም — ሁኔታውን መልሰን አድሚን እንዲያይ እንተወዋለን
        await Transaction.updateOne(
          { _id: tx._id },
          { $set: { status: "pending", "meta.refundError": "user_missing" } }
        );
        return fail("User not found — refund impossible", 404);
      }
      // የመመለሻ መዝገብ (ለታሪክ) — አለመፈጠሩ ብሩን አይነካም
      await Transaction.create({
        user: user._id,
        type: "refund",
        amount: tx.amount,
        balanceAfter: user.balance,
        reference: `WD-REFUND-${tx._id}`,
        status: "completed",
        meta: { reason: "withdrawal_rejected", originalTx: String(tx._id) },
      }).catch((e) => console.error("[deposits] refund record failed:", e.message));

      await notifyUser(user, {
        title: "❌ Withdrawal Rejected",
        body: `Your withdrawal of ${tx.amount} ETB was rejected and refunded.`,
        type: "withdraw",
        tgText: `❌ <b>የወጪ ጥያቄዎ ተቀባይነት አላገኘም</b>\n💰 ${fmt(tx.amount)} ETB ወደ ዋሌትዎ ተመልሷል።\n💳 ቀሪ ሂሳብ: <b>${fmt(user.balance)} ETB</b>`,
      });
      return { ok: true, transaction: tx, user };
    }

    // ── ተቀማጭ፦ ዋሌት አይነካም ──
    const user = await User.findById(tx.user);
    await notifyUser(user, {
      title: "❌ Deposit Rejected",
      body: `Your deposit of ${tx.amount} ETB was not approved.`,
      type: "deposit",
      tgText: `❌ <b>ተቀማጭዎ ተቀባይነት አላገኘም</b>\n💰 ${fmt(tx.amount)} ETB\nምክንያት: ${esc(cleanReason)}\nጥያቄ ካለዎት Support ያግኙ።`,
    });
    return { ok: true, transaction: tx, user };
  } catch (err) {
    console.error("[deposits] reject failed, reverting:", err);
    await Transaction.updateOne(
      { _id: tx._id, status: "failed" },
      { $set: { status: "pending" } }
    ).catch(() => {});
    return fail("Could not reject — try again", 500);
  }
}

// ═══════════════════════════════════════════════════════
// ADMIN ALERTS
// ═══════════════════════════════════════════════════════

// በእጅ ማረጋገጫ የሚፈልግ ተቀማጭ → ✅/❌ ቁልፎች (bot.js: dep_ok / dep_no)
async function notifyAdminsOfDeposit(tx, user) {
  const m = (tx && tx.meta) || {};
  const text =
    `🆕 <b>Deposit — በእጅ ማረጋገጫ</b>\n\n` +
    `👤 <b>${esc(user && user.firstName) || "User"} ${esc(user && user.lastName)}</b>\n` +
    `🆔 <code>${esc(user && user.telegramId)}</code>\n` +
    `📱 <code>${esc((user && user.phone) || "-")}</code>\n\n` +
    `💰 መጠን: <b>${fmt(tx.amount)} ETB</b>\n` +
    `🔖 Txn: <code>${esc(m.transactionId || "-")}</code>\n` +
    `📌 ምክንያት: <code>${esc(m.verificationReason || "-")}</code>\n` +
    (m.verificationDetail ? `ℹ️ ${esc(String(m.verificationDetail).slice(0, 200))}\n` : "") +
    (m.payerName ? `🙍 ከፋይ: ${esc(m.payerName)} ${esc(m.payerPhone || "")}\n` : "") +
    (m.receiptVerified ? `✅ ደረሰኝ በኢትዮ ቴሌኮም ተረጋግጧል\n` : `⚠️ ደረሰኝ አልተረጋገጠም\n`) +
    (m.receiptUrl ? `🔗 ${esc(m.receiptUrl)}\n` : "") +
    `🕐 ${new Date().toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa" })}`;

  return sendToAdmins(text, {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `dep_ok:${tx._id}` },
          { text: "❌ Reject", callback_data: `dep_no:${tx._id}` },
        ],
      ],
    },
  });
}

// ተመሳሳይ ማንቂያ ለአንድ ተጠቃሚ በ 10 ደቂቃ አንድ ጊዜ ብቻ (አድሚን እንዳይጥለቀለቅ)
const ALERT_WINDOW_MS = 10 * 60 * 1000;
const lastAlert = new Map();
function shouldAlert(key) {
  const now = Date.now();
  if (lastAlert.size > 2000) {
    for (const [k, t] of lastAlert) if (now - t > ALERT_WINDOW_MS) lastAlert.delete(k);
  }
  const prev = lastAlert.get(key);
  if (prev && now - prev < ALERT_WINDOW_MS) return false;
  lastAlert.set(key, now);
  return true;
}

async function notifyAdminsOfRejection(user, sms, reason, extra = {}) {
  const key = `${user && user._id}:${reason}`;
  if (!shouldAlert(key)) return false;
  const text =
    `🚨 <b>Deposit ውድቅ / ጥርጣሬ</b>\n\n` +
    `👤 ${esc(user && user.firstName) || "User"} (<code>${esc(user && user.telegramId)}</code>)\n` +
    `📌 ምክንያት: <code>${esc(reason)}</code>\n` +
    (sms && sms.amount ? `💰 ${fmt(sms.amount)} ETB\n` : "") +
    (sms && sms.txnId ? `🔖 Txn: <code>${esc(sms.txnId)}</code>\n` : "") +
    (extra.detail ? `ℹ️ ${esc(String(extra.detail).slice(0, 200))}\n` : "") +
    `🕐 ${new Date().toLocaleString("en-US", { timeZone: "Africa/Addis_Ababa" })}`;
  return sendToAdmins(text);
}

const maybeAlertReject = (user, sms, reason, extra) =>
  notifyAdminsOfRejection(user, sms, reason, extra);

module.exports = {
  approveTransaction,
  rejectTransaction,
  isAdminChatId,
  notifyAdminsOfDeposit,
  notifyAdminsOfRejection,
  maybeAlertReject,
};
