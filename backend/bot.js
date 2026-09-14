/**
 * Fetan Lottery / Fetan Bingo - Telegram bot
 *
 * Runs as its OWN process (node bot.js), separate from Server.js. It
 * shares the same MongoDB models as the web app backend, so balances
 * shown here and in the Web App are always the same numbers.
 */
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
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const BONUS_CONVERSION_RATE = Number(process.env.BONUS_CONVERSION_RATE || 1);

if (!BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is missing. Aborting.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const pendingAction = new Map();

const MAIN_MENU_TEXT =
  "👋 Welcome to Fetan Lottery! Choose an option below.\n\n" +
  "እንኳን ወደ Fetan Lottery በደህና መጡ! ከታች ያሉትን ቁልፎች በመጠቀም ጨዋታውን መጫወት ይችላሉ።";

function mainKeyboard() {
  const playButton = WEBAPP_URL
    ? Markup.button.webApp("Play 🎮", WEBAPP_URL)
    : Markup.button.callback("Play 🎮", "play_not_configured");

  return Markup.keyboard([
    [playButton, Markup.button.text("Register 📝")],
    [Markup.button.text("Check Balance 💰"), Markup.button.text("Deposit 💵")],
    [Markup.button.text("Withdraw 🤑"), Markup.button.text("Invite 🔗")],
    [Markup.button.text("Instruction 📖"), Markup.button.text("Contact Support ☎️")],
    [Markup.button.text("Convert Bonus 💱")],
  ])
    .resize() 
    .persistent(); 
}

async function getOrCreateUser(ctx, referredBy) {
  try {
    const tgUser = ctx.from;
    if (!tgUser) return null;
    const telegramId = String(tgUser.id);

    let user = await User.findOne({ telegramId });
    if (!user) {
      user = await User.create({
        telegramId,
        username: tgUser.username,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
        referredBy: referredBy && referredBy !== telegramId ? referredBy : undefined,
      });

      if (user.referredBy) {
        const inviter = await User.findOneAndUpdate(
          { telegramId: user.referredBy },
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
      }
    }
    return user;
  } catch (err) {
    console.error("[getOrCreateUser] error:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------
bot.start(async (ctx) => {
  try {
    const payload = ctx.startPayload || ""; 
    const referredBy = payload.startsWith("ref_") ? payload.slice(4) : null;

    const user = await getOrCreateUser(ctx, referredBy);
    if (!user) {
      return ctx.reply("Something went wrong. Please try /start again.");
    }

    const banner = getBannerSource();
    if (banner) {
      try {
        await ctx.replyWithPhoto(banner, {
          caption: MAIN_MENU_TEXT,
          ...mainKeyboard(),
        });
        return;
      } catch (photoErr) {
        console.error("[/start] photo reply failed, falling back to text:", photoErr.message);
      }
    }
    await ctx.reply(MAIN_MENU_TEXT, mainKeyboard());
  } catch (err) {
    console.error("[/start] error:", err.message);
    try {
      await ctx.reply("Something went wrong. Please try /start again.");
    } catch (_) {}
  }
});

bot.action("play_not_configured", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply(
      "The game link isn't configured yet. Set BOT_WEBAPP_URL in the bot's environment variables."
    );
  } catch (err) {
    console.error("[play_not_configured] error:", err.message);
  }
});

bot.hears("Register 📝", async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    await ctx.reply(
      `✅ You're registered, ${user.firstName || "player"}!\nTelegram ID: ${user.telegramId}\n\nTap "Play 🎮" any time to jump into a game.`
    );
  } catch (err) {
    console.error("[Register] error:", err.message);
  }
});

bot.hears("Check Balance 💰", async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    await ctx.reply(
      `💰 Main balance: ${user.balance} ETB\n🎁 Bonus balance: ${user.bonusBalance} ETB (use "Convert Bonus 💱" to move it to your main balance)`
    );
  } catch (err) {
    console.error("[Check Balance] error:", err.message);
  }
});

bot.hears("Deposit 💵", async (ctx) => {
  try {
    await getOrCreateUser(ctx);
    pendingAction.set(String(ctx.from.id), { type: "deposit" });
    await ctx.reply(
      `How much would you like to deposit? (minimum ${MIN_DEPOSIT} ETB)\nJust type a number, e.g. 100`
    );
  } catch (err) {
    console.error("[Deposit] error:", err.message);
  }
});

bot.hears("Withdraw 🤑", async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    if (user.balance < MIN_WITHDRAW) {
      return ctx.reply(
        `Your balance (${user.balance} ETB) is below the minimum withdrawal of ${MIN_WITHDRAW} ETB.`
      );
    }
    pendingAction.set(String(ctx.from.id), { type: "withdraw" });
    await ctx.reply(
      `How much would you like to withdraw? (minimum ${MIN_WITHDRAW} ETB, balance: ${user.balance} ETB)\nJust type a number, e.g. 100`
    );
  } catch (err) {
    console.error("[Withdraw] error:", err.message);
  }
});

bot.hears("Invite 🔗", async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    const me = await ctx.telegram.getMe();
    const link = `https://t.me/${me.username}?start=ref_${user.telegramId}`;
    await ctx.reply(
      `🔗 Share your invite link - you earn 5 ETB bonus for every friend who joins:\n\n${link}\n\nFriends invited so far: ${user.referralCount}`
    );
  } catch (err) {
    console.error("[Invite] error:", err.message);
  }
});

