require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Telegraf, Markup } = require("telegraf");

const connectDB = require("./config/db");
const User = require("./models/User");
const Transaction = require("./models/Transaction");

const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const gameRoutes = require("./routes/game");
const { initGameSocket } = require("./socket/gameSocket");

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((o) => o.trim())
  : "*";

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ name: "Fetan Bingo API", status: "running" });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/game", gameRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
});

initGameSocket(io);

// ==========================================
// TELEGRAM BOT CONFIGURATION (FULL FEATURES)
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.BOT_WEBAPP_URL || (process.env.CLIENT_URL ? process.env.CLIENT_URL.split(",")[0] : "");
const BANNER_URL = process.env.BOT_BANNER_URL; // የባነር ፎቶ ሊንክ (Image 2 ላይ ያለው)
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "@FetanBingoSupport";
const DEPOSIT_PHONE = process.env.DEPOSIT_TELEBIRR_PHONE || "0920790583";
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 20);
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const BONUS_CONVERSION_RATE = Number(process.env.BONUS_CONVERSION_RATE || 1);

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
  const tgUser = ctx.from;
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
          .sendMessage(inviter.telegramId, `🎉 Someone joined using your invite link! You earned 5 ETB bonus.`)
          .catch(() => {});
      }
    }
  }
  return user;
}

if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    try {
      const payload = ctx.startPayload || "";
      const referredBy = payload.startsWith("ref_") ? payload.slice(4) : null;

      await getOrCreateUser(ctx, referredBy);

      if (BANNER_URL) {
        await ctx.replyWithPhoto(BANNER_URL, {
          caption: MAIN_MENU_TEXT,
          ...mainKeyboard(),
        });
      } else {
        await ctx.reply(MAIN_MENU_TEXT, mainKeyboard());
      }
    } catch (err) {
      console.error("[/start] error:", err);
      ctx.reply("Something went wrong. Please try /start again.");
    }
  });

  bot.action("play_not_configured", (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("The game link isn't configured yet. Set BOT_WEBAPP_URL or CLIENT_URL in environment variables.");
  });

  bot.hears("Register 📝", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    ctx.reply(`✅ You're registered, ${user.firstName || "player"}!\nTelegram ID: ${user.telegramId}\n\nTap "Play 🎮" any time to jump into a game.`);
  });

  bot.hears("Check Balance 💰", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    ctx.reply(`💰 Main balance: ${user.balance} ETB\n🎁 Bonus balance: ${user.bonusBalance} ETB (use "Convert Bonus" to move it to your main balance)`);
  });

  bot.hears("Deposit 💵", async (ctx) => {
    await getOrCreateUser(ctx);
    pendingAction.set(String(ctx.from.id), { type: "deposit" });
    ctx.reply(`How much would you like to deposit? (minimum ${MIN_DEPOSIT} ETB)\nJust type a number, e.g. 100`);
  });

  bot.hears("Withdraw 🤑", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    if (user.balance < MIN_WITHDRAW) {
      return ctx.reply(`Your balance (${user.balance} ETB) is below the minimum withdrawal of ${MIN_WITHDRAW} ETB.`);
    }
    pendingAction.set(String(ctx.from.id), { type: "withdraw" });
    ctx.reply(`How much would you like to withdraw? (minimum ${MIN_WITHDRAW} ETB, balance: ${user.balance} ETB)\nJust type a number, e.g. 100`);
  });

  bot.hears("Invite 🔗", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    const me = await ctx.telegram.getMe();
    const link = `https://t.me/${me.username}?start=ref_${user.telegramId}`;
    ctx.reply(`🔗 Share your invite link - you earn 5 ETB bonus for every friend who joins:\n\n${link}\n\nFriends invited so far: ${user.referralCount}`);
  });

  bot.hears("Instruction 📖", (ctx) => {
    ctx.reply(
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
        "5. ረድፍ፣ አምድ፣ ዲያጎናል ወይም ሙሉ ካርድ ሲያጠናቅቁ BINGO! የሚለውን ይንኩ።"
    );
  });

  bot.hears("Contact Support ☎️", (ctx) => {
    ctx.reply(`☎️ Need help? Message ${SUPPORT_CONTACT} and we'll get back to you.`);
  });

  bot.hears("Convert Bonus 💱", async (ctx) => {
    const user = await getOrCreateUser(ctx);
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

    ctx.reply(`✅ Converted your bonus into ${converted} ETB. New balance: ${user.balance} ETB.`);
  });

  bot.on("text", async (ctx) => {
    const key = String(ctx.from.id);
    const step = pendingAction.get(key);
    if (!step) return;

    const amount = Number(ctx.message.text.trim());
    if (!amount || amount <= 0) {
      return ctx.reply("Please send a valid positive number, or tap a menu button to cancel.");
    }

    const user = await getOrCreateUser(ctx);

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
      ctx.reply(`📥 To deposit ${amount} ETB:\nSend it via Telebirr to ${DEPOSIT_PHONE}, then send us a screenshot here.\nReference: ${reference}\n\nYour balance updates once an admin confirms the transfer.`);
      if (ADMIN_CHAT_ID) {
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `🆕 Deposit request\nUser: ${user.firstName || user.username} (${user.telegramId})\nAmount: ${amount} ETB\nReference: ${reference}`).catch(() => {});
      }
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
      ctx.reply(`📤 Withdrawal of ${amount} ETB requested. New balance: ${user.balance} ETB.\nIt will be paid out and marked complete by an admin shortly.`);
      if (ADMIN_CHAT_ID) {
        bot.telegram.sendMessage(ADMIN_CHAT_ID, `🆕 Withdrawal request\nUser: ${user.firstName || user.username} (${user.telegramId})\nAmount: ${amount} ETB`).catch(() => {});
      }
    }
  });

  bot.launch()
    .then(() => console.log("🤖 Telegram bot started successfully with full features!"))
    .catch((err) => console.error("❌ Telegram bot launch error:", err));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.log("⚠️ BOT_TOKEN not found in environment variables.");
}

const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] Fetan Bingo backend running on port ${PORT}`);
});

connectDB();

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});