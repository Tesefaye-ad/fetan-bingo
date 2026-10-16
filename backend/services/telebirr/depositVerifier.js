"use strict";
// ═══════════════════════════════════════════════════════
// ክፍል 3: DEPOSIT WORKFLOW
// SMS → Parse → Duplicate → Verify → Credit/Reject
// ═══════════════════════════════════════════════════════
const mongoose = require("mongoose");
const User = require("../../models/User");
const Transaction = require("../../models/Transaction");
const { Notification } = require("../../models/User");
const { parseTelebirrSms } = require("./smsParser");
const { verifyReceipt } = require("./receiptVerifier");
const {
  findMerchantSms,
  waitForMerchantSms,
  matchMerchantSms,
  markClaimed,
  approvePendingFor,
} = require("./merchantSms");

const cents = (n) => Math.round(Number(n) * 100);

function config() {
  return {
    merchantPhone: process.env.DEPOSIT_TELEBIRR_PHONE,
    merchantName: process.env.DEPOSIT_TELEBIRR_NAME || "",
    minDeposit: Number(process.env.MIN_DEPOSIT || 20),
    maxDeposit: Number(process.env.MAX_DEPOSIT || 0),
    maxAgeHours: Number(
      process.env.RECEIPT_MAX_AGE_HOURS || process.env.MAX_SMS_AGE_HOURS || 24
    ),
    autoApprove:
      String(process.env.AUTO_APPROVE_DEPOSITS ?? "true").toLowerCase() !==
      "false",
    maxAutoAmount: Number(process.env.MAX_AUTO_DEPOSIT_AMOUNT || 5000),
    requireSenderMatch:
      String(process.env.REQUIRE_SENDER_MATCH).toLowerCase() === "true",
    maxFailsPer10Min: Number(process.env.MAX_FAILED_DEPOSITS_10MIN || 5),
    manualOnFetchFail:
      String(process.env.MANUAL_REVIEW_ON_FETCH_FAIL).toLowerCase() !== "false",
    merchantSmsEnabled: (process.env.MERCHANT_SMS_TOKEN || "").length >= 24,
    merchantSmsWaitSec: Number(process.env.MERCHANT_SMS_WAIT_SECONDS ?? 15),
    receiptCheckEnabled:
      String(process.env.RECEIPT_CHECK_ENABLED ?? "true").toLowerCase() !== "false",
    manualOnReject:
      String(process.env.MANUAL_REVIEW_ON_REJECT).toLowerCase() !== "false",
  };
}

const SMS_ERROR_MESSAGES = {
  fake_receipt_link: "የደረሰኝ ሊንኩ ከኢትዮ ቴሌኮም አይደለም",
  txn_id_conflict: "SMS ትክክል አይደለም",
  txn_id_missing: "ሙሉውን SMS ይለጥፉ",
  amount_missing: "ሙሉውን SMS ይለጥፉ",
};

const DUP_MSG = "ይህ ደረሰኝ ቀድሞ ጥቅም ላይ ውሏል";

function rejected(reason, message, httpStatus = 422) {
  return {
    ok: false,
    status: "rejected",
    reason,
    message: `❌ ክፍያው አልተረጋገጠም / ተቀባይነት አላገኘም — ${message}`,
    httpStatus,
  };
}