bot.hears("Instruction 📖", async (ctx) => {
  try {
    await ctx.reply(
      "📖 How to play:\n" +
        "1. Tap Play 🎮 to open the game.\n" +
        "2. Join or create a room - the entry fee is deducted from your balance.\n" +
        "3. Once 2+ players join, numbers are called automatically.\n" +
        "4. Tap a number on your card once it's called.\n" +
        "5. Complete a row, column, diagonal, or the full card, then tap BINGO! to claim the prize pool.\n\n" +
        "ጨዋታውን እንዴት መጫወት ይቻላል:\n" +
        "1. Play 🎮 የሚለውን ይንኩ።\n" +
        "2. ክፍል ይቀላቀሉ ወይም ይፍጠሩ - መግቢያ ክፍያው ከሂሳብዎ ይቀነሳል።\n" +
        "3. 2 ወይም ከዚያ በላይ ተጫዋቾች ሲቀላቀሉ ቁጥሮች በራስ-ሰር ይጠራሉ።\n" +
        "4. የተጠራውን ቁጥር በካርድዎ ላይ ይንኩ።\n" +
        "5. ረድፍ፣ አምድ፣ ዲያጎናል ወይም ሙሉ ካርድ ሲያጠናቅቁ BINGO! የሚለውን ይንኩ。"
    );
  } catch (err) {
    console.error("[Instruction] error:", err.message);
  }
});

bot.hears("Contact Support ☎️", async (ctx) => {
  try {
    await ctx.reply(`☎️ Need help? Message ${SUPPORT_CONTACT} and we'll get back to you.`);
  } catch (err) {
    console.error("[Contact Support] error:", err.message);
  }
});

bot.hears("Convert Bonus 💱", async (ctx) => {
  try {
    const user = await getOrCreateUser(ctx);
    if (!user) return;
    if (user.bonusBalance <= 0) {
      return ctx.reply("You don't have any bonus balance to convert yet.");
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

    await ctx.reply(`✅ Converted your bonus into ${converted} ETB. New balance: ${user.balance} ETB.`);
  } catch (err) {
    console.error("[Convert Bonus] error:", err.message);
  }
});

bot.on("text", async (ctx) => {
  try {
    const key = String(ctx.from.id);
    const step = pendingAction.get(key);
    if (!step) return; 

    const amount = Number(ctx.message.text.trim());
    if (!amount || amount <= 0) {
      return ctx.reply("Please send a valid positive number, or tap a menu button to cancel.");
    }

    const user = await getOrCreateUser(ctx);
    if (!user) return;

    if (step.type === "deposit") {
      if (amount < MIN_DEPOSIT) {
        return ctx.reply(`Minimum deposit is ${MIN_DEPOSIT} ETB. Please send a higher amount.`);
      }

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
        `📥 To deposit ${amount} ETB:\nSend it via Telebirr to ${DEPOSIT_PHONE}, then send us a screenshot here.\nReference: ${reference}\n\nYour balance updates once an admin confirms the transfer.`
      );
      notifyAdmin(
        `🆕 Deposit request\nUser: ${user.firstName || user.username} (${user.telegramId})\nAmount: ${amount} ETB\nReference: ${reference}`
      );
    }

    if (step.type === "withdraw") {
      if (amount < MIN_WITHDRAW) {
        return ctx.reply(`Minimum withdrawal is ${MIN_WITHDRAW} ETB.`);
      }
      if (amount > user.balance) {
        pendingAction.delete(key);
        return ctx.reply(`Insufficient balance. Your balance is ${user.balance} ETB.`);
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
        `📤 Withdrawal of ${amount} ETB requested. New balance: ${user.balance} ETB.\nIt will be paid out and marked complete by an admin shortly.`
      );
      notifyAdmin(
        `🆕 Withdrawal request\nUser: ${user.firstName || user.username} (${user.telegramId})\nAmount: ${amount} ETB`
      );
    }
  } catch (err) {
    console.error("[text handler] error:", err.message);
  }
});

function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID) return;
  bot.telegram.sendMessage(ADMIN_CHAT_ID, text).catch((err) => {
    console.error("[notifyAdmin] failed:", err.message);
  });
}

bot.catch((err, ctx) => {
  console.error(`[bot] unhandled error for update ${ctx?.updateType || 'unknown'}:`, err?.message || err);
});

function startKeepAliveServer() {
  const app = express();
  app.get("/", (req, res) => res.send("Fetan Bingo bot is running."));
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, () => console.log(`[bot] keep-alive server listening on port ${PORT}`));
}

async function main() {
  startKeepAliveServer();
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once("connected", resolve));
  }
  
  // 👈 የድሮውን ዌብሁክ እናጠፋለን፣ ይህም /start የማይሰራበትን ችግር ያስወግዳል
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log("[bot] Webhook cleared successfully.");
  } catch (err) {
    console.error("[bot] Failed to clear webhook:", err.message);
  }

  bot.launch().catch((err) => {
    console.error("[bot.launch] error encountered:", err.message);
  });

  if (WEBAPP_URL) {
    try {
      await bot.telegram.setChatMenuButton({
        type: "web_app",
        text: "Menu",
        web_app: { url: WEBAPP_URL },
      });
      console.log("[bot] Chat menu button set successfully.");
    } catch (err) {
      console.error("[bot] Failed to set chat menu button:", err.message);
    }
  }

  console.log("[bot] Fetan bingo bot is running");
}

main().catch((err) => {
  console.error("[bot] failed to start:", err);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));