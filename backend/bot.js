/**
 * Fetan Bingo - Telegram bot (FAST VERSION)
 * 
 * Optimizations:
 * - /start replies INSTANTLY (before DB call)
 * - User creation happens in background
 * - Banner photo is optional and non-blocking
 * - Single DB query for user lookup/create (findOneAndUpdate)
 */
require("dotenv").config();
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
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const BONUS_CONVERSION_RATE = Number(process.env.BONUS_CONVERSION_RATE || 1);
const USE_BANNER = process.env.BOT_BANNER_URL ? true : false;

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing. Aborting.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const pendingAction = new Map();

const MAIN_MENU_TEXT =
  "👋 Welcome to Fetan Bingo!\n" +
  "🎲 Beteseb Bingo - Win Big - Play Fair\n\n" +
  "እንኳን ወደ Fetan Bingo በደህና መጡ!";

function mainKeyboard() {
  const playButton = WEBAPP_URL
    ? Markup.button.webApp("Play 🎲", WEBAPP_URL)
    : Markup.button.callback("Play 🎲", "play_not_configured");

  return Markup.inlineKeyboard([
    [playButton, Markup.button.callback("Register 📝", "action_register")],
    [Markup.button.callback("Check Balance 💳", "action_balance"), Markup.button.callback("Deposit 💳", "action_deposit")],
    [Markup.button.callback("Withdraw 💵", "action_withdraw"), Markup.button.callback("Invite 🔗", "action_invite")],
    [Markup.button.callback("Transfer 💸", "action_transfer"), Markup.button.callback("Convert Bonus 💱", "action_convert")],
    [Markup.button.callback("Instruction 📖", "action_instruction"), Markup.button.callback("Contact Support ☎️", "action_support")],
  ]);
}

/**
 * FAST: Single DB query using findOneAndUpdate with upsert.
 * Returns the user object immediately.
 */
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
          referredBy:
            referredBy && referredBy !== telegramId ? referredBy : undefined,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Referral bonus: only on very first creation
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
// /start — FAST: reply instantly, DB runs in background
// ---------------------------------------------------------------------
bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || "";
    const referredBy = payload.startsWith("ref_") ? payload.slice(4) : null;

    // 1. Send banner if configured (non-blocking, 2s timeout)
    if (USE_BANNER) {
      const banner = getBannerSource();
      if (banner) {
        ctx
          .replyWithPhoto(banner, { caption: MAIN_MENU_TEXT, ...mainKeyboard() })
          .catch(() => {
            // If photo fails, fall back to text
            ctx.reply(MAIN_MENU_TEXT, mainKeyboard()).catch(() => {});
          });
      } else {
        await ctx.reply(MAIN_MENU_TEXT, mainKeyboard());
      }
    } else {
      // No banner configured - instant text reply
      await ctx.reply(MAIN_MENU_TEXT, mainKeyboard());
    }

    // 2. Create/update user in BACKGROUND (don't await)
    getOrCreateUser(ctx, referredBy).catch((err) =>
      console.error("[/start] background user creation error:", err.message)
    );
  } catch (err) {
    console.error("[/start] error:", err.message);
    try {
      await ctx.reply(MAIN_MENU_TEXT, mainKeyboard());
    } catch (_) {}
  }
});

bot.action("play_not_configured", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("The game link isn't configured yet.");
});

// ---------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------

const handleRegister = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return ctx.reply("Please try again.");
  await ctx.reply(
    `✅ You're registered, ${user.firstName || "player"}!\nTelegram ID: ${user.telegramId}\n\nTap "Play 🎲" any time to jump into a game.`,
    mainKeyboard()
  );
};
bot.hears("Register 📝", handleRegister);
bot.action("action_register", async (ctx) => {
  await ctx.answerCbQuery();
  await handleRegister(ctx);
});

