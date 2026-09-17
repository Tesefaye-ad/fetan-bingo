require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");

const connectDB = require("./config/db");
const User = require("./models/User");
const Transaction = require("./models/Transaction");
const { getBannerSource } = require("./utils/bannerSource");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.BOT_WEBAPP_URL;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "@FetanBingoSupport";
const DEPOSIT_PHONE = process.env.DEPOSIT_TELEBIRR_PHONE || "0920790583";
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 10);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const BONUS_CONVERSION_RATE = Number(process.env.BONUS_CONVERSION_RATE || 1);
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "https://fetan-bingo-he4x.onrender.com";
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing. Aborting.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const pendingAction = new Map();
const app = express();
app.use(express.json());

const MAIN_MENU_TEXT =
  "👋 Welcome to Fetan Bingo! Choose an option below.\n\n" +
  "እንኳን ወደ Fetan Bingo በደህና መጡ! ከታች ያሉትን ቁልፎች በመጠቀም ጨዋታውን መጫወት ይችላሉ።";

function mainKeyboard() {
  const playButton = WEBAPP_URL
    ? Markup.button.webApp("Play 🎮", WEBAPP_URL)
    : Markup.button.callback("Play 🎮", "play_not_configured");

  return Markup.inlineKeyboard([
    [playButton, Markup.button.callback("Register 📝", "action_register")],
    [Markup.button.callback("Check Balance 💵", "action_balance"), Markup.button.callback("Deposit 💵", "action_deposit")],
    [Markup.button.callback("Withdraw 💵", "action_withdraw"), Markup.button.callback("Invite 🔗", "action_invite")],
    [Markup.button.callback("Instruction 📖", "action_instruction"), Markup.button.callback("Contact Support ☎️", "action_support")],
    [Markup.button.callback("Convert Bonus 💱", "action_convert")],
  ]);
}

async function getOrCreateUser(ctx, referredBy) {
  try {
    const tgUser = ctx.from;
    if (!tgUser) return null;
    const telegramId = String(tgUser.id);

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
          isAdmin: false,
          phone: null,
          referredBy: referredBy && referredBy !== telegramId ? referredBy : undefined,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const isNewUser =
      user.createdAt && user.updatedAt &&
      Math.abs(user.createdAt.getTime() - user.updatedAt.getTime()) < 2000;

    if (isNewUser && user.referredBy) {
      User.findOneAndUpdate(
        { telegramId: user.referredBy },
        { $inc: { referralCount: 1, bonusBalance: 5 } },
        { new: true }
      )
        .then((inviter) => {
          if (inviter) {
            bot.telegram
              .sendMessage(
                inviter.telegramId,
                `🎉 Someone joined using your invite link! You earned 5 ETB bonus.`
              )
              .catch(() => {});
          }
        })
        .catch(() => {});
    }

    return user;
  } catch (err) {
    console.error("[getOrCreateUser] error:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------
// /start — FAST (reply immediately, DB in background)
// ---------------------------------------------------------------------
bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || "";
    const referredBy = payload.startsWith("ref_") ? payload.slice(4) : null;

    // 👇 ምናሌውን ወዲያውኑ ላክ (DB ሳይጠብቅ)
    const banner = getBannerSource();
    if (banner) {
      ctx
        .replyWithPhoto(banner, { caption: MAIN_MENU_TEXT, ...mainKeyboard() })
        .catch(() => ctx.reply(MAIN_MENU_TEXT, mainKeyboard()).catch(() => {}));
    } else {
      ctx.reply(MAIN_MENU_TEXT, mainKeyboard()).catch(() => {});
    }

    // 👇 ከበስተጀርባ ዳታቤዙን አስኬድ
    getOrCreateUser(ctx, referredBy).catch((err) =>
      console.error("[/start] background error:", err.message)
    );
  } catch (err) {
    console.error("[/start] error:", err.message);
  }
});

bot.action("play_not_configured", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("The game link isn't configured yet.");
});

