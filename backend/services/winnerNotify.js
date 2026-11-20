// ═══════════════════════════════════════════════════════
// WINNER NOTIFY — ለ Play 50 / Play 100 አሸናፊዎች በBot (DM) መላክ
// ═══════════════════════════════════════════════════════
const User = require("../models/User");
const { buildWinnerPng } = require("../utils/winnerImage");

const PNG_TIMEOUT_MS = 10000; // 👈 PNG ከ 10 ሰከንድ በላይ ከወሰደ → text-only
const SEND_TIMEOUT_MS = 15000; // 👈 Telegram ምላሽ ገደብ

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Promise timeout helper */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * የአሸናፊዎችን ውጤት ለእያንዳንዱ ተጠቃሚ በቀጥታ (DM) ይልካል።
 * ምስል + የግል መልእክት ይይዛል።
 */
async function notifyWinners(round) {
  try {
    const { bot } = require("../bot");
    if (!bot) {
      console.warn("[notify] ❌ bot not loaded — skipped");
      return { ok: false, reason: "no_bot" };
    }

    // ─── 1. PNG (ለሁሉም አንድ ጊዜ ብቻ ይሰራል) ───
    let png = null;
    if (round.winningCartelas && round.winningCartelas.length > 0) {
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
            winners: round.winners,
            cartelas: round.winningCartelas, // የመጀመሪያው ካርቴላ በምስሉ ላይ ይታያል
          }),
          PNG_TIMEOUT_MS,
          "png_render"
        );
      } catch (imgErr) {
        console.error("[notify] ❌ image render failed:", imgErr.message);
      }
    }

    const fee = Number(round.entryFee);
    const gameName = fee === 50 ? "ባለ 50" : "ባለ 100";

    // ─── 2. ለእያንዳንዱ አሸናፊ በተናጠል መላክ ───
    for (const w of round.winners) {
      if (!w.telegramId) continue;

      // የግል መልእክት (Caption)
      const caption =
        `🎉 <b>እንኳን ደስ አለዎት!</b>\n\n` +
        `🏆 <b>የዛሬውን ${gameName} ብር የቢንጎ ጨዋታ አሸንፈዋል!</b>\n\n` +
        `🎯 ፓተርን: <b>${htmlEscape(String(round.winPattern).toUpperCase())}</b>\n` +
        `🎴 ካርቴላ: <b>#${w.cartelas.join(", #")}</b>\n` +
        `💰 ደራሽ: <b>+${w.prize} ETB</b>\n` +
        `💳 አዲስ ቀሪ ሂሳብ: <b>${w.newBalance} ETB</b>\n\n` +
        `🎮 ተጨማሪ ለመጫወት ዝግጁ ነዎት?`;

      let sent = false;

      // ሀ. ፎቶ ካለ በፎቶ ለመላክ ሞክር
      if (png) {
        try {
          await withTimeout(
            bot.telegram.sendPhoto(
              w.telegramId,
              { source: png, filename: "winner.png" },
              { caption, parse_mode: "HTML" }
            ),
            SEND_TIMEOUT_MS,
            "send_photo"
          );
          sent = true;
          console.log(`[notify] ✅ ለ ${w.telegramId} በፎቶ ተልኳል`);
        } catch (photoErr) {
          console.error(`[notify] ❌ ፎቶ መላክ አልተቻለም (${w.telegramId}): ${photoErr.message} — ወደ ጽሑፍ ይቀየራል`);
        }
      }

      // ለ. ፎቶ ካልተላከ (ወይም ፎቶ ከሌለ) በጽሑፍ ላክ
      if (!sent) {
        try {
          await withTimeout(
            bot.telegram.sendMessage(w.telegramId, caption, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
            SEND_TIMEOUT_MS,
            "send_message"
          );
          console.log(`[notify] ✅ ለ ${w.telegramId} በጽሑፍ ተልኳል`);
        } catch (msgErr) {
          console.error(`[notify] ❌ መልእክት መላክ አልተቻለም (${w.telegramId}): ${msgErr.message}`);
        }
      }
    }

    return { ok: true };
  } catch (err) {
    console.error(`[notify] ❌ failed:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { notifyWinners };