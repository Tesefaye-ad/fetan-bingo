// ═══════════════════════════════════════════════════════
// WINNER NOTIFY — ለ Play 50 / Play 100 አሸናፊዎችን ለ Telegram ግሩፕ መላክ
// ═══════════════════════════════════════════════════════
const User = require("../models/User");
const { buildWinnerPng } = require("../utils/winnerImage");

const CAPTION_LIMIT = 900; // 👈 1000 → 900 (safety margin)
const PNG_TIMEOUT_MS = 8000; // 👈 PNG ከ 8 ሰከንድ በላይ ከወሰደ → text-only
const MAX_IMAGE_WINNERS = 3; // 👈 ምስል ላይ ብዙ አሸናፊ አይሳል
const SEND_TIMEOUT_MS = 15000; // 👈 Telegram ምላሽ ገደብ

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 0911223344 → 09****3344 */
function maskPhone(phone) {
  const p = String(phone || "").replace(/\s+/g, "");
  if (p.length < 7) return "—";
  return `${p.slice(0, 2)}****${p.slice(-4)}`;
}

/** 👈 Promise timeout helper */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}_timeout`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer)
  );
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

  // 👈 ብዙ አሸናፊ ካለ → የመጀመሪያዎቹን ብቻ አሳይ
  const maxLines = 8; // 👈 ለ caption ገደብ
  const shown = Math.min(winners.length, maxLines);

  for (let i = 0; i < shown; i++) {
    const w = winners[i];
    const cartelas = w.cartelas.map((c) => `#${c}`).join(", ");
    const line =
      `\n🏅 <b>${htmlEscape(w.name)}</b> — ${cartelas} — ` +
      `<b>${w.prize} ETB</b> — 📱 <code>${maskPhone(
        phones[w.telegramId]
      )}</code>`;

    if ((text + line).length > CAPTION_LIMIT) break;
    text += line;
  }

  if (winners.length > shown) {
    text += `\n… +${winners.length - shown} ተጨማሪ አሸናፊዎች`;
  }
  return text;
}

/**
 * 👈 የአሸናፊዎች ፓናል ምስል + መግለጫ ወደ ግሩፕ ይልካል.
 *    ጨዋታውን ፈጽሞ አያስተጓጉልም — ስህተት ቢኖር ይዘነጋል.
 */
async function notifyWinnersGroup(round) {
  const groupChatId = process.env.WINNERS_GROUP_CHAT_ID;
  if (!groupChatId) {
    console.warn("[notify] WINNERS_GROUP_CHAT_ID is not set — skipped");
    return { ok: false, reason: "no_group_id" };
  }

  // 👈 ጨዋታው ላይ እንዳይጋባ — fire-and-forget አድርገን እንጠራለን
  try {
    const { bot } = require("../bot");
    if (!bot) {
      console.warn("[notify] bot not loaded — skipped");
      return { ok: false, reason: "no_bot" };
    }

    // ─── 1. Phone lookup (አንድ ጥያቄ ብቻ) ───
    const telegramIds = round.winners
      .map((w) => w.telegramId)
      .filter(Boolean);

    let phones = {};
    if (telegramIds.length > 0) {
      try {
        const users = await withTimeout(
          User.find({ telegramId: { $in: telegramIds } })
            .select("telegramId phone")
            .lean(),
          5000,
          "user_lookup"
        );
        phones = Object.fromEntries(users.map((u) => [u.telegramId, u.phone]));
      } catch (err) {
        console.warn("[notify] user lookup failed:", err.message);
      }
    }

    // ─── 2. Caption (ፈጣን) ───
    const caption = buildCaption({ ...round, phones });

    // ─── 3. PNG (timeout ጋር — ቢዘገይ text-only) ───
    let png = null;
    const imageCartelas = round.winningCartelas.slice(0, MAX_IMAGE_WINNERS);
    if (imageCartelas.length > 0) {
      try {
        png = await withTimeout(
          buildWinnerPng({
            roomCode: round.roomCode,
            entryFee: round.entryFee,
            prizePool: round.prizePool,
            winPattern: round.winPattern,
            dateText: new Date().toLocaleString("en-US", {
              timeZone: "Africa/Addis_Ababa",
            }),
            winners: round.winners.slice(0, MAX_IMAGE_WINNERS),
            cartelas: imageCartelas,
          }),
          PNG_TIMEOUT_MS,
          "png_render"
        );
      } catch (imgErr) {
        console.error("[notify] image render failed:", imgErr.message);
      }
    }

    // ─── 4. Send (timeout ጋር) ───
    if (png) {
      await withTimeout(
        bot.telegram.sendPhoto(
          groupChatId,
          { source: png, filename: `${round.roomCode}-winners.png` },
          { caption, parse_mode: "HTML" }
        ),
        SEND_TIMEOUT_MS,
        "send_photo"
      );
    } else {
      await withTimeout(
        bot.telegram.sendMessage(groupChatId, caption, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        SEND_TIMEOUT_MS,
        "send_message"
      );
    }

    console.log(`[notify] ${round.roomCode} winners sent to group`);
    return { ok: true };
  } catch (err) {
    console.error("[notify] failed:", err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { notifyWinnersGroup, maskPhone };