// ---------------------------------------------------------------------
// REGISTER — Share Contact
// ---------------------------------------------------------------------
const handleRegister = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return ctx.reply("Please try again.");

  if (user.phone) {
    return ctx.reply(
      `✅ አስቀድመው ተመዝግበዋል!\n\nName: ${user.firstName || "User"}\nPhone: ${user.phone}`,
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
    user.phone = contact.phone_number;
    await user.save();
    await ctx.reply(
      `✅ ስልክ ቁጥርዎ በተሳካ ሁኔታ ተመዝግቧል!\n📞 Phone: ${user.phone}`,
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
    `Name:      ${user.firstName || "User"} ${user.lastName || ""}\n` +
    `Phone:     ${user.phone || "Not registered"}\n` +
    `Main wallet:  ${user.balance}\n` +
    `Play wallet:  ${user.bonusBalance || 0}\n` +
    `Coin:      0`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("📋 COPY CODE", "copy_code")],
    [Markup.button.callback("💵 Deposit", "action_deposit"), Markup.button.callback("🤑 Withdraw", "action_withdraw")],
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
  await getOrCreateUser(ctx);

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
    `1. ከታች ባለው የ Telebirr አካውንት 50 ብር ያስገቡ\n` +
    `Phone: ${DEPOSIT_PHONE}\n\n` +
    `2. የከፈሉበትን አጭር የ SMS መልእክት (message) copy በማድረግ እዚህ ላይ Paste አድርገው ይላኩን 👇👇👇`
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
    "1. \"Register 📝\" የሚለውን ተጭነው ይመዝገቡ።\n" +
    "2. \"Deposit 💵\" የሚለውን ተጭነው ወደ ዋሌት ብር ያስቀምጡ።\n" +
    "3. \"Play 🎮\" የሚለውን ተጭነው WebApp ይክፈቱ።\n" +
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
    [Markup.button.switchToChat("📤 ለጓደኛ Share አድርግ", "🎉 ወደ Fetan Lottery ተቀላቀል!")],
  ]);

  await ctx.reply(text, keyboard);
};

bot.hears("Invite 🔗", handleInvite);
bot.action("action_invite", async (ctx) => {
  await ctx.answerCbQuery();
  await handleInvite(ctx);
});

// ---------------------------------------------------------------------
// SUPPORT + CONVERT BONUS
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
  user.balance += converted;
  user.bonusBalance = 0;
  await user.save();

  await Transaction.create({
    user: user._id,
    type: "deposit",
    amount: converted,
    balanceAfter: user.balance,
    meta: { source: "bonus_conversion" },
  });

  await ctx.reply(
    `✅ Converted ${converted} ETB. New balance: ${user.balance} ETB.`,
    mainKeyboard()
  );
};
bot.hears("Convert Bonus 💱", handleConvert);
bot.action("action_convert", async (ctx) => {
  await ctx.answerCbQuery();
  await handleConvert(ctx);
});

// ---------------------------------------------------------------------
// Text handler (deposit amounts)
// ---------------------------------------------------------------------
bot.on("text", async (ctx) => {
  try {
    const key = String(ctx.from.id);
    const step = pendingAction.get(key);
    if (!step) return;

    const user = await getOrCreateUser(ctx);
    if (!user) return;

    const amount = Number(ctx.message.text.trim());
    if (!amount || amount <= 0) {
      return ctx.reply("Please send a valid positive number.", mainKeyboard());
    }

    if (step.type === "deposit") {
      if (amount < MIN_DEPOSIT)
        return ctx.reply(`Minimum deposit is ${MIN_DEPOSIT} ETB.`, mainKeyboard());
      const reference = `DEP-${Date.now()}`;
      await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        balanceAfter: user.balance,
        reference,
        status: "pending",
      });
      pendingAction.delete(key);
      await ctx.reply(
        `📥 To deposit ${amount} ETB:\nSend via Telebirr to ${DEPOSIT_PHONE}, then send a screenshot here.\nReference: ${reference}\n\nBalance updates after admin confirms.`,
        mainKeyboard()
      );
      if (ADMIN_CHAT_ID) {
        bot.telegram
          .sendMessage(
            ADMIN_CHAT_ID,
            `🆕 Deposit\nUser: ${user.firstName} (${user.telegramId})\nAmount: ${amount} ETB\nRef: ${reference}`
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
// Main — Webhook Mode (FAST)
// ---------------------------------------------------------------------
async function main() {
  await connectDB();

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
      .then(() => console.log("[bot] Chat menu button set successfully."))
      .catch((err) => console.error("[bot] Failed to set chat menu button:", err.message));
  }

  // 👇 Webhook Mode (FAST)
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  app.use(bot.webhookCallback(webhookPath));

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`[bot] Express listening on port ${PORT}`);
    try {
      await bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`, {
        drop_pending_updates: true,
      });
      console.log(`[bot] Webhook set: ${RENDER_URL}${webhookPath}`);
    } catch (err) {
      console.error("[bot] setWebhook failed:", err.message);
    }
  });

  console.log("[bot] Fetan bingo bot is running (webhook mode)");
}

function startBot() {
  return main().catch((err) => {
    console.error("[bot] failed to start:", err);
  });
}

module.exports = { startBot };

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));