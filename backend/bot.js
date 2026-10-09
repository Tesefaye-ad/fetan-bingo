require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { verifyTelebirrReceipt } = require("./services/telebirrVerify");

// ═══════════════════════════════════════════════════════
// DB
// ═══════════════════════════════════════════════════════
const User = require("./models/User");
const Transaction = require("./models/Transaction");
const { Notification } = require("./models/User");

// ═══════════════════════════════════════════════════════
// ADMIN TELEGRAM IDs
// ═══════════════════════════════════════════════════════
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || "494653076")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ═══════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════
const LOCAL_BANNER_PATH = path.join(__dirname, "assets", "banner.png");

function getBannerSource() {
  const url = process.env.BOT_BANNER_URL;
  if (url) return url;
  if (fs.existsSync(LOCAL_BANNER_PATH, fs.constants.F_OK)) {
    return { source: fs.createReadStream(LOCAL_BANNER_PATH) };
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// ENV
// ═══════════════════════════════════════════════════════
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.BOT_WEBAPP_URL;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "@FetanBingoSupport";
const DEPOSIT_PHONE = process.env.DEPOSIT_TELEBIRR_PHONE || "0920790583";
const DEPOSIT_NAME = process.env.DEPOSIT_TELEBIRR_NAME || "Tesfaye Admasu";
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const BONUS_CONVERSION_RATE = Number(process.env.BONUS_CONVERSION_RATE || 1);

// ═══════════════════════════════════════════════════════
// AUTO-DEPOSIT
// ═══════════════════════════════════════════════════════
const AUTO_APPROVE_DEPOSITS = true;
const MAX_AUTO_DEPOSIT_AMOUNT = 5000;
const MAX_SMS_AGE_HOURS = 24;

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing. Aborting.");
  process.exit(1);
}

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
    [Markup.button.callback("Convert Bonus 💱", "action_convert")],
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

// ═══════════════════════════════════════════════════════
// Telebirr SMS Parser
// ═══════════════════════════════════════════════════════
function parseTelebirrSMS(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return {
      amount: null,
      transactionId: null,
      phone: null,
      fingerprint: null,
      raw: "",
    };
  }

  let amount = null;
  const amountPatterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:birr|etb|ብር)/i,
    /(?:amount|ጠቅላላ|የተላከ)[:\s]+(\d+(?:[.,]\d+)?)/i,
    /(?:transferred|received|sent)\s+(?:ETB\s+)?(\d+(?:[.,]\d+)?)/i,
  ];
  for (const p of amountPatterns) {
    const m = clean.match(p);
    if (m) {
      const n = parseFloat(m[1].replace(",", "."));
      if (Number.isFinite(n) && n > 0) {
        amount = n;
        break;
      }
    }
  }

  let transactionId = null;
  const idPatterns = [
    /transaction\s+number\s+is\s+([A-Z0-9]{6,})/i,
    /(?:transaction\s*id|txn\s*id|ref(?:erence)?(?:\s*no)?|ግብይት\s*ቁጥር)[:\s#]*([A-Z0-9]{6,})/i,
    /ቁጥርዎ\s+([A-Z0-9]{6,})/i,
    /receipt\/([A-Z0-9]{6,})/i,
    /\b([A-Z]{2,}[A-Z0-9]{6,})\b/,
  ];
  for (const p of idPatterns) {
    const m = clean.match(p);
    if (m && m[1]) {
      const candidate = m[1].toUpperCase();
      if (
        !/^(BIRR|ETB|TELEBIRR|SMS|FROM|DEAR|CUSTOMER|VAT)$/i.test(candidate)
      ) {
        transactionId = candidate;
        break;
      }
    }
  }

  const phoneMatch = clean.match(/(?:\+?251|0)?9\d{8}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  const normalized = clean.toLowerCase().replace(/\s+/g, "");
  const fingerprint = crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");

  return {
    amount,
    transactionId,
    phone,
    fingerprint,
    raw: clean,
  };
}

// ═══════════════════════════════════════════════════════
// GET OR CREATE USER
// ═══════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════
// REFERRAL BONUS
// ═══════════════════════════════════════════════════════
async function processReferralBonus(telegramId, referredBy) {
  try {
    const user = await User.findOne({ telegramId });
    if (!user || !user.referredBy) return;
    if (user.referralCount > 0) return;

    const inviter = await User.findOneAndUpdate(
      { telegramId: referredBy },
      { $inc: { referralCount: 1, bonusBalance: 5 } },
      { new: true }
    );

    if (inviter) {
      bot.telegram
        .sendMessage(
          inviter.telegramId,
          `🎉 Someone joined using your invite link! You earned 5 ETB bonus.`
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

    const banner = getBannerSource();
    if (banner) {
      ctx
        .replyWithPhoto(banner, {
          caption: MAIN_MENU_TEXT,
          ...mainKeyboard(),
        })
        .catch(() =>
          ctx.reply(MAIN_MENU_TEXT, mainKeyboard()).catch(() => {})
        );
    } else {
      ctx.reply(MAIN_MENU_TEXT, mainKeyboard()).catch(() => {});
    }

    getOrCreateUser(ctx, referredBy).catch((err) =>
      console.error("[/start] background error:", err.message)
    );

    if (referredBy) {
      processReferralBonus(telegramId, referredBy).catch((err) =>
        console.error("[/start] referral error:", err.message)
      );
    }
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
    await User.updateOne(
      { telegramId: user.telegramId },
      { $set: { phone: contact.phone_number } }
    );
    await ctx.reply(
      `✅ ስልክ ቁጥርዎ በተሳካ ሁኔታ ተመዝግቧል!\n📞 Phone: ${contact.phone_number}`,
      Markup.removeKeyboard()
    );
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
    `💰 Main: <b>${formatMoney(user.balance)} ETB</b>\n` +
    `🎁 Bonus: <b>${formatMoney(user.bonusBalance || 0)} ETB</b>\n` +
    `🆔 ID: <code>${user.telegramId}</code>`;

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
// 💵 DEPOSIT FLOW — ✅ የተስተካከለ!
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
      `⚠️ <i>አነስተኛ: ${MIN_DEPOSIT} ETB</i>\n` 
      ;

    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("❌ Cancel", "cancel_action")],
      ]),
    });
  } catch (err) {
    console.error("[handleDeposit] error:", err.message);
    await ctx.reply("⚠️ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።", mainKeyboard());
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
// 📤 WITHDRAW FLOW
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
        `👇 ማውጣት የሚፈልጉትን መጠን ይላኩ (ለምሳሌ: <code>100</code>)`,
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

bot.hears("Withdraw 💵", handleWithdraw);
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
    await ctx.answerCbQuery("⏳ Processing...");
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

    const tx = await Transaction.create({
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

    await ctx.editMessageText(
      `✅ <b>የወጪ ጥያቄ ተልኳል</b>\n\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `📱 ወደ: <code>${esc(updated.phone)}</code>\n` +
        `💳 ቀሪ ሂሳብ: <b>${formatMoney(updated.balance)} ETB</b>\n` +
        `🔖 Ref: <code>${tx._id}</code>\n\n` +
        `⏳ አስተዳዳሪ ካረጋገጠ በ24 ሰዓት ውስጥ ይከፈላል።`,
      { parse_mode: "HTML" }
    );
    await ctx.reply("👇", mainKeyboard());

    if (ADMIN_CHAT_ID) {
      const adminText =
        `🆕 <b>Withdrawal Request</b>\n\n` +
        `👤 <b>${esc(updated.firstName || "User")} ${esc(
          updated.lastName || ""
        )}</b>\n` +
        `🆔 <code>${updated.telegramId}</code>\n` +
        `📱 <code>${esc(updated.phone)}</code>\n\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `💳 ቀሪ: <b>${formatMoney(updated.balance)} ETB</b>\n` +
        `🔖 Ref: <code>${tx._id}</code>\n` +
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
// ADMIN WITHDRAW — APPROVE
// ═══════════════════════════════════════════════════════
bot.action(/^wd_ok:(.+)$/, async (ctx) => {
  try {
    if (!ADMIN_TELEGRAM_IDS.includes(String(ctx.from.id))) {
      return ctx.answerCbQuery("❌ Admin only");
    }
    await ctx.answerCbQuery("✅ Processing...");

    const txId = ctx.match[1];
    const tx = await Transaction.findById(txId);
    if (!tx) return ctx.editMessageText("❌ Transaction not found");
    if (tx.status !== "pending") {
      return ctx.editMessageText(
        `⚠️ ይህ ግብይት ቀድሞ ተሰርቷል (${tx.status})`
      );
    }

    tx.status = "completed";
    await tx.save();

    const user = await User.findByIdAndUpdate(
      tx.user,
      { $inc: { totalWithdrawals: tx.amount } },
      { new: true }
    );

    await ctx.editMessageText(
      `✅ <b>WITHDRAWAL APPROVED</b>\n\n` +
        `👤 ${esc(user?.firstName || "User")}\n` +
        `📱 <code>${esc(user?.phone)}</code>\n` +
        `💰 ${tx.amount} ETB\n` +
        `🔖 <code>${tx._id}</code>`,
      { parse_mode: "HTML" }
    );

    if (user?.telegramId) {
      await bot.telegram
        .sendMessage(
          user.telegramId,
          `✅ <b>ወጪ ጥያቄዎ ተፈጽሟል!</b>\n\n` +
            `💰 መጠን: <b>${formatMoney(tx.amount)} ETB</b>\n` +
            `📱 ወደ: <code>${esc(user.phone)}</code>\n` +
            `🔖 Ref: <code>${tx._id}</code>\n\n` +
            `💳 ገንዘቡ ወደ Telebirr ተልኳል — እባክዎ ያረጋግጡ።`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});

      await Notification.create({
        user: user._id,
        title: "✅ Withdrawal Approved",
        body: `Your withdrawal of ${tx.amount} ETB has been processed.`,
        type: "withdraw",
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[wd_ok]", err);
    await ctx.reply("⚠️ ስህተት ተፈጥሯል።");
  }
});

// ═══════════════════════════════════════════════════════
// ADMIN WITHDRAW — REJECT
// ═══════════════════════════════════════════════════════
bot.action(/^wd_no:(.+)$/, async (ctx) => {
  try {
    if (!ADMIN_TELEGRAM_IDS.includes(String(ctx.from.id))) {
      return ctx.answerCbQuery("❌ Admin only");
    }
    await ctx.answerCbQuery("❌ Rejecting...");

    const txId = ctx.match[1];
    const tx = await Transaction.findById(txId);
    if (!tx) return ctx.editMessageText("❌ Transaction not found");
    if (tx.status !== "pending") {
      return ctx.editMessageText(
        `⚠️ ይህ ግብይት ቀድሞ ተሰርቷል (${tx.status})`
      );
    }

    const user = await User.findByIdAndUpdate(
      tx.user,
      { $inc: { balance: tx.amount } },
      { new: true }
    );

    tx.status = "failed";
    tx.balanceAfter = user?.balance ?? tx.balanceAfter;
    tx.meta = { ...(tx.meta || {}), rejectReason: "Rejected by admin" };
    await tx.save();

    await ctx.editMessageText(
      `❌ <b>WITHDRAWAL REJECTED</b>\n\n` +
        `👤 ${esc(user?.firstName || "User")}\n` +
        `💰 ${tx.amount} ETB — ተመልሷል\n` +
        `🔖 <code>${tx._id}</code>`,
      { parse_mode: "HTML" }
    );

    if (user?.telegramId) {
      await bot.telegram
        .sendMessage(
          user.telegramId,
          `❌ <b>ወጪ ጥያቄዎ ውድቅ ሆኗል</b>\n\n` +
            `💰 ${formatMoney(tx.amount)} ETB ወደ ዋሌትዎ ተመልሷል\n` +
            `💳 አሁን: <b>${formatMoney(user.balance)} ETB</b>\n\n` +
            `📞 ችግር ካለ ${SUPPORT_CONTACT} ያግኙን።`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});

      await Notification.create({
        user: user._id,
        title: "❌ Withdrawal Rejected",
        body: `Your withdrawal of ${tx.amount} ETB was rejected. Funds returned.`,
        type: "warning",
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[wd_no]", err);
    await ctx.reply("⚠️ ስህተት ተፈጥሯል።");
  }
});

// ═══════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════
bot.action("cancel_action", async (ctx) => {
  try {
    await ctx.answerCbQuery("❌ Cancelled");
  } catch {}
  clearStep(ctx.from.id);
  await ctx.editMessageText("❌ ሂደቱ ተሰርዟል።").catch(() => {});
  await ctx.reply("👇", mainKeyboard());
});

// ═══════════════════════════════════════════════════════
// INSTRUCTION
// ═══════════════════════════════════════════════════════
const handleInstruction = async (ctx) => {
  const text =
    `📖 <b>የጨዋታው መመሪያ</b>\n\n` +
    `1️⃣ "Register 📝" ተጭነው ይመዝገቡ\n` +
    `2️⃣ "Deposit 💵" ተጭነው ብር ያስገቡ\n` +
    `   → ወደ ${DEPOSIT_PHONE} ላኩ → SMS ይለጥፉ\n` +
    `3️⃣ "Withdraw 📤" ተጭነው ብር ያውጡ\n` +
    `4️⃣ "Play 🎮" ተጭነው WebApp ይክፈቱ\n` +
    `5️⃣ ካርቴላ ይምረጡ → ይጫወቱ → ያሸንፉ!`;
  await ctx.reply(text, { parse_mode: "HTML", ...mainKeyboard() });
};

bot.hears("Instruction 📖", handleInstruction);
bot.action("action_instruction", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleInstruction(ctx);
});

// ═══════════════════════════════════════════════════════
// INVITE
// ═══════════════════════════════════════════════════════
const handleInvite = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const botInfo = await ctx.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${user.telegramId}`;

  const text =
    `🔥 ባንድዎ ያለውን ስልክ በመጠቀም ብቻ ዕድልዎን ይሞክሩ!\n\n` +
    `🎁 <b>ልዩ ቦነስ:</b> ከታች ባለው ሊንክ ሲመዘገብ ብቻ የ 10 ETB ቦነስ ይጨመርልዎታል!\n\n` +
    `🔗 የእርሶው መጋበዣ ሊንክ:\n` +
    `<code>${link}</code>\n\n` +
    `👥 የተጋበዙ: <b>${user.referralCount || 0}</b>`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.switchToChat(
        "📤 ለጓደኛ Share አድርግ",
        `🎉 ወደ Fetan Bingo ተቀላቀል!\n${link}`
      ),
    ],
  ]);

  await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
};

bot.hears("Invite 🔗", handleInvite);
bot.action("action_invite", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleInvite(ctx);
});

// ═══════════════════════════════════════════════════════
// SUPPORT
// ═══════════════════════════════════════════════════════
const handleSupport = async (ctx) => {
  await ctx.reply(`☎️ Need help? Message ${SUPPORT_CONTACT}.`, mainKeyboard());
};
bot.hears("Contact Support ☎️", handleSupport);
bot.action("action_support", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleSupport(ctx);
});

// ═══════════════════════════════════════════════════════
// CONVERT BONUS
// ═══════════════════════════════════════════════════════
const handleConvert = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  if (user.bonusBalance <= 0) {
    return ctx.reply("❌ ምንም ቦነስ የለም።", mainKeyboard());
  }
  const converted = user.bonusBalance * BONUS_CONVERSION_RATE;
  await User.updateOne(
    { telegramId: user.telegramId },
    { $inc: { balance: converted }, $set: { bonusBalance: 0 } }
  );

  await Transaction.create({
    user: user._id,
    type: "deposit",
    amount: converted,
    balanceAfter: user.balance + converted,
    reference: `BONUS-${Date.now()}`,
    status: "completed",
    meta: { source: "bonus_conversion" },
  });

  await ctx.reply(
    `✅ <b>ተቀይሯል!</b>\n\n` +
      `🎁 ቦነስ: <b>${formatMoney(user.bonusBalance)} ETB</b>\n` +
      `💰 አዲስ ቀሪ: <b>${formatMoney(user.balance + converted)} ETB</b>`,
    { parse_mode: "HTML", ...mainKeyboard() }
  );
};

bot.hears("Convert Bonus 💱", handleConvert);
bot.action("action_convert", async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch {}
  await handleConvert(ctx);
});

// ═══════════════════════════════════════════════════════
// 📱 TEXT HANDLER — STATE MACHINE
// ═══════════════════════════════════════════════════════
bot.on("text", async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const step = getStep(userId);
    const rawText = ctx.message.text.trim();

    if (/^(cancel|exit|stop|ሰርዝ)$/i.test(rawText)) {
      clearStep(userId);
      return ctx.reply("❌ ሂደቱ ተሰርዟል።", mainKeyboard());
    }

    if (!step || step.type === "deposit") {
      const parsed = parseTelebirrSMS(rawText);

      if (step?.type === "deposit" && !parsed.transactionId && !parsed.phone) {
        const justNumber = Number(rawText);
        if (justNumber && justNumber > 0) {
          return ctx.reply(
            `📥 ማስገባት ለማድረግ <b>${justNumber} ETB</b>:\n\n` +
              `1️⃣ ወደ <code>${DEPOSIT_PHONE}</code> ይላኩ\n` +
              `2️⃣ የከፈሉበትን ሙሉ SMS copy አድርገው እዚህ ላይ paste ያድርጉ\n\n` +
              `⚠️ SMS ሙሉ ጽሑፍ ይላኩ — ቁጥር ብቻ አይላኩ።`,
            { parse_mode: "HTML", ...mainKeyboard() }
          );
        }
      }

      if (!step && !parsed.amount) return;

      if (!parsed.amount) {
        return ctx.reply(
          "❌ ከ SMS ውስጥ የገንዘብ መጠን ማግኘት አልቻልኩም።\n\n" +
            "እባክዎ የ Telebirr SMS ሙሉ በሙሉ copy አድርገው እዚህ ይላኩ።",
          mainKeyboard()
        );
      }

      return handleDepositSms(ctx, parsed);
    }

    if (step.type === "withdraw_phone") {
      const phone = rawText.replace(/[^\d+]/g, "");
      if (!/^(09|07|\+2519|\+2517|2519|2517)\d{8}$/.test(phone)) {
        return ctx.reply(
          "❌ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ (ለምሳሌ: <code>0911223344</code>)",
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("❌ Cancel", "cancel_action")],
            ]),
          }
        );
      }

      const user = await getOrCreateUser(ctx);
      if (!user) return;

      await User.updateOne({ _id: user._id }, { $set: { phone } });
      clearStep(userId);

      await ctx.reply(
        `✅ ስልክ ቁጥር ተመዝግቧል: <code>${phone}</code>\n\n` +
          `👇 አሁን መጠን ይላኩ`,
        { parse_mode: "HTML" }
      );

      return handleWithdraw(ctx);
    }

    if (step.type === "withdraw_amount") {
      const amount = Number(rawText.replace(/,/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) {
        return ctx.reply(
          "❌ እባክዎ ትክክለኛ ቁጥር ይላኩ (ለምሳሌ: <code>100</code>)",
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("❌ Cancel", "cancel_action")],
            ]),
          }
        );
      }

      const user = await getOrCreateUser(ctx);
      if (!user) return;

      if (amount < MIN_WITHDRAW) {
        return ctx.reply(
          `❌ አነስተኛ ማውጣት ${MIN_WITHDRAW} ETB ነው። የላኩት: ${amount} ETB`,
          mainKeyboard()
        );
      }
      if (user.balance < amount) {
        return ctx.reply(
          `❌ ቀሪ ሂሳብ በቂ አይደለም።\n\n💰 ያልዎት: ${formatMoney(user.balance)} ETB`,
          mainKeyboard()
        );
      }

      setStep(userId, { type: "withdraw_confirm", amount });

      return ctx.reply(
        `📋 <b>ማረጋገጫ</b>\n\n` +
          `💰 መጠን: <b>${amount} ETB</b>\n` +
          `📱 ወደ: <code>${esc(user.phone)}</code>\n` +
          `💳 ቀሪ በኋላ: <b>${formatMoney(user.balance - amount)} ETB</b>\n\n` +
          `ትክክል ነው?`,
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

    if (step.type === "withdraw_confirm") {
      return ctx.reply(
        "☝️ እባክዎ ከላይ ያለውን ✅ Confirm ወይም ❌ Cancel ቁልፍ ይጠቀሙ።",
        Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Confirm", "confirm_withdraw"),
            Markup.button.callback("❌ Cancel", "cancel_action"),
          ],
        ])
      );
    }
  } catch (err) {
    console.error("[text handler] error:", err.message);
  }
});

// ═══════════════════════════════════════════════════════
// 💵 DEPOSIT — SMS Verification & Auto-Approve
// ═══════════════════════════════════════════════════════
async function handleDepositSms(ctx, parsed) {
  const userId = String(ctx.from.id);
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  let amount = parsed.amount;

  if (amount < MIN_DEPOSIT) {
    return ctx.reply(
      `❌ አነስተኛ ማስገባት ${MIN_DEPOSIT} ETB ነው። የላኩት: ${amount} ETB`,
      mainKeyboard()
    );
  }

  // ═══ DUPLICATE CHECK #1 ═══
  const existingBySMS = await Transaction.findOne({
    "meta.smsFingerprint": parsed.fingerprint,
  }).lean();

  if (existingBySMS) {
    return ctx.reply(
      `⚠️ <b>ይህ SMS ከዚህ በፊት ተልኳል!</b>\n\n` +
        `❌ ተመሳሳይ SMS ሁለት ጊዜ መላክ አይቻልም።`,
      { parse_mode: "HTML", ...mainKeyboard() }
    );
  }

  // ═══ DUPLICATE CHECK #2 ═══
  if (parsed.transactionId) {
    const existingByTxId = await Transaction.findOne({
      "meta.transactionId": parsed.transactionId,
    }).lean();

    if (existingByTxId) {
      return ctx.reply(
        `⚠️ <b>ይህ የግብይት ቁጥር ከዚህ በፊት ተልኳል!</b>\n\n` +
          `🔖 <code>${parsed.transactionId}</code>\n\n` +
          `❌ አንድ ግብይት ሁለት ጊዜ መመዝገብ አይቻልም።`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );
    }
  }

  let receiptData = null;

  // ─── No TxID → manual review ───
  if (!parsed.transactionId) {
    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`;
    try {
      await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        balanceAfter: user.balance,
        reference,
        status: "pending",
        meta: {
          smsFingerprint: parsed.fingerprint,
          transactionId: null,
          smsPhone: parsed.phone || null,
          smsRaw: parsed.raw.slice(0, 500),
          source: "telebirr_sms",
          requiresManualReview: true,
          verificationReason: "no_transaction_id",
        },
      });
    } catch (err) {
      if (err.code === 11000) {
        return ctx.reply(
          "⚠️ ይህ SMS በቅርብ ጊዜ ተመዝግቧል።",
          mainKeyboard()
        );
      }
      throw err;
    }

    clearStep(userId);

    await ctx.reply(
      `⏳ <b>ማረጋገጫ አልተቻለም</b>\n\n` +
        `📎 Transaction ID አልተገኘም\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n\n` +
        `📋 ጥያቄዎ ለአስተዳዳሪ ተልኳል — በእጅ ይጸድቃል።\n` +
        `🔖 Ref: <code>${reference}</code>`,
      { parse_mode: "HTML", ...mainKeyboard() }
    );

    await notifyAdmin(
      `⚠️ <b>Manual Review (No TxID)</b>\n\n` +
        `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
        `💰 ${amount} ETB\n` +
        `📎 Ref: <code>${reference}</code>`
    );
    return;
  }

  // ─── Online verification ───
  const checkMsg = await ctx
    .reply(
      `🔍 <b>ደረሰኙን በማረጋገጥ ላይ...</b>\n` +
        `📎 ID: <code>${parsed.transactionId}</code>`,
      { parse_mode: "HTML" }
    )
    .catch(() => null);

  const result = await verifyTelebirrReceipt({
    transactionId: parsed.transactionId,
    expectedAmount: amount,
    expectedRecipientPhone: DEPOSIT_PHONE,
    expectedSenderPhone: user.phone || null,
    maxAgeHours: MAX_SMS_AGE_HOURS,
  });

  if (checkMsg) {
    ctx.telegram
      .deleteMessage(ctx.chat.id, checkMsg.message_id)
      .catch(() => {});
  }

  // ─── ❌ FAILED ───
  if (!result.ok) {
    const explicitRejections = [
      "amount_mismatch",
      "wrong_recipient",
      "wrong_sender",
      "not_completed",
      "invoice_mismatch",
      "stale",
      "invalid_id",
    ];

    if (explicitRejections.includes(result.reason)) {
      clearStep(userId);

      await ctx.reply(
        `${result.message}\n\n` +
          `❌ ገንዘቡ ወደ አካውንትዎ አልገባም።\n` +
          `📞 ችግር ካለ ${SUPPORT_CONTACT} ያግኙን።`,
        mainKeyboard()
      );

      await notifyAdmin(
        `❌ <b>Deposit Rejected</b>\n\n` +
          `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
          `💰 ${amount} ETB\n` +
          `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
          `📋 ምክንያት: ${result.reason}`
      );
      return;
    }

    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`;
    try {
      await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        balanceAfter: user.balance,
        reference,
        status: "pending",
        meta: {
          smsFingerprint: parsed.fingerprint,
          transactionId: parsed.transactionId,
          smsPhone: parsed.phone || null,
          smsRaw: parsed.raw.slice(0, 500),
          source: "telebirr_sms",
          requiresManualReview: true,
          verificationReason: result.reason,
        },
      });
    } catch (err) {
      if (err.code === 11000) {
        return ctx.reply("⚠️ ይህ ደረሰኝ በቅርብ ጊዜ ተመዝግቧል።", mainKeyboard());
      }
      throw err;
    }

    clearStep(userId);

    await ctx.reply(
      `⏳ <b>ማረጋገጫ አልተቻለም</b>\n\n` +
        `📎 ID: <code>${parsed.transactionId}</code>\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `📋 ምክንያት: <i>${result.reason}</i>\n\n` +
        `📋 ጥያቄዎ ለአስተዳዳሪ ተልኳል — በእጅ ይጸድቃል።\n` +
        `🔖 Ref: <code>${reference}</code>`,
      { parse_mode: "HTML", ...mainKeyboard() }
    );

    await notifyAdmin(
      `⚠️ <b>Manual Review Required</b>\n\n` +
        `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
        `💰 ${amount} ETB\n` +
        `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
        `🔍 ምክንያት: <i>${result.reason}</i>\n` +
        `📎 Ref: <code>${reference}</code>`
    );
    return;
  }

  // ─── ✅ PASSED ───
  receiptData = result.data;
  amount = result.data.amount;
  console.log(
    `[verify] ✅ ${parsed.transactionId} VERIFIED via ${result.via} — ${amount} ETB`
  );

  const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`;
  const canAutoApprove =
    AUTO_APPROVE_DEPOSITS && amount <= MAX_AUTO_DEPOSIT_AMOUNT;

  if (canAutoApprove) {
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { balance: amount, totalDeposits: amount } },
      { new: true }
    );

    try {
      await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        balanceAfter: updatedUser.balance,
        reference,
        status: "completed",
        meta: {
          smsFingerprint: parsed.fingerprint,
          transactionId: parsed.transactionId,
          smsPhone: parsed.phone || null,
          smsRaw: parsed.raw.slice(0, 500),
          source: "telebirr_sms",
          autoApproved: true,
          verifiedVia: receiptData ? "online" : "sms",
        },
      });
    } catch (err) {
      if (err.code === 11000) {
        await User.findByIdAndUpdate(user._id, {
          $inc: { balance: -amount, totalDeposits: -amount },
        });
        return ctx.reply("⚠️ ይህ ደረሰኝ በቅርብ ጊዜ ተመዝግቧል።", mainKeyboard());
      }
      throw err;
    }

    clearStep(userId);

    await ctx.reply(
      `✅ <b>ማስገባት ተሳክቷል!</b>\n\n` +
        `💰 መጠን: <b>+${amount} ETB</b>\n` +
        `💳 አዲስ ቀሪ: <b>${formatMoney(updatedUser.balance)} ETB</b>\n` +
        `🔖 Ref: <code>${reference}</code>\n` +
        `📎 Telebirr ID: <code>${parsed.transactionId}</code>\n\n` +
        `🎮 አሁን መጫወት ይችላሉ!`,
      { parse_mode: "HTML", ...mainKeyboard() }
    );

    await notifyAdmin(
      `✅ <b>Auto-Approved Deposit</b>\n\n` +
        `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
        `💰 <b>${amount} ETB</b>\n` +
        `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
        `🔍 Via: ${receiptData ? "online" : "sms"}\n` +
        `📎 Ref: <code>${reference}</code>`
    );
  } else {
    try {
      await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        balanceAfter: user.balance,
        reference,
        status: "pending",
        meta: {
          smsFingerprint: parsed.fingerprint,
          transactionId: parsed.transactionId,
          smsPhone: parsed.phone || null,
          smsRaw: parsed.raw.slice(0, 500),
          source: "telebirr_sms",
          exceedsAutoLimit: amount > MAX_AUTO_DEPOSIT_AMOUNT,
        },
      });
    } catch (err) {
      if (err.code === 11000) {
        return ctx.reply("⚠️ ይህ SMS በቅርብ ጊዜ ተመዝግቧል።", mainKeyboard());
      }
      throw err;
    }

    clearStep(userId);

    await ctx.reply(
      `⏳ <b>ማረጋገጫ አልፏል — በእጅ ማጽደቅ ያስፈልጋል</b>\n\n` +
        `💰 መጠን: <b>${amount} ETB</b>\n` +
        `🔖 Ref: <code>${reference}</code>\n` +
        `ℹ️ ከ ${MAX_AUTO_DEPOSIT_AMOUNT} ETB ይበልጣል\n\n` +
        `⏳ አስተዳዳሪ ካረጋገጠ በኋላ ገንዘቡ ወደ ዋሌትዎ ይገባል።`,
      { parse_mode: "HTML", ...mainKeyboard() }
    );

    await notifyAdmin(
      `🆕 <b>Deposit Request (>Limit)</b>\n\n` +
        `👤 ${esc(user.firstName || "User")} (${user.telegramId})\n` +
        `💰 <b>${amount} ETB</b>\n` +
        `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
        `📎 Ref: <code>${reference}</code>`
    );
  }
}

// ═══════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════
bot.catch((err, ctx) => {
  console.error(`[bot] error for ${ctx?.updateType}:`, err?.message || err);
});

// ═══════════════════════════════════════════════════════
// MAIN — Webhook
// ═══════════════════════════════════════════════════════
async function main(app) {
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
  } catch (err) {
    console.error("Menu setup error:", err);
  }

  if (WEBAPP_URL) {
    bot.telegram
      .setChatMenuButton({
        type: "web_app",
        text: "Menu",
        web_app: { url: WEBAPP_URL },
      })
      .catch(() => {});
  }

  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(bot.webhookCallback(webhookPath));

  console.log("[bot] Fetan bingo bot registered (webhook mode)");
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