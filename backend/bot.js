require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const crypto = require("crypto");
const { verifyAndCreditDeposit } = require("./services/telebirr/depositVerifier");
const {
  approveTransaction,
  rejectTransaction,
  isAdminChatId,
} = require("./services/deposits");

const User = require("./models/User");
const Transaction = require("./models/Transaction");
const { Notification } = require("./models/User");

// ═══════════════════════════════════════════════════════
// ADMIN TELEGRAM IDs — from env (validated)
// ═══════════════════════════════════════════════════════
const ADMIN_TELEGRAM_IDS = String(process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (ADMIN_TELEGRAM_IDS.length === 0) {
  throw new Error("[bot] ADMIN_TELEGRAM_IDS is required");
}

// ═══════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════
const BANNER_IMAGE_URL =
  process.env.BOT_BANNER_URL ||
  "https://i.ibb.co/tMBQz2kt/fb.jpg";

let bannerFileId = process.env.BOT_BANNER_FILE_ID || null;

function bannerUrlIfValid() {
  return BANNER_IMAGE_URL &&
    /^https?:\/\//.test(BANNER_IMAGE_URL) &&
    (/\.(jpe?g|png|webp)(\?.*)?$/i.test(BANNER_IMAGE_URL) ||
      /^https?:\/\/i\.ibb\.co\//i.test(BANNER_IMAGE_URL))
    ? BANNER_IMAGE_URL
    : null;
}

async function sendWelcome(ctx) {
  const extra = { caption: MAIN_MENU_TEXT, ...mainKeyboard() };

  if (bannerFileId) {
    try {
      await ctx.replyWithPhoto(bannerFileId, extra);
      return true;
    } catch (err) {
      bannerFileId = null;
      console.error("[/start] cached banner failed:", err.message);
    }
  }

  const url = bannerUrlIfValid();
  if (url) {
    try {
      const msg = await ctx.replyWithPhoto(url, extra);
      if (!bannerFileId && msg && Array.isArray(msg.photo) && msg.photo.length) {
        bannerFileId = msg.photo[msg.photo.length - 1].file_id;
        console.log(`[bot] ✅ banner file_id cached (from URL): ${bannerFileId}`);
        console.log(`[bot] ⚠️ ACTION REQUIRED: ይህንን file_id ኮፒ አድርገው Render ውስጥ BOT_BANNER_FILE_ID በሚል ስም ያስገቡት!`);
      }
      return true;
    } catch (err) {
      console.error("[/start] URL banner failed:", err.message);
    }
  }

  await ctx.reply(MAIN_MENU_TEXT, mainKeyboard()).catch(() => {});
  return false;
}

// ═══════════════════════════════════════════════════════
// ENV
// ═══════════════════════════════════════════════════════
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.BOT_WEBAPP_URL;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "@FetanBingoSupport";
const DEPOSIT_PHONE = process.env.DEPOSIT_TELEBIRR_PHONE;
const DEPOSIT_NAME = process.env.DEPOSIT_TELEBIRR_NAME || "";
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const REFERRAL_BONUS = Number(process.env.REFERRAL_BONUS || 5);
const REGISTRATION_BONUS = 10;

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing. Aborting.");
  process.exit(1);
}
if (!DEPOSIT_PHONE) {
  console.error("[bot] DEPOSIT_TELEBIRR_PHONE is missing. Aborting.");
  process.exit(1);
}

const PHONE_RE = /^(09|07|\+2519|\+2517|2519|2517)\d{8}$/;

const bot = new Telegraf(BOT_TOKEN);

// ═══════════════════════════════════════════════════════
// CONVERSATION STATE
// ═══════════════════════════════════════════════════════
const pendingAction = new Map();

function setStep(userId, data) {
  pendingAction.set(String(userId), data);
}
function getStep(userId) {
  return pendingAction.get(String(userId));
}
function clearStep(userId) {
  pendingAction.delete(String(userId));
}

// ═══════════════════════════════════════════════════════
// MAIN KEYBOARD
// ═══════════════════════════════════════════════════════
const MAIN_MENU_TEXT =
  "👋 Welcome to Fetan Bingo! Choose an option below.\n\n" +
  "እንኳን ወደ Fetan Bingo በደህና መጡ! ከታች ያሉትን ቁልፎች በመጠቀም ጨዋታውን መጫወት ይችላሉ።";

function mainKeyboard() {
  const playButton = WEBAPP_URL
    ? Markup.button.webApp("Play 🎮", WEBAPP_URL)
    : Markup.button.callback("Play 🎮", "play_not_configured");

  return Markup.inlineKeyboard([
    [playButton, Markup.button.callback("Register 📝", "action_register")],
    [
      Markup.button.callback("Check Balance 💵", "action_balance"),
      Markup.button.callback("Deposit 💵", "action_deposit"),
    ],
    [
      Markup.button.callback("Withdraw 📤", "action_withdraw"),
      Markup.button.callback("Invite 🔗", "action_invite"),
    ],
    [
      Markup.button.callback("Instruction 📖", "action_instruction"),
      Markup.button.callback("Contact Support ☎️", "action_support"),
    ],
  ]);
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function formatMoney(n) {
  return Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID) return;
  try {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, {
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error("[bot] admin notify failed:", err.message);
  }
}

async function getOrCreateUser(ctx, referredBy) {
  try {
    const tgUser = ctx.from;
    if (!tgUser) return null;
    const telegramId = String(tgUser.id);
    const shouldBeAdmin = ADMIN_TELEGRAM_IDS.includes(telegramId);

    const user = await User.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          username: tgUser.username,
          firstName: tgUser.first_name,
          lastName: tgUser.last_name,
          lastActiveAt: new Date(),
        },
        $setOnInsert: {
          balance: 0,
          bonusBalance: 0,
          gamesPlayed: 0,
          gamesWon: 0,
          referralCount: 0,
          isBanned: false,
          isAdmin: shouldBeAdmin,
          phone: null,
          referredBy:
            referredBy && referredBy !== telegramId ? referredBy : undefined,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    if (shouldBeAdmin && user && !user.isAdmin) {
      await User.updateOne({ telegramId }, { $set: { isAdmin: true } });
      user.isAdmin = true;
    }

    return user;
  } catch (err) {
    console.error("[getOrCreateUser] error:", err.message);
    return null;
  }
}

async function processReferralBonus(telegramId) {
  try {
    const claimed = await User.findOneAndUpdate(
      {
        telegramId,
        referredBy: { $exists: true, $nin: [null, "", telegramId] },
        referralRewarded: { $ne: true },
      },
      { $set: { referralRewarded: true } },
      { new: true }
    );
    if (!claimed) return;

    const inviter = await User.findOneAndUpdate(
      { telegramId: claimed.referredBy, isBanned: { $ne: true } },
      { $inc: { referralCount: 1, bonusBalance: REFERRAL_BONUS } },
      { new: true }
    );

    if (inviter) {
      bot.telegram
        .sendMessage(
          inviter.telegramId,
          `🎉 Someone joined using your invite link! You earned ${REFERRAL_BONUS} ETB bonus.`
        )
        .catch(() => {});
    }
  } catch (err) {
    console.error("[processReferralBonus] error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════
// /start
// ═══════════════════════════════════════════════════════
bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || "";
    const referredBy = payload.startsWith("ref_") ? payload.slice(4) : null;
    const telegramId = String(ctx.from.id);

    clearStep(telegramId);

    sendWelcome(ctx).catch((err) =>
      console.error("[/start] welcome failed:", err.message)
    );

    setImmediate(() => {
      getOrCreateUser(ctx, referredBy)
        .then((user) => {
          if (user && referredBy) {
            processReferralBonus(telegramId).catch((err) =>
              console.error("[/start] referral error:", err.message)
            );
          }
        })
        .catch((err) =>
          console.error("[/start] background error:", err.message)
        );
    });
  } catch (err) {
    console.error("[/start] error:", err.message);
  }
});

bot.action("play_not_configured", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await ctx.reply("The game link isn't configured yet.");
});

// ═══════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════
const handleRegister = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return ctx.reply("Please try again.");

  if (user.phone) {
    return ctx.reply(
      `✅ አስቀድመው ተመዝግበዋል!\n\nName: ${
        user.firstName || "User"
      }\nPhone: ${user.phone}`,
      mainKeyboard()
    );
  }

  await ctx.reply(
    "📝 እባክዎ ለመመዝገብ ስልክ ቁጥርዎን ያጋሩ:\n\n(Please share your phone number to register:)",
    Markup.keyboard([[Markup.button.contactRequest("📞 Share Contact")]])
      .resize()
      .oneTime()
  );
};