const handleBalance = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return ctx.reply("Please try again.");
  await ctx.reply(
    `💰 Main balance: ${user.balance} ETB\n🎁 Bonus balance: ${user.bonusBalance} ETB\n🏆 Games won: ${user.gamesWon}\n👥 Invites: ${user.referralCount}`,
    mainKeyboard()
  );
};
bot.hears("Check Balance 💳", handleBalance);
bot.action("action_balance", async (ctx) => {
  await ctx.answerCbQuery();
  await handleBalance(ctx);
});

const handleDeposit = async (ctx) => {
  await getOrCreateUser(ctx);
  pendingAction.set(String(ctx.from.id), { type: "deposit" });
  await ctx.reply(
    `How much would you like to deposit? (min ${MIN_DEPOSIT} ETB)\nType a number, e.g. 100`,
    mainKeyboard()
  );
};
bot.hears("Deposit 💳", handleDeposit);
bot.action("action_deposit", async (ctx) => {
  await ctx.answerCbQuery();
  await handleDeposit(ctx);
});

const handleWithdraw = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  if (user.balance < MIN_WITHDRAW) {
    return ctx.reply(
      `Balance (${user.balance} ETB) below minimum ${MIN_WITHDRAW} ETB.`,
      mainKeyboard()
    );
  }
  pendingAction.set(String(ctx.from.id), { type: "withdraw" });
  await ctx.reply(
    `How much to withdraw? (min ${MIN_WITHDRAW} ETB, balance: ${user.balance} ETB)`,
    mainKeyboard()
  );
};
bot.hears("Withdraw 💵", handleWithdraw);
bot.action("action_withdraw", async (ctx) => {
  await ctx.answerCbQuery();
  await handleWithdraw(ctx);
});

const handleTransfer = async (ctx) => {
  await getOrCreateUser(ctx);
  pendingAction.set(String(ctx.from.id), { type: "transfer" });
  await ctx.reply(
    `Send the recipient's Telegram ID and amount in this format:\n\n<telegramId> <amount>\n\nExample: 123456789 50`,
    mainKeyboard()
  );
};
bot.hears("Transfer 💸", handleTransfer);
bot.action("action_transfer", async (ctx) => {
  await ctx.answerCbQuery();
  await handleTransfer(ctx);
});

const handleInvite = async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) return;
  const me = await ctx.telegram.getMe();
  const link = `https://t.me/${me.username}?start=ref_${user.telegramId}`;
  await ctx.reply(
    `🔗 Share your invite link - earn 5 ETB bonus per friend:\n\n${link}\n\nFriends so far: ${user.referralCount}`,
    mainKeyboard()
  );
};
bot.hears("Invite 🔗", handleInvite);
bot.action("action_invite", async (ctx) => {
  await ctx.answerCbQuery();
  await handleInvite(ctx);
});

