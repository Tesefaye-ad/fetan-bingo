// ═══════════════════════════════════════════════════════
// WINNER NOTIFY — ለ Play 50 / Play 100 አሸናፊዎችን ለ Telegram ግሩፕ መላክ
// ═══════════════════════════════════════════════════════
const User = require("../models/User");
const { buildWinnerPng } = require("../utils/winnerImage");
const { getWinningCells } = require("../utils/bingoCard");

const CAPTION_LIMIT = 1000; // Telegram photo caption ገደብ 1024

function htmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 0911223344 → 09****3344 (የተጫዋች ስልክ በግሩፕ ውስጥ ሙሉ አይታይም) */
function maskPhone(phone) {
  const p = String(phone || "").replace(/\s+/g, "");
  if (p.length < 7) return "—";
  return `${p.slice(0, 2)}****${p.slice(-4)}`;
}

function buildCaption({ roomCode, prizePool, winPattern, winners, phones }) {
  const date = new Date().toLocaleString("en-US", {
    timeZone: "Africa/Addis_Ababa",
  });
  let text =
    `🎉 <b>እንኳን ደስ አለዎት!</b>\n` +
    `🏆 <b>Fetan Bingo — ${htmlEscape(roomCode)}</b>\n` +
    `💰 ጠቅላላ ሽልማት: <b>${prizePool} ETB</b>\n` +
    `🎯 ፓተርን: <b>${htmlEscape(String(winPattern).toUpperCase())}</b>\n` +
    `🕐 ${htmlEscape(date)}\n`;
  for (const w of winners) {
    const line =
      `\n🏅 <b>${htmlEscape(w.name)}</b> — ` +
      `${w.cartelas.map((c) => `#${c}`).join(", ")} — <b>${w.prize} ETB</b>` +
      ` — 📱 <code>${maskPhone(phones[w.telegramId])}</code>`;
    if ((text + line).length > CAPTION_LIMIT) {
      text += `\n… +${winners.length - winners.indexOf(w)} ተጨማሪ`;
      break;
    }
    text += line;
  }
  return text;
}

/**
 * የአሸናፊዎች ፓናል ምስል + መግለጫ ወደ ግሩፕ ይልካል. ስህተት ቢኖር ጨዋታውን አያስተጓጉልም.
 */
async function notifyWinnersGroup(round) {
  const groupChatId = process.env.WINNERS_GROUP_CHAT_ID;
  if (!groupChatId) {
    console.warn("[notify] WINNERS_GROUP_CHAT_ID is not set — skipped");
    return;
  }
  try {
    const { bot } = require("../bot");
    if (!bot) return;

    const users = await User.find({
      telegramId: { $in: round.winners.map((w) => w.telegramId) },
    }).select("telegramId phone");
    const phones = Object.fromEntries(users.map((u) => [u.telegramId, u.phone]));

    const caption = buildCaption({ ...round, phones });

    let png = null;
    try {
      png = await buildWinnerPng({
        roomCode: round.roomCode,
        entryFee: round.entryFee,
        prizePool: round.prizePool,
        winPattern: round.winPattern,
        dateText: new Date().toLocaleString("en-US", {
          timeZone: "Africa/Addis_Ababa",
        }),
        winners: round.winners,
        cartelas: round.winningCartelas,
      });
    } catch (imgErr) {
      console.error("[notify] image render failed:", imgErr.message);
    }

    if (png) {
      await bot.telegram.sendPhoto(
        groupChatId,
        { source: png, filename: `${round.roomCode}-winners.png` },
        { caption, parse_mode: "HTML" }
      );
    } else {
      await bot.telegram.sendMessage(groupChatId, caption, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
    console.log(`[notify] ${round.roomCode} winners sent to group`);
  } catch (err) {
    console.error("[notify] failed:", err.message);
  }
}

module.exports = { notifyWinnersGroup, maskPhone, getWinningCells };