bot.hears("Register 📝", handleRegister);
bot.action("action_register", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleRegister(ctx);
});

bot.on("contact", async (ctx) => {
  try {
    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      return ctx.reply("❌ እባክዎ የራስዎን ስልክ ቁጥር ብቻ ያጋሩ።");
    }

    const user = await getOrCreateUser(ctx);
    if (!user) return;

    const isNewRegistration = !user.phone;

    const updateData = {
      $set: { phone: contact.phone_number },
    };

    if (isNewRegistration) {
      updateData.$inc = { balance: REGISTRATION_BONUS };
    }

    await User.updateOne({ telegramId: user.telegramId }, updateData);

    let replyText = `✅ ስልክ ቁጥርዎ በተሳካ ሁኔታ ተመዝግቧል!\n📞 Phone: ${contact.phone_number}`;

    if (isNewRegistration) {
      replyText += `\n\n🎉 አዲስ ተመዝጋቢ ስለሆኑ ${REGISTRATION_BONUS} ብር ቦነስ ተሰጥቶዎታል!`;
      await notifyAdmin(
        `🆕 <b>New Registration</b>\n\n` +
          `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
          `📱 ${contact.phone_number}\n` +
          `🎁 Bonus: +${REGISTRATION_BONUS} ETB`
      );
    }

    await ctx.reply(replyText, Markup.removeKeyboard());
    await ctx.reply(MAIN_MENU_TEXT, mainKeyboard());
  } catch (err) {
    console.error("[contact handler] error:", err.message);
  }
});

// ═══════════════════════════════════════════════════════
// CHECK BALANCE
// ═══════════════════════════════════════════════════════
const handleBalance = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const text =
    `🧳 <b>Account Info</b>\n\n` +
    `👤 Name: <b>${esc(user.firstName || "User")} ${esc(user.lastName || "")}</b>\n` +
    `📱 Phone: ${esc(user.phone || "Not registered")}\n` +
    `💰 Main: <b>${formatMoney(user.balance)} ETB</b>\n`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("📥 Deposit", "action_deposit"),
      Markup.button.callback("📤 Withdraw", "action_withdraw"),
    ],
    [Markup.button.callback("📋 COPY CODE", "copy_code")],
  ]);

  await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
};

bot.hears("Check Balance 💵", handleBalance);
bot.action("action_balance", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleBalance(ctx);
});

bot.action("copy_code", async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    await ctx.answerCbQuery("✅ ኮድ ተቀድቷል!");
    await ctx.reply(
      `📋 የእርስዎ መታወቂያ ኮድ: \`${user.telegramId}\`\n\n(ለመቅዳት ከላይ ያለውን ቁጥር ተጭነው ይያዙ)`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[copy_code] error:", err.message);
  }
});

// ═══════════════════════════════════════════════════════
// DEPOSIT FLOW
// ═══════════════════════════════════════════════════════
const handleDeposit = async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) {
      return ctx.reply("⚠️ እባክዎ እንደገና ይሞክሩ።", mainKeyboard());
    }

    setStep(user.telegramId, { type: "deposit" });

    const text =
      `💵 <b>Deposit Money</b>\n\n` +
      `✨ ብር ማስገባት የሚችሉት አሁን በተቀመጠው የ Telebirr አካውንት ብቻ ነው::\n\n` +
      `<b>የሚቀጥሉት እርምጃዎች:</b>\n\n` +
      `1️⃣ ወደ ቴሌብር ቁጥር ይላኩ:\n` +
      `<code>${DEPOSIT_PHONE}</code>\n` +
      `👤 <b>${esc(DEPOSIT_NAME)}</b>\n\n` +
      `2️⃣ የተላከበትን <b>ሙሉ SMS</b> ኮፒ አድርገው እዚህ ላይ Paste ያድርጉ\n\n` +
      `⚠️ <i>አነስተኛ: ${MIN_DEPOSIT} ETB</i>\n` +
      `⚡ <i>ራሱ ያረጋግጣል — አስተዳዳሪ አያስፈልግም!</i>`;

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("❌ Cancel", "cancel_action")],
      ]),
    });
  } catch (err) {
    console.error("[handleDeposit] error:", err.message);
    await ctx.reply("⚠️ ስህተት ተፈጥሯል  እንደገና ይሞክሩ።", mainKeyboard());
  }
};

