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

// ═══════════════════════════════════════════════════════
// ADMIN TELEGRAM IDs
// ═══════════════════════════════════════════════════════
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || "494653076")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ═══════════════════════════════════════════════════════
// BANNER SOURCE
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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.BOT_WEBAPP_URL;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "@FetanBingoSupport";
const DEPOSIT_PHONE = process.env.DEPOSIT_TELEBIRR_PHONE || "0920790583";
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 10);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const BONUS_CONVERSION_RATE = Number(process.env.BONUS_CONVERSION_RATE || 1);

// ═══════════════════════════════════════════════════════
// AUTO-DEPOSIT SETTINGS
// ═══════════════════════════════════════════════════════
const AUTO_APPROVE_DEPOSITS = true;
const MAX_AUTO_DEPOSIT_AMOUNT = 5000;
const MAX_SMS_AGE_HOURS = 24;

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing. Aborting.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const pendingAction = new Map();

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
      Markup.button.callback("Withdraw 💵", "action_withdraw"),
      Markup.button.callback("Invite 🔗", "action_invite"),
    ],
    [
      Markup.button.callback("Instruction 📖", "action_instruction"),
      Markup.button.callback("Contact Support ☎️", "action_support"),
    ],
    
  ]);
}

// ═══════════════════════════════════════════════════════
// Telebirr SMS መተንተኛ
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

  // Amount
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

  // Transaction ID
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

  // Phone
  const phoneMatch = clean.match(/(?:\+?251|0)?9\d{8}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  // Fingerprint
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
// ፈጣን የተጠቃሚ ፍለጋ/ፍጠር
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
// የ referral ቦነስ
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

// ---------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------
bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || "";
    const referredBy = payload.startsWith("ref_") ? payload.slice(4) : null;
    const telegramId = String(ctx.from.id);

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
  await ctx.answerCbQuery();
  await ctx.reply("The game link isn't configured yet.");
});

// ---------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------
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
  await ctx.answerCbQuery();
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

// ---------------------------------------------------------------------
// CHECK BALANCE
// ---------------------------------------------------------------------
const handleBalance = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const text =
    `🧳 Account Info\n\n` +
    `Name:     ${user.firstName || "User"} ${user.lastName || ""}\n` +
    `Phone:    ${user.phone || "Not registered"}\n` +
    `Main wallet:  ${user.balance}\n` +
    `Play wallet:  ${user.bonusBalance || 0}\n` +
    `Coin:      0`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("📋 COPY CODE", "copy_code")],
    [
      Markup.button.callback("💵 Deposit", "action_deposit"),
      Markup.button.callback("🤑 Withdraw", "action_withdraw"),
    ],
  ]);

  await ctx.reply(text, keyboard);
};

bot.hears("Check Balance 💵", handleBalance);
bot.action("action_balance", async (ctx) => {
  await ctx.answerCbQuery();
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

// ---------------------------------------------------------------------
// DEPOSIT
// ---------------------------------------------------------------------
const handleDeposit = async (ctx) => {
  getOrCreateUser(ctx).catch(() => {});

  const text =
    "💵 ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ::\n\n" +
    "✨ ብር ማስገባት የሚችሉት አሁን በተቀመጠው የ Telebirr አካውንት ብቻ ነው::\n" +
    "🚫 ከዚህ ውጭ የላከ አንስተናግድም 🚫\n\n" +
    "👇 Telebirr የሚለውን ይምረጡ 👇";

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Telebirr", "telebirr_pay")],
    [Markup.button.callback("❌ Cancel", "cancel_action")],
  ]);

  await ctx.reply(text, keyboard);
  pendingAction.set(String(ctx.from.id), { type: "deposit" });
};

bot.hears("Deposit 💵", handleDeposit);
bot.action("action_deposit", async (ctx) => {
  await ctx.answerCbQuery();
  await handleDeposit(ctx);
});

bot.action("telebirr_pay", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `የሚያጋጥማቹ ችግር ካለ: ${SUPPORT_CONTACT} ላይ ያግኙን::\n\n` +
      `1. ከታች ባለው የ Telebirr አካውንት ብር ያስገቡ\n` +
      `Phone: ${DEPOSIT_PHONE}\n\n` +
      `2. የከፈሉበትን የ SMS መልእክት (message) copy በማድረግ እዚህ ላይ Paste አድርገው ይላኩን 👇👇👇`
  );
});