// ─── ውድቅ መዝገብ ───
async function logRejection(user, sms, reason) {
  try {
    await Transaction.create({
      user: user._id,
      type: "deposit",
      amount: (sms && sms.amount) || 0,
      balanceAfter: user.balance,
      reference: `REJ-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      status: "failed",
      meta: {
        source: "telebirr_auto",
        autoRejected: true,
        rejectReason: reason,
        rejectedTransactionId: (sms && sms.txnId) || null,
      },
    });
  } catch (err) {
    console.error("[deposit] logRejection failed:", err.message);
  }
}

// ─── Atomic Credit ───
async function applyCredit({ user, amount, sms, receipt, pending }, session) {
  const opts = session ? { session } : {};

  const meta = {
    ...(pending ? pending.meta || {} : {}),
    source: "telebirr_auto",
    gateway: "telebirr",
    transactionId: sms.txnId,
    smsFingerprint: sms.fingerprint,
    smsRaw: sms.raw.slice(0, 500),
    receiptUrl: sms.receiptUrl,
    receiptVia: receipt ? receipt.via : null,
    receiptPaymentDate: receipt && receipt.data ? receipt.data.paymentDate : null,
    payerName: receipt && receipt.data ? receipt.data.payerName : null,
    payerPhone: receipt && receipt.data ? receipt.data.payerPhone : null,
    autoVerifiedAt: new Date(),
  };

  // ① Transaction መያዝ
  let tx;
  if (pending) {
    tx = await Transaction.findOneAndUpdate(
      { _id: pending._id, user: user._id, status: "pending" },
      { $set: { status: "completed", amount, meta } },
      { new: true, ...opts }
    );
    if (!tx) {
      throw Object.assign(new Error("pending_already_processed"), {
        custom: true,
      });
    }
  } else {
    const created = await Transaction.create(
      [
        {
          user: user._id,
          type: "deposit",
          amount,
          balanceAfter: 0,
          reference: `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`,
          status: "completed",
          meta,
        },
      ],
      opts
    );
    tx = created[0];
  }

  // ② Wallet ማሳደግ
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { balance: amount, totalDeposits: amount } },
    { new: true, ...opts }
  );
  if (!updated) {
    throw Object.assign(new Error("user_missing"), { custom: true });
  }

  // ③ balanceAfter
  await Transaction.updateOne(
    { _id: tx._id },
    { $set: { balanceAfter: updated.balance } },
    opts
  );
  tx.balanceAfter = updated.balance;

  return { tx, user: updated };
}

const isNoTxnSupport = (e) =>
  e &&
  (e.codeName === "IllegalOperation" ||
    /replica set|Transaction numbers/i.test(e.message || ""));

async function creditWithSession(args) {
  let session;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      result = await applyCredit(args, session);
    });
    return result;
  } catch (err) {
    if (!isNoTxnSupport(err)) throw err;
    console.warn(
      "[deposit] Mongo transactions unavailable — sequential fallback"
    );
    try {
      return await applyCredit(args, undefined);
    } catch (e) {
      if (e.custom && e.message === "user_missing") {
        await Transaction.updateOne(
          { "meta.transactionId": args.sms.txnId },
          { $set: { status: "failed", "meta.creditError": e.message } }
        ).catch(() => {});
      }
      throw e;
    }
  } finally {
    if (session) await session.endSession().catch(() => {});
  }
}

// ─── በእጅ ማረጋገጫ (ደረሰኝ ማምጣት ሲከሽፍ) ───
async function queueManualReview({ user, sms, amount, pending, reason, receipt }) {
  try {
    const meta = {
      source: "telebirr_auto",
      transactionId: sms.txnId,
      smsFingerprint: sms.fingerprint,
      smsRaw: sms.raw.slice(0, 500),
      requiresManualReview: true,
      verificationReason: reason,
      verificationDetail: (receipt && !receipt.ok && (receipt.message || receipt.detail)) || null,
      receiptVerified: !!(receipt && receipt.ok),
      receiptUrl: sms.receiptUrl,
      receiptVia: receipt && receipt.ok ? receipt.via : null,
      receiptPaymentDate:
        receipt && receipt.ok && receipt.data ? receipt.data.paymentDate : null,
      payerName: receipt && receipt.ok && receipt.data ? receipt.data.payerName : null,
      payerPhone: receipt && receipt.ok && receipt.data ? receipt.data.payerPhone : null,
    };

    let tx;
    if (pending) {
      tx = await Transaction.findOneAndUpdate(
        { _id: pending._id, user: user._id, status: "pending" },
        { $set: { meta: { ...(pending.meta || {}), ...meta }, amount } },
        { new: true }
      );
    } else {
      tx = await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        balanceAfter: user.balance,
        reference: `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        status: "pending",
        meta,
      });
    }

    if (!tx) return null;

    try {
      const { notifyAdminsOfDeposit } = require("../deposits");
      await notifyAdminsOfDeposit(tx, user);
    } catch (err) {
      console.error("[deposit] admin notify failed:", err.message);
    }

    return tx;
  } catch (err) {
    if (err && err.code === 11000) return "duplicate";
    throw err;
  }
}

// ─── ክፍያው መድረሱን ማረጋገጥ ───
async function verifyPayment({ sms, expectedAmount, user, cfg }) {
  if (cfg.merchantSmsEnabled) {
    let rec = await findMerchantSms(sms.txnId);
    if (!rec && cfg.merchantSmsWaitSec > 0) {
      rec = await waitForMerchantSms(sms.txnId, cfg.merchantSmsWaitSec);
    }
    if (rec) {
      const m = matchMerchantSms(rec, {
        expectedAmount,
        userSmsMs: sms.timestamp && sms.timestamp.ms,
        maxAgeHours: cfg.maxAgeHours,
      });
      return m.ok
        ? { ok: true, via: "merchant_sms", data: m.data }
        : { ok: false, reason: m.reason, message: m.message };
    }
    if (!cfg.receiptCheckEnabled) {
      return {
        ok: false,
        reason: "awaiting_merchant_sms",
        message: "ክፍያው ወደ መርቻንት ስልክ ገና አልደረሰም",
        manualReview: true,
        detail: "no_merchant_sms",
      };
    }
  }
  return verifyReceipt({
    txnId: sms.txnId,
    expectedAmount,
    smsTimestampMs: sms.timestamp && sms.timestamp.ms,
    merchant: { phone: cfg.merchantPhone, name: cfg.merchantName },
    payerPhone: cfg.requireSenderMatch ? user.phone : null,
    maxAgeHours: cfg.maxAgeHours,
  });
}