const handleInstruction = async (ctx) => {
  await ctx.reply(
    "📖 How to play:\n" +
      "1. Tap Play 🎲 to open the game.\n" +
      "2. Choose stake (10 ETB / 20 ETB / weekly).\n" +
      "3. Pick a Cartela (card) before the countdown ends.\n" +
      "4. Numbers are called every 4 seconds.\n" +
      "5. Complete a row, column, diagonal, or full card.\n" +
      "6. Tap BINGO! to claim.\n\n" +
      "ጨዋታውን እንዴት መጫወት:\n" +
      "1. Play 🎲 ን ይንኩ\n" +
      "2. የስታክ መጠን ይምረጡ\n" +
      "3. ካርቴላ ይምረጡ\n" +
      "4. ቁጥሮች በየ 4 ሰከንዱ ይጠራሉ\n" +
      "5. BINGO! ን ይንኩ",
    mainKeyboard()
  );
};
bot.hears("Instruction 📖", handleInstruction);
bot.action("action_instruction", async (ctx) => {
  await ctx.answerCbQuery();
  await handleInstruction(ctx);
});

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
// Text handler (deposit / withdraw / transfer amounts)
// ---------------------------------------------------------------------
bot.on("text", async (ctx) => {
  try {
    const key = String(ctx.from.id);
    const step = pendingAction.get(key);
    if (!step) return;

    const user = await getOrCreateUser(ctx);
    if (!user) return;

    if (step.type === "transfer") {
      const parts = ctx.message.text.trim().split(/\s+/);
      if (parts.length !== 2) {
        return ctx.reply("Invalid format. Use: <telegramId> <amount>", mainKeyboard());
      }
      const [toTgId, amountStr] = parts;
      const amount = Number(amountStr);
      if (!amount || amount <= 0) return ctx.reply("Invalid amount.", mainKeyboard());

      const recipient = await User.findOne({ telegramId: String(toTgId) });
      if (!recipient) return ctx.reply("Recipient not found.", mainKeyboard());
      if (recipient.telegramId === user.telegramId)
        return ctx.reply("Cannot transfer to yourself.", mainKeyboard());
      if (user.balance < amount) return ctx.reply("Insufficient balance.", mainKeyboard());

      user.balance -= amount;
      recipient.balance += amount;
      await user.save();
      await recipient.save();

      await Transaction.create({
        user: user._id,
        type: "transfer_out",
        amount,
        balanceAfter: user.balance,
        counterparty: recipient._id,
      });
      await Transaction.create({
        user: recipient._id,
        type: "transfer_in",
        amount,
        balanceAfter: recipient.balance,
        counterparty: user._id,
      });

      pendingAction.delete(key);
      await ctx.reply(
        `✅ Transferred ${amount} ETB to ${recipient.firstName || recipient.username}.\nNew balance: ${user.balance} ETB`,
        mainKeyboard()
      );
      bot.telegram
        .sendMessage(
          recipient.telegramId,
          `💸 You received ${amount} ETB from ${user.firstName || user.username}.`
        )
        .catch(() => {});
      return;
    }

    const amount = Number(ctx.message.text.trim());
    if (!amount || amount <= 0) {
      return ctx.reply("Please send a valid positive number, or tap a menu button.", mainKeyboard());
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
      notifyAdmin(
        `🆕 Deposit\nUser: ${user.firstName} (${user.telegramId})\nAmount: ${amount} ETB\nRef: ${reference}`
      );
    }

    if (step.type === "withdraw") {
      if (amount < MIN_WITHDRAW)
        return ctx.reply(`Minimum withdrawal is ${MIN_WITHDRAW} ETB.`, mainKeyboard());
      if (amount > user.balance) {
        pendingAction.delete(key);
        return ctx.reply(`Insufficient balance (${user.balance} ETB).`, mainKeyboard());
      }
      user.balance -= amount;
      await user.save();
      await Transaction.create({
        user: user._id,
        type: "withdrawal",
        amount,
        balanceAfter: user.balance,
        status: "pending",
      });
      pendingAction.delete(key);
      await ctx.reply(
        `📤 Withdrawal of ${amount} ETB requested.\nNew balance: ${user.balance} ETB.`,
        mainKeyboard()
      );
      notifyAdmin(
        `🆕 Withdrawal\nUser: ${user.firstName} (${user.telegramId})\nAmount: ${amount} ETB`
      );
    }
  } catch (err) {
    console.error("[text handler] error:", err.message);
  }
});

function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID) return;
  bot.telegram.sendMessage(ADMIN_CHAT_ID, text).catch(() => {});
}

bot.catch((err, ctx) => {
  console.error(`[bot] error for ${ctx?.updateType}:`, err?.message || err);
});

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once("connected", resolve));
  }

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log("[bot] Webhook cleared successfully.");
  } catch (err) {
    console.error("[bot] Failed to clear webhook:", err.message);
  }

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

  // Non-blocking launch
  bot.launch().catch((err) => {
    console.error("[bot.launch] error:", err.message);
  });

  // Set chat menu button in background (don't await)
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

  console.log("[bot] Fetan bingo bot is running");
}

function startBot() {
  return main().catch((err) => {
    console.error("[bot] failed to start:", err);
  });
}

module.exports = { startBot };

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));