bot.action("cancel_action", async (ctx) => {
  await ctx.answerCbQuery("❌ Cancelled");
  pendingAction.delete(String(ctx.from.id));
  await ctx.reply("❌ ሂደቱ ተሰርዟል።", mainKeyboard());
});

// ---------------------------------------------------------------------
// WITHDRAW
// ---------------------------------------------------------------------
const handleWithdraw = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const text =
    "📩 ገንዘብ ማውጣት (Withdrawal)\n\n" +
    `• ያልዎት ቀሪ ሂሳብ: ${user.balance} ETB\n` +
    `• አነስተኛ ማውጣት የሚቻል: ${MIN_WITHDRAW} ETB\n\n` +
    "ገንዘብ ለማውጣት በ WebApp ውስጥ ያለውን Wallet ገፅ ይጠቀሙ ወይም አስተዳዳሪውን ያናግሩ::";

  await ctx.reply(text, mainKeyboard());
};

bot.hears("Withdraw 💵", handleWithdraw);
bot.action("action_withdraw", async (ctx) => {
  await ctx.answerCbQuery();
  await handleWithdraw(ctx);
});

// ---------------------------------------------------------------------
// INSTRUCTION
// ---------------------------------------------------------------------
const handleInstruction = async (ctx) => {
  const text =
    "📖 የጨዋታው መመሪያ:\n\n" +
    '1. "Register 📝" የሚለውን ተጭነው ይመዝገቡ።\n' +
    '2. "Deposit 💵" የሚለውን ተጭነው ወደ ዋሌት ብር ያስቀምጡ።\n' +
    '3. "Play 🎮" የሚለውን ተጭነው WebApp ይክፈቱ።\n' +
    "4. የሚወዱትን እስቴክ (Stake 10 ወይም Stake 20) እና የሎተሪ ቁጥር ይምረጡ።\n" +
    "5. ሰዓቱ ሲያልቅ እጣው በቀጥታ ይወጣል፤ ካሸነፉ ገንዘቡ ወዲያውኑ ወደ Main Walletዎ ገቢ ይሆናል!";

  await ctx.reply(text, mainKeyboard());
};

bot.hears("Instruction 📖", handleInstruction);
bot.action("action_instruction", async (ctx) => {
  await ctx.answerCbQuery();
  await handleInstruction(ctx);
});