// ═══════════════════════════════════════════════════════
// ዋና ተግባር
// ═══════════════════════════════════════════════════════
async function verifyAndCreditDeposit({ userId, smsText, reference }) {
  const cfg = config();

  // ─── 0) User ───
  const user = await User.findById(userId);
  if (!user) return rejected("user_not_found", "ተጠቃሚው አልተገኘም", 404);
  if (user.isBanned) return rejected("banned", "አካውንትዎ ታግዷል", 403);

  // ─── Brute force ───
  const recentFails = await Transaction.countDocuments({
    user: user._id,
    type: "deposit",
    status: "failed",
    "meta.autoRejected": true,
    createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  });
  const recentQueued = await Transaction.countDocuments({
    user: user._id,
    type: "deposit",
    status: "pending",
    "meta.requiresManualReview": true,
    "meta.receiptVerified": false,
    createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  });
  if (recentFails + recentQueued >= cfg.maxFailsPer10Min) {
    return rejected(
      "too_many_attempts",
      "ብዙ ጊዜ ሞክረዋል። ከ10 ደቂቃ በኋላ ይሞክሩ",
      429
    );
  }

  // ─── 1) SMS መተንተን ───
  const sms = parseTelebirrSms(smsText);
  if (!sms.ok) {
    const first = sms.errors[0];
    return rejected(
      first,
      SMS_ERROR_MESSAGES[first] || "SMS ማንበብ አልተቻለም"
    );
  }
  if (!sms.receiptUrl) {
    return rejected(
      "receipt_link_missing",
      "ሙሉውን SMS ይለጥፉ"
    );
  }
  if (sms.direction === "received") {
    return rejected(
      "wrong_direction",
      "ይህ የተቀበሉበት SMS ነው — እርስዎ የላኩበትን SMS ይለጥፉ"
    );
  }

  // ─── 2) የተጠየቀው መጠን ───
  let pending = null;
  if (reference) {
    pending = await Transaction.findOne({
      user: user._id,
      type: "deposit",
      reference: String(reference),
      status: "pending",
    });
    if (!pending || (pending.meta && pending.meta.transactionId)) {
      return rejected(
        "reference_invalid",
        "የዲፖዚት ጥያቄው አልተገኘም ወይም ቀድሞ ተጠቅሟል"
      );
    }
  }
  const expectedAmount = pending ? pending.amount : sms.amount;

  if (cents(sms.amount) !== cents(expectedAmount)) {
    await logRejection(user, sms, "amount_mismatch");
    return rejected(
      "amount_mismatch",
      `በ SMS ላይ ያለው መጠን (${sms.amount}) ከጠየቁት (${expectedAmount}) ጋር አይመሳሰልም`
    );
  }
  if (sms.amount < cfg.minDeposit) {
    return rejected(
      "below_minimum",
      `አነስተኛ ማስገባት ${cfg.minDeposit} ብር ነው`
    );
  }
  if (cfg.maxDeposit && sms.amount > cfg.maxDeposit) {
    return rejected(
      "above_maximum",
      `ከፍተኛ ማስገባት ${cfg.maxDeposit} ብር ነው`
    );
  }

  // ─── 3) Duplicate ───
  const dup = await Transaction.findOne({
    $or: [
      { "meta.transactionId": sms.txnId },
      { "meta.smsFingerprint": sms.fingerprint },
    ],
  })
    .select("_id status")
    .lean();

  if (dup) {
    await logRejection(user, sms, "duplicate");
    return rejected("duplicate", DUP_MSG, 409);
  }

  // ─── 4) Online ደረሰኝ ማረጋገጫ ───
  const receipt = await verifyPayment({ sms, expectedAmount, user, cfg });

  if (!receipt.ok) {
    console.error(
      `[deposit] ደረሰኝ አልጸደቀም txn=${sms.txnId} reason=${receipt.reason} detail=${receipt.detail || receipt.message || "-"}`
    );

    // ሲስተሙ በራሱ ያላጸደቀው → ወደ አድሚን (ዋሌት አይነካም)
    const sendToAdmin =
      cfg.manualOnReject || (receipt.manualReview && cfg.manualOnFetchFail);
    if (sendToAdmin) {
      const q = await queueManualReview({
        user,
        sms,
        amount: sms.amount,
        pending,
        reason: receipt.reason,
        receipt,
      });
      if (q === "duplicate") return rejected("duplicate", DUP_MSG, 409);
      if (q) {
        // SMS በዚህ መካከል ከደረሰ (ውድድር) → አሁኑኑ ይጸድቃል
        if (cfg.merchantSmsEnabled) {
          try {
            const rec = await findMerchantSms(sms.txnId);
            const r = rec ? await approvePendingFor(rec) : null;
            if (r && r.ok) {
              return {
                ok: true,
                status: "approved",
                message: `✅ ክፍያው ተሳክቷል! ${sms.amount} ብር ወደ ዋሌትዎ ገብቷል።`,
                amount: sms.amount,
                transactionId: sms.txnId,
                reference: q.reference,
                balance: r.user && r.user.balance,
                httpStatus: 200,
              };
            }
          } catch (e) {
            console.error("[deposit] merchant-sms recheck failed:", e.message);
          }
        }
        return {
          ok: false,
          status: "manual_review",
          reason: receipt.reason,
          message:
            receipt.reason === "awaiting_merchant_sms"
              ? "⏳ ክፍያዎ ገና አልደረሰንም። ሲደርስ በራስ ሰር ይጸድቃል፤ ካልሆነ አስተዳዳሪ ያጣራል።"
              : receipt.manualReview
              ? "⏳ ደረሰኙን ማረጋገጥ አልተቻለም — ጥያቄዎ ለአስተዳዳሪ ተልኳል። አስተዳዳሪው ካጸደቀ በኋላ ብሩ ይገባል።"
              : "⚠️ ክፍያውን ማጽደቅ አልተቻለም — ጥያቄዎ ለአስተዳዳሪ ተልኳል። አስተዳዳሪው ካጣራ በኋላ ብሩ ይገባል።",
          reference: q.reference,
          httpStatus: 202,
        };
      }
    }

    // ወደ አድሚን ካልተላከ (ቅንብሩ ከጠፋ)
    if (receipt.manualReview) {
      return rejected(
        receipt.reason,
        "ደረሰኙን ማረጋገጥ አልተቻለም ትንሽ ቆይተው ተመሳሳዩን SMS እንደገና ይላኩ",
        503
      );
    }
    await logRejection(user, sms, receipt.reason);
    return rejected(receipt.reason, receipt.message);
  }

  // ─── 4.5) ከራስ-ሰር ገደብ በላይ ወይም auto-approve ከጠፋ → አድሚን ያጽድቃል ───
  if (!cfg.autoApprove || (cfg.maxAutoAmount > 0 && sms.amount > cfg.maxAutoAmount)) {
    const q = await queueManualReview({
      user,
      sms,
      amount: sms.amount,
      pending,
      reason: cfg.autoApprove ? "exceeds_auto_limit" : "auto_approve_disabled",
      receipt,
    });
    if (q === "duplicate") return rejected("duplicate", DUP_MSG, 409);
    if (q) {
      return {
        ok: false,
        status: "manual_review",
        reason: "exceeds_auto_limit",
        message:
          "✅ ደረሰኙ ተረጋግጧል — ጥያቄዎ ለአስተዳዳሪ ተልኳል። አስተዳዳሪው ካጸደቀ በኋላ ብሩ ወደ ዋሌትዎ ይገባል።",
        reference: q.reference,
        httpStatus: 202,
      };
    }
  }

  // ─── 5) ✅ Credit ───
  let credited;
  try {
    credited = await creditWithSession({
      user,
      amount: sms.amount,
      sms,
      receipt,
      pending,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      await logRejection(user, sms, "duplicate");
      return rejected("duplicate", DUP_MSG, 409);
    }
    if (err && err.message === "pending_already_processed") {
      return rejected("reference_invalid", "የዲፖዚት ጥያቄው ቀድሞ ተሰርቷል", 409);
    }
    console.error("[deposit] credit failed:", err);
    return {
      ok: false,
      status: "error",
      reason: "internal_error",
      message:
        "⚠️ ስህተት ተፈጥሯል። ገንዘብዎ አልተቀነሰም — እባክዎ እንደገና ይሞክሩ ወይም Support ያግኙ።",
      httpStatus: 500,
    };
  }

  if (receipt.via === "merchant_sms") {
    await markClaimed(sms.txnId, user._id);
  }

  // ─── Notification (fire-and-forget) ───
  Notification.create({
    user: credited.user._id,
    title: "✅ Deposit Approved",
    body: `Your deposit of ${sms.amount} ETB has been added.`,
    type: "deposit",
  }).catch((e) =>
    console.error("[deposit] notification failed:", e.message)
  );

  return {
    ok: true,
    status: "approved",
    message: `✅ ክፍያው ተሳክቷል! ${sms.amount} ብር ወደ ዋሌትዎ ገብቷል።`,
    amount: sms.amount,
    transactionId: sms.txnId,
    reference: credited.tx.reference,
    balance: credited.user.balance,
    httpStatus: 200,
  };
}

module.exports = { verifyAndCreditDeposit };