bot.hears("Deposit 💵", handleDeposit);
bot.action("action_deposit", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleDeposit(ctx);
});

// ═══════════════════════════════════════════════════════
// WITHDRAW FLOW
// ═══════════════════════════════════════════════════════
const handleWithdraw = async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;

    if (!user.phone) {
      setStep(user.telegramId, { type: "withdraw_phone" });
      return ctx.reply(
        `📱 <b>የስልክ ቁጥር ያስፈልጋል</b>\n\n` +
          `ብር ለማውጣት መጀመሪያ የስልክ ቁጥርዎን መመዝገብ ያስፈልጋል።\n\n` +
          `👇 የሚከፈልበትን የ Telebirr ስልክ ቁጥር ይላኩ\n` +
          `(ለምሳሌ: <code>0911223344</code>)`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", "cancel_action")],
          ]),
        }
      );
    }

    if (user.balance < MIN_WITHDRAW) {
      return ctx.reply(
        `❌ <b>ቀሪ ሂሳብ በቂ አይደለም</b>\n\n` +
          `💰 ያልዎት: <b>${formatMoney(user.balance)} ETB</b>\n` +
          `📌 አነስተኛ ማውጣት: <b>${MIN_WITHDRAW} ETB</b>`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );
    }

    setStep(user.telegramId, { type: "withdraw_amount" });

    await ctx.reply(
      `📤 <b>Withdraw Money</b>\n\n` +
        `💰 ያልዎት: <b>${formatMoney(user.balance)} ETB</b>\n` +
        `📌 አነስተኛ: <b>${MIN_WITHDRAW} ETB</b>\n` +
        `📱 ወደ: <code>${esc(user.phone)}</code>\n\n` +
        `👇 ማውጣት የሚፈልጉትን መጠን ይላኩ (ለምሳሌ: <code>1000</code>)`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("❌ Cancel", "cancel_action")],
        ]),
      }
    );
  } catch (err) {
    console.error("[handleWithdraw] error:", err.message);
  }
};