// ---------------------------------------------------------------------
// INVITE
// ---------------------------------------------------------------------
const handleInvite = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;

  const botInfo = await ctx.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${user.telegramId}`;

  const text =
    "🔥 ባንድዎ ያለውን ስልክ በመጠቀም ብቻ ዕድልዎን ይሞክሩ!\n\n" +
    "🎉 ወደ Fetan Bingo ይቀላቀሉ እና አሁኑኑ መሸነፍ ይጀምሩ!\n\n" +
    "🎁 ልዩ ቦነስ: ከታች ባለው ሊንክ ሲመዘገብ ብቻ የ 10 ETB ቦነስ በ Play Wallet ላይ ይጨመርልዎታል!\n\n" +
    "✅ ቀላል አሰፈዋት\n" +
    "✅ ፈጣን ዲፖዚት እና ዊዝድሮዋል\n" +
    "✅ አስተማማኝ እና ፈጣን ክፍያ ማውጣት\n\n" +
    "🔗 የእርሶው መጋበዣ ሊንክ:\n" +
    `${link}\n\n` +
    "👇 አሁን በመመዝገብ ናፍ ቦነስዎን ይሰብስቡ!";

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.switchToChat(
        "📤 ለጓደኛ Share አድርግ",
        "🎉 ወደ Fetan Lottery ተቀላቀል!"
      ),
    ],
  ]);

  await ctx.reply(text, keyboard);
};

bot.hears("Invite 🔗", handleInvite);
bot.action("action_invite", async (ctx) => {
  await ctx.answerCbQuery();
  await handleInvite(ctx);
});

// ---------------------------------------------------------------------
// SUPPORT 
// ---------------------------------------------------------------------
const handleSupport = async (ctx) => {
  await ctx.reply(`☎️ Need help? Message ${SUPPORT_CONTACT}.`, mainKeyboard());
};
bot.hears("Contact Support ☎️", handleSupport);
bot.action("action_support", async (ctx) => {
  await ctx.answerCbQuery();
  await handleSupport(ctx);
});

const handleConvert = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  if (user.bonusBalance <= 0) {
    return ctx.reply("No bonus balance to convert.", mainKeyboard());
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
    meta: { source: "bonus_conversion" },
  });

  await ctx.reply(
    `✅ Converted ${converted} ETB. New balance: ${
      user.balance + converted
    } ETB.`,
    mainKeyboard()
  );
};


// ═══════════════════════════════════════════════════════
// 📱 TEXT HANDLER — SMS + STRICT VERIFY + AUTO-APPROVE
// ═══════════════════════════════════════════════════════
bot.on("text", async (ctx) => {
  try {
    const key = String(ctx.from.id);
    const step = pendingAction.get(key);

    const user = await getOrCreateUser(ctx);
    if (!user) return;

    const rawText = ctx.message.text.trim();
    const parsed = parseTelebirrSMS(rawText);

    // Ignore non-deposit messages
    if (!step && !parsed.amount) return;

    // If user just typed a plain number → guide them
    if (step?.type === "deposit" && !parsed.transactionId && !parsed.phone) {
      const justNumber = Number(rawText);
      if (justNumber && justNumber > 0) {
        return ctx.reply(
          `📥 ማስገባት ለማድረግ ${justNumber} ETB:\n\n` +
            `1️⃣ ወደ ${DEPOSIT_PHONE} ይላኩ\n` +
            `2️⃣ የከፈሉበትን ሙሉ SMS copy አድርገው እዚህ ላይ paste ያድርጉ\n\n` +
            `⚠️ SMS ሙሉ ጽሑፍ ይላኩ — ቁጥር ብቻ አይላኩ።`,
          mainKeyboard()
        );
      }
    }

    // Must have amount
    if (!parsed.amount) {
      return ctx.reply(
        "❌ ከ SMS ውስጥ የገንዘብ መጠን ማግኘት አልቻልኩም።\n\n" +
          "እባክዎ የ Telebirr SMS ሙሉ በሙሉ copy አድርገው እዚህ ይላኩ።",
        mainKeyboard()
      );
    }

    let amount = parsed.amount;

    // Min amount
    if (amount < MIN_DEPOSIT) {
      return ctx.reply(
        `❌ አነስተኛ ማስገባት ${MIN_DEPOSIT} ETB ነው። የላኩት: ${amount} ETB`,
        mainKeyboard()
      );
    }

    // ═══════════════════════════════════════════════════
    // DUPLICATE CHECK #1 — SMS fingerprint
    // ═══════════════════════════════════════════════════
    const existingBySMS = await Transaction.findOne({
      "meta.smsFingerprint": parsed.fingerprint,
    }).lean();

    if (existingBySMS) {
      const dateStr = new Date(existingBySMS.createdAt).toLocaleString(
        "en-US",
        {
          timeZone: "Africa/Addis_Ababa",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }
      );
      return ctx.reply(
        `⚠️ <b>ይህ SMS ከዚህ በፊት ተልኳል!</b>\n\n` +
          `📅 ${dateStr}\n` +
          `💰 ${existingBySMS.amount} ETB\n` +
          `📋 ${existingBySMS.status.toUpperCase()}\n\n` +
          `❌ ተመሳሳይ SMS ሁለት ጊዜ መላክ አይቻልም።`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );
    }

    // ═══════════════════════════════════════════════════
    // DUPLICATE CHECK #2 — Telebirr Transaction ID
    // ═══════════════════════════════════════════════════
    if (parsed.transactionId) {
      const existingByTxId = await Transaction.findOne({
        "meta.transactionId": parsed.transactionId,
      }).lean();

      if (existingByTxId) {
        return ctx.reply(
          `⚠️ <b>ይህ የግብይት ቁጥር ከዚህ በፊት ተልኳል!</b>\n\n` +
            `🔖 <code>${parsed.transactionId}</code>\n` +
            `💰 ${existingByTxId.amount} ETB\n` +
            `📋 ${existingByTxId.status.toUpperCase()}\n\n` +
            `❌ አንድ ግብይት ሁለት ጊዜ መመዝገብ አይቻልም።`,
          { parse_mode: "HTML", ...mainKeyboard() }
        );
      }
    }

    // ═══════════════════════════════════════════════════
    // 🌐 RECEIPT ONLINE VERIFICATION — Strict
    // ═══════════════════════════════════════════════════
    let receiptData = null;

    if (!parsed.transactionId) {
      // No TxID → pending for manual review
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

      pendingAction.delete(key);

      await ctx.reply(
        `⏳ <b>ማረጋገጫ አልተቻለም</b>\n\n` +
          `📎 Transaction ID አልተገኘም\n` +
          `💰 መጠን: <b>${amount} ETB</b>\n\n` +
          `📋 ጥያቄዎ ለአስተዳዳሪ ተልኳል — በእጅ ይጸድቃል።\n` +
          `🔖 Ref: <code>${reference}</code>\n\n` +
          `⚠️ ገንዘቡ እስኪረጋገጥ ድረስ አልገባም።`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );

      if (ADMIN_CHAT_ID) {
        bot.telegram
          .sendMessage(
            ADMIN_CHAT_ID,
            `⚠️ <b>Manual Review (No TxID)</b>\n\n` +
              `👤 ${user.firstName || "User"} (${user.telegramId})\n` +
              `💰 ${amount} ETB\n` +
              `📎 Ref: <code>${reference}</code>`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
      return;
    }

    // ─── TxID exists → run online verification ───
    const checkMsg = await ctx
      .reply(
        `🔍 ደረሰኙን በኢትዮ ቴሌኮም ላይ በማረጋገጥ ላይ...\n` +
          `📎 ID: ${parsed.transactionId}`
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

    // ───────────────────────────────────────────────
    // ❌ VERIFICATION FAILED
    // ───────────────────────────────────────────────
    if (!result.ok) {
      // Case A: Explicit mismatch → REJECT outright
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
        pendingAction.delete(key);

        await ctx.reply(
          `${result.message}\n\n` +
            `❌ ገንዘቡ ወደ አካውንትዎ አልገባም።\n` +
            `📞 ችግር ካለ ${SUPPORT_CONTACT} ያግኙን።`,
          mainKeyboard()
        );

        if (ADMIN_CHAT_ID) {
          bot.telegram
            .sendMessage(
              ADMIN_CHAT_ID,
              `❌ <b>Deposit Rejected</b>\n\n` +
                `👤 ${user.firstName || "User"} (${user.telegramId})\n` +
                `💰 ${amount} ETB\n` +
                `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
                `📋 ምክንያት: ${result.reason}\n` +
                `📝 ${result.message}`,
              { parse_mode: "HTML" }
            )
            .catch(() => {});
        }
        return;
      }

      // Case B: Technical failure → pending for manual review
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
            verificationMessage: result.message,
          },
        });
      } catch (err) {
        if (err.code === 11000) {
          return ctx.reply(
            "⚠️ ይህ ደረሰኝ በቅርብ ጊዜ ተመዝግቧል።",
            mainKeyboard()
          );
        }
        throw err;
      }

      pendingAction.delete(key);

      await ctx.reply(
        `⏳ <b>ማረጋገጫ አልተቻለም</b>\n\n` +
          `📎 ID: <code>${parsed.transactionId}</code>\n` +
          `💰 መጠን: <b>${amount} ETB</b>\n` +
          `📋 ምክንያት: <i>${result.reason}</i>\n\n` +
          `📋 ጥያቄዎ ለአስተዳዳሪ ተልኳል — በእጅ ይጸድቃል።\n` +
          `🔖 Ref: <code>${reference}</code>\n\n` +
          `⚠️ ገንዘቡ እስኪረጋገጥ ድረስ አልገባም።`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );

      if (ADMIN_CHAT_ID) {
        bot.telegram
          .sendMessage(
            ADMIN_CHAT_ID,
            `⚠️ <b>Manual Review Required</b>\n\n` +
              `👤 ${user.firstName || "User"} (${user.telegramId})\n` +
              `💰 ${amount} ETB\n` +
              `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
              `🔍 ምክንያት: <i>${result.reason}</i>\n` +
              `📎 Ref: <code>${reference}</code>`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
      return;
    }

    // ───────────────────────────────────────────────
    // ✅ VERIFICATION PASSED
    // ───────────────────────────────────────────────
    receiptData = result.data;
    amount = result.data.amount;
    console.log(
      `[verify] ✅ ${parsed.transactionId} VERIFIED via ${result.via} — ${amount} ETB`
    );

    // ═══════════════════════════════════════════════════
    // ✅ ADD TO BALANCE
    // ═══════════════════════════════════════════════════
    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 999)}`;

    const canAutoApprove =
      AUTO_APPROVE_DEPOSITS && amount <= MAX_AUTO_DEPOSIT_AMOUNT;

    if (canAutoApprove) {
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $inc: {
            balance: amount,
            totalDeposits: amount,
          },
        },
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
        // Rollback
        if (err.code === 11000) {
          await User.findByIdAndUpdate(user._id, {
            $inc: { balance: -amount, totalDeposits: -amount },
          });
          return ctx.reply(
            "⚠️ ይህ ደረሰኝ በቅርብ ጊዜ ተመዝግቧል።",
            mainKeyboard()
          );
        }
        throw err;
      }

      pendingAction.delete(key);

      // ✅ SUCCESS MESSAGE
      await ctx.reply(
        `✅ <b>ማስገባት ተሳክቷል!</b>\n\n` +
          `💰 መጠን: <b>+${amount} ETB</b>\n` +
          `💳 አዲስ ቀሪ ሂሳብ: <b>${updatedUser.balance} ETB</b>\n` +
          `🔖 Reference: <code>${reference}</code>\n` +
          `📎 Telebirr ID: <code>${parsed.transactionId}</code>\n\n` +
          `🎮 አሁን መጫወት ይችላሉ!`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );

      // Notify admin
      if (ADMIN_CHAT_ID) {
        bot.telegram
          .sendMessage(
            ADMIN_CHAT_ID,
            `✅ <b>Auto-Approved Deposit</b>\n\n` +
              `👤 ${user.firstName || "User"} (${user.telegramId})\n` +
              `💰 <b>${amount} ETB</b>\n` +
              `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
              `🔍 Verified via: ${receiptData ? "online" : "sms"}\n` +
              `📎 Ref: <code>${reference}</code>`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
    } else {
      // Amount exceeds auto-limit → pending
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
          return ctx.reply(
            "⚠️ ይህ SMS በቅርብ ጊዜ ተመዝግቧል።",
            mainKeyboard()
          );
        }
        throw err;
      }

      pendingAction.delete(key);

      await ctx.reply(
        `⏳ <b>ማረጋገጫ አልፏል — በእጅ ማጽደቅ ያስፈልጋል</b>\n\n` +
          `💰 መጠን: <b>${amount} ETB</b>\n` +
          `🔖 Ref: <code>${reference}</code>\n` +
          `ℹ️ ከ ${MAX_AUTO_DEPOSIT_AMOUNT} ETB ይበልጣል\n\n` +
          `⏳ አስተዳዳሪ ካረጋገጠ በኋላ ገንዘቡ ወደ ዋሌትዎ ይገባል።`,
        { parse_mode: "HTML", ...mainKeyboard() }
      );

      if (ADMIN_CHAT_ID) {
        bot.telegram
          .sendMessage(
            ADMIN_CHAT_ID,
            `🆕 <b>Deposit Request (>Limit)</b>\n\n` +
              `👤 ${user.firstName || "User"} (${user.telegramId})\n` +
              `💰 <b>${amount} ETB</b>\n` +
              `📎 Tx ID: <code>${parsed.transactionId}</code>\n` +
              `📎 Ref: <code>${reference}</code>`,
            { parse_mode: "HTML" }
          )
          .catch(() => {});
      }
    }
  } catch (err) {
    console.error("[text handler] error:", err.message);
  }
});

bot.catch((err, ctx) => {
  console.error(`[bot] error for ${ctx?.updateType}:`, err?.message || err);
});

// ---------------------------------------------------------------------
// Main — Webhook Mode
// ---------------------------------------------------------------------
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