bot.hears("Withdraw 📤", handleWithdraw);
bot.action("action_withdraw", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleWithdraw(ctx);
});

// ═══════════════════════════════════════════════════════
// CONFIRM WITHDRAW
// ═══════════════════════════════════════════════════════
bot.action("confirm_withdraw", async (ctx) => {
  try {
    await ctx.answerCbQuery("Processing...");
  } catch {}

  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;

    const step = getStep(user.telegramId);
    if (!step || step.type !== "withdraw_confirm") {
      return ctx.reply("❌ የቆየ ጥያቄ። እንደገና ይጀምሩ።", mainKeyboard());
    }

    const { amount } = step;
    clearStep(user.telegramId);

    const updated = await User.findOneAndUpdate(
      {
        _id: user._id,
        balance: { $gte: amount },
        isBanned: { $ne: true },
      },
      { $inc: { balance: -amount } },
      { new: true }
    );

    if (!updated) {
      return ctx.editMessageText(
        "❌ ቀሪ ሂሳብ በቂ አይደለም ወይም አካውንትዎ ታግዷል።"
      );
    }

    let tx;
    try {
      tx = await Transaction.create({
        user: user._id,
        type: "withdrawal",
        amount,
        balanceAfter: updated.balance,
        status: "pending",
        meta: {
          phone: updated.phone,
          method: "telebirr",
          source: "bot",
          requestedAt: new Date(),
        },
      });
    } catch (txErr) {
      await User.updateOne(
        { _id: user._id },
        { $inc: { balance: amount } }
      );
      throw txErr;
    }

    await ctx.editMessageText(
      `✅ <b>የወጪ ጥያቄ ተልኳል</b>\n\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `📱 ወደ: <code>${esc(updated.phone)}</code>\n` +
        `💳 ቀሪ ሂሳብ: <b>${formatMoney(updated.balance)} ETB</b>\n` +
        `⏳ አስተዳዳሪ ካረጋገጠ በ24 ሰዓት ውስጥ ይከፈላል።`,
      { parse_mode: "HTML" }
    );
    await ctx.reply("👇", mainKeyboard());

    if (ADMIN_CHAT_ID) {
      const adminText =
        `🆕 <b>Withdrawal Request</b>\n\n` +
        `👤 <b>${esc(updated.firstName || "User")} ${esc(updated.lastName || "")}</b>\n` +
        `🆔 <code>${updated.telegramId}</code>\n` +
        `📱 <code>${esc(updated.phone)}</code>\n\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `💳 ድምር: <b>${formatMoney(updated.balance)} ETB</b>\n` +
        `🕐 ${new Date().toLocaleString("en-US", {
          timeZone: "Africa/Addis_Ababa",
        })}`;

      await bot.telegram
        .sendMessage(ADMIN_CHAT_ID, adminText, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `wd_ok:${tx._id}` },
                { text: "❌ Reject", callback_data: `wd_no:${tx._id}` },
              ],
            ],
          },
        })
        .catch((err) =>
          console.error("[withdraw] admin notify failed:", err.message)
        );
    }
  } catch (err) {
    console.error("[confirm_withdraw]", err);
    await ctx.reply("⚠️ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።", mainKeyboard());
  }
});

// ═══════════════════════════════════════════════════════
// CANCEL ACTION
// ═══════════════════════════════════════════════════════
bot.action("cancel_action", async (ctx) => {
  try {
    await ctx.answerCbQuery("❌ Cancelled");
    clearStep(ctx.from.id);
    await ctx.editMessageText("❌ ተሰርዟል።", mainKeyboard());
  } catch (err) {
    console.error("[cancel_action]", err.message);
  }
});

// ═══════════════════════════════════════════════════════
// ADMIN DECISION — ✅ የድርብ ክሬዲት መከላከያ ተጨምሯል
// ═══════════════════════════════════════════════════════
function isBotAdmin(ctx) {
  const id = String(ctx.from?.id || "");
  return ADMIN_TELEGRAM_IDS.includes(id) || isAdminChatId(id);
}

bot.command("smsstatus", async (ctx) => {
  if (!isBotAdmin(ctx)) return;
  try {
    const d = require("./services/telebirr/smsDiagnostics");
    await ctx.reply(d.formatStatus(await d.smsStatus()));
  } catch (err) {
    console.error("[/smsstatus]", err.message);
    await ctx.reply("❌ ስህተት: " + err.message).catch(() => {});
  }
});

bot.command("smscheck", async (ctx) => {
  if (!isBotAdmin(ctx)) return;
  try {
    const d = require("./services/telebirr/smsDiagnostics");
    const arg = String(ctx.message?.text || "").split(/\s+/)[1];
    await ctx.reply(d.formatCheck(await d.smsCheck(arg)));
  } catch (err) {
    console.error("[/smscheck]", err.message);
    await ctx.reply("❌ ስህተት: " + err.message).catch(() => {});
  }
});

async function adminDecision(ctx, kind, approve) {
  try {
    if (!isBotAdmin(ctx)) return ctx.answerCbQuery("❌ Admin only");
    await ctx.answerCbQuery(approve ? "✅ Processing..." : "❌ Rejecting...");

    const txId = ctx.match[1];
    if (!/^[a-f0-9]{24}$/i.test(txId)) {
      return ctx.editMessageText("❌ Invalid transaction id");
    }

    // ✅ የድርብ ክሬዲት መከላከያ: ግብይቱ አስቀድሞ መጠናቀቁን ማረጋገጥ
    const existingTx = await Transaction.findById(txId);
    if (!existingTx) {
      return ctx.editMessageText("❌ Transaction not found");
    }
    if (existingTx.status === "completed") {
      return ctx.editMessageText(
        `✅ <b>ማስታወሻ</b>\n\nይህ ግብይት አስቀድሞ በራስ-ሰር ተጸድቋል (Auto-Approved)።\nምንም ተጨማሪ እርምጃ አያስፈልግም።`,
        { parse_mode: "HTML" }
      );
    }
    if (existingTx.status === "failed") {
      return ctx.editMessageText(
        `❌ <b>ማስታወሻ</b>\n\nይህ ግብይት አስቀድሞ ውድቅ ተደርጓል።`,
        { parse_mode: "HTML" }
      );
    }

    const r = approve
      ? await approveTransaction(txId)
      : await rejectTransaction(txId, "Rejected by admin");

    const label = kind === "wd" ? "WITHDRAWAL" : "DEPOSIT";
    if (!r.ok) {
      return ctx.editMessageText(
        `⚠️ ${label}: ${r.error || "ስህተት"} (${r.code || ""})`
      );
    }
    const tx = r.transaction;
    await ctx.editMessageText(
      `${approve ? "✅" : "❌"} <b>${label} ${
        approve ? "APPROVED" : "REJECTED"
      }</b>\n\n` +
        `👤 ${esc(r.user?.firstName || "User")} (${esc(r.user?.telegramId || "")})\n` +
        `💰 ${tx.amount} ETB`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error(`[${kind}_${approve ? "ok" : "no"}]`, err);
    await ctx.reply("⚠️ ስህተት ተፈጥሯል።").catch(() => {});
  }
}

bot.action(/^wd_ok:(.+)$/, (ctx) => adminDecision(ctx, "wd", true));
bot.action(/^wd_no:(.+)$/, (ctx) => adminDecision(ctx, "wd", false));
bot.action(/^dep_ok:(.+)$/, (ctx) => adminDecision(ctx, "dep", true));
bot.action(/^dep_no:(.+)$/, (ctx) => adminDecision(ctx, "dep", false));

// ═══════════════════════════════════════════════════════
// DEPOSIT SMS — ✅ የተሻሻለ (Auto-Approved vs Manual Review)
// ═══════════════════════════════════════════════════════
async function handleDepositSms(ctx, smsText) {
  const userId = String(ctx.from.id);
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  if (String(smsText || "").length < 20) {
    return ctx.reply(
      "❌ የ Telebirr SMS ሙሉውን ይለጥፉ (ቁጥር ብቻ አይላኩ)።",
      mainKeyboard()
    );
  }

  const checkMsg = await ctx
    .reply(`🔍 <b>ደረሰኙን በማረጋገጥ ላይ...</b>`, { parse_mode: "HTML" })
    .catch(() => null);

  let result;
  try {
    result = await verifyAndCreditDeposit({
      userId: user._id,
      smsText,
    });
  } catch (err) {
    console.error("[bot deposit] verify error:", err);
    result = {
      ok: false,
      status: "error",
      message: "⚠️ ስህተት ተፈጥሯል። እባክዎ እንደገና ይሞክሩ ወይም Support ያግኙ።",
    };
  }

  if (checkMsg) {
    ctx.telegram
      .deleteMessage(ctx.chat.id, checkMsg.message_id)
      .catch(() => {});
  }

  // ✅ 1. ሲስተሙ በራስ-ሰር ካጸደቀ — ለአድሚኑ ያለ ቁልፍ የመረጃ መልዕክት
  if (result.ok) {
    clearStep(userId);
    await ctx.reply(
      `✅ <b>ማስገባት ተሳክቷል!</b>\n\n` +
        `💰 መጠን: <b>+${result.amount} ETB</b>\n` +
        `💳 ድምር: <b>${formatMoney(result.balance)} ETB</b>\n` +
        `🎮 አሁን መጫወት ይችላሉ!`,
      { parse_mode: "HTML", ...mainKeyboard() }
    );

    // ✅ ለአድሚኑ የመረጃ መልዕክት ብቻ (Approve/Reject ቁልፎች የሉትም)
    await notifyAdmin(
      `✅ <b>Auto-Approved Deposit</b>\n\n` +
        `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
        `💰 <b>${result.amount} ETB</b>\n` +
        `⚡ ሲስተሙ በራስ-ሰር አጽድቆታል — ምንም እርምጃ አያስፈልግም።`
    );
    return;
  }

  // ✅ 2. Manual Review የሚያስፈልገው — ለአድሚኑ በ Approve/Reject ቁልፎች (በ depositVerifier.js ይላካል)
  if (result.status === "manual_review") {
    clearStep(userId);
    return ctx.reply(result.message, mainKeyboard());
  }

  const terminal = !["too_many_attempts", "error"].includes(
    result.reason || result.status
  );
  if (terminal) clearStep(userId);
  await ctx.reply(
    `${result.message}\n\n📞 ችግር ካለ ${SUPPORT_CONTACT} ያግኙን።`,
    mainKeyboard()
  );
}

// ═══════════════════════════════════════════════════════
// TEXT HANDLER
// ═══════════════════════════════════════════════════════
bot.on("text", async (ctx, next) => {
  const step = getStep(ctx.from.id);
  if (!step) return next();

  const text = String(ctx.message.text || "").trim();
  if (!text) return next();

  if (step.type === "deposit") {
    return handleDepositSms(ctx, text);
  }

  if (step.type === "withdraw_phone") {
    const phone = text.replace(/[^\d+]/g, "");
    if (!PHONE_RE.test(phone)) {
      return ctx.reply("❌ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ (ለምሳሌ: 0911223344)።");
    }

    const user = await getOrCreateUser(ctx);
    if (!user) return;
    await User.updateOne({ telegramId: user.telegramId }, { $set: { phone } });

    if (user.balance < MIN_WITHDRAW) {
      clearStep(user.telegramId);
      return ctx.reply(
        `❌ <b>ቀሪ ሂሳብ በቂ አይደለም</b>\n\n` +
          `💰 ያልዎት: <b>${formatMoney(user.balance)} ETB</b>\n` +
          `📌 አነስተኛ: <b>${MIN_WITHDRAW} ETB</b>`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );
    }

    setStep(user.telegramId, { type: "withdraw_amount" });
    return ctx.reply(
      `✅ ስልክ ተመዝግቧል: <code>${phone}</code>\n\n` +
        `📤 አሁን የማውጣት መጠን ይላኩ (ለምሳሌ: <code>1000</code>)`,
      { parse_mode: "HTML" }
    );
  }

  if (step.type === "withdraw_amount") {
    const amount = Number(text.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
      return ctx.reply(`❌ አነስተኛ ማውጣት ${MIN_WITHDRAW} ETB ነው።`);
    }

    const user = await getOrCreateUser(ctx);
    if (!user) return;
    if (amount > user.balance) {
      return ctx.reply(
        `❌ ቀሪ ሂሳብ በቂ አይደለም። ያልዎት: ${formatMoney(user.balance)} ETB`
      );
    }

    setStep(user.telegramId, { type: "withdraw_confirm", amount });
    return ctx.reply(
      `📤 <b>ማውጣት ማረጋገጫ</b>\n\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `📱 ወደ: <code>${esc(user.phone)}</code>\n\n` +
        `ይህን ጥያቄ ማረጋገጥ ይፈልጋሉ?`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Confirm", "confirm_withdraw"),
            Markup.button.callback("❌ Cancel", "cancel_action"),
          ],
        ]),
      }
    );
  }

  return next();
});

// ═══════════════════════════════════════════════════════
// INVITE
// ═══════════════════════════════════════════════════════
const handleInvite = async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    const botUsername =
      process.env.TELEGRAM_BOT_USERNAME || "fetanbingo1_bot";
    const link = `https://t.me/${botUsername.replace("@", "")}?start=ref_${
      user.telegramId
    }`;

    const inviteText =
      `${MAIN_MENU_TEXT}\n\n` +
      `🎁 <b>Invite & Earn ${REFERRAL_BONUS} ETB</b>\n\n` +
      `የእርስዎ የግብዣ ሊንክ:\n` +
      `<code>${link}</code>\n\n` +
      `👥 የጋበዟቸው ሰዎች: <b>${user.referralCount || 0}</b>`;

    const extra = { caption: inviteText, parse_mode: "HTML" };

    if (bannerFileId) {
      try {
        await ctx.replyWithPhoto(bannerFileId, extra);
        return;
      } catch (err) {
        bannerFileId = null;
      }
    }

    const url = bannerUrlIfValid();
    if (url) {
      try {
        await ctx.replyWithPhoto(url, extra);
        return;
      } catch (err) {
        console.error("[invite] URL banner failed:", err.message);
      }
    }

    await ctx.reply(inviteText, { parse_mode: "HTML" });
  } catch (err) {
    console.error("[handleInvite]", err.message);
  }
};

bot.hears("Invite 🔗", handleInvite);
bot.action("action_invite", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleInvite(ctx);
});

// ═══════════════════════════════════════════════════════
// INSTRUCTION
// ═══════════════════════════════════════════════════════
const handleInstruction = async (ctx) => {
  const text =
    `📖 <b>የአጠቃቀም መመሪያ</b>\n\n` +
    `1️⃣ <b>Register</b> — የስልክ ቁጥርዎን ያጋሩ\n` +
    `2️⃣ <b>Deposit</b> — ወደ Telebirr ይላኩ → SMS ይለጥፉ\n` +
    `3️⃣ <b>Play</b> — ካርቴላ ይምረጡ → ይጫወቱ\n` +
    `4️⃣ <b>Withdraw</b> — ገንዘብ ማውጣት\n\n` +
    `❓ ጥያቄ? ${SUPPORT_CONTACT}`;
  await ctx.reply(text, { parse_mode: "HTML" });
};

bot.hears("Instruction 📖", handleInstruction);
bot.action("action_instruction", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleInstruction(ctx);
});

// ═══════════════════════════════════════════════════════
// SUPPORT
// ═══════════════════════════════════════════════════════
const handleSupport = async (ctx) => {
  await ctx.reply(
    `☎️ <b>Contact Support</b>\n\n` +
      `ለጥያቄዎች ወይም ችግሮች፦\n` +
      `${SUPPORT_CONTACT}`,
    { parse_mode: "HTML" }
  );
};

bot.hears("Contact Support ☎️", handleSupport);
bot.action("action_support", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleSupport(ctx);
});

// ═══════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════
bot.catch((err, ctx) => {
  console.error(`[bot] error for ${ctx?.updateType}:`, err?.message || err);
});

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════
async function setupBotProfile() {
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start" },
      { command: "register", description: "Register" },
      { command: "play", description: "Play" },
      { command: "deposit", description: "Deposit" },
      { command: "balance", description: "Balance" },
      { command: "withdraw", description: "Withdraw" },
      { command: "invite", description: "Invite" },
      { command: "instruction", description: "Instruction" },
    ]);
    console.log("[bot] ✅ Commands set");
    await new Promise((r) => setTimeout(r, 500));

    await bot.telegram.setMyDescription(
      "🎉 እንኳን ወደ Fetan Bingo በደህና መጡ!\n\n" +
        "🎰 ይጫወቱ፣ ያሸንፉ እና እውነተኛ ገንዘብ ያግኙ\n" +
        "⚡ ፈጣን ዲፖዚት እና ወጪ\n" +
        "🎁 ለአዲስ ተጠቃሚዎች ቦነስ\n\n" +
        "🎮 ለመጀመር Play ን ይጫኑ!"
    );
    console.log("[bot] ✅ Description set");
    await new Promise((r) => setTimeout(r, 500));

    await bot.telegram.setMyShortDescription(
      "🎰 Fetan Bingo — ይጫወቱ እና ያሸንፉ!"
    );
    console.log("[bot] ✅ Short description set");
    await new Promise((r) => setTimeout(r, 500));

    if (WEBAPP_URL) {
      await bot.telegram.setChatMenuButton({
        type: "web_app",
        text: "Play Bingo",
        web_app: { url: WEBAPP_URL },
      });
      console.log("[bot] ✅ Menu button set");
    }
  } catch (err) {
    console.error("[bot] profile setup failed:", err.message);
  }
}

async function main(app) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(bot.webhookCallback(webhookPath));
  console.log("[bot] Fetan bingo bot registered (webhook mode)");

  setupBotProfile().catch((err) =>
    console.error("[bot] profile setup failed:", err.message)
  );
}

function startBot(app) {
  return main(app).catch((err) => {
    console.error("[bot] failed to start:", err);
  });
}

module.exports = { startBot, bot };

process.once("SIGINT", () => {
  try {
    bot.stop("SIGINT");
  } catch (err) {}
  process.exit(0);
});
process.once("SIGTERM", () => {
  try {
    bot.stop("SIGTERM");
  } catch (err) {}
  process.exit(0);
});