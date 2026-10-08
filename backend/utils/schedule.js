// ═══════════════════════════════════════════════════════
// SCHEDULE — ለ Play 50 / Play 100 የዕለት መጀመሪያ ሰዓት (ኢትዮጵያ ሰዓት, UTC+3)
// ═══════════════════════════════════════════════════════
// Play 50  → በየቀኑ 7:00 ማታ (19:00)
// Play 100 → በየቀኑ 7:05 ማታ (19:05)
//
// ማሳሰቢያ: "19:00" እዚህ እንደ ዓለም አቀፍ (24-ሰዓት) የኢትዮጵያ የሰዓት ሰቅ (EAT) ተወስዷል።
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════
// 👈 በኮድ ተቀምጧል — Render Dashboard አያስፈልግም
// ═══════════════════════════════════════════════════════
// 19 = 7:00 ማታ
// 7  = 7:00 ጠዋት
// 18 = 6:00 ማታ
// 20 = 8:00 ማታ
const START_HOUR = 19;

const START_MINUTE_BY_FEE = { 50: 0, 100: 5 };

function startMinuteFor(fee) {
  return START_MINUTE_BY_FEE[fee] ?? 0;
}

/**
 * ቀጣዩ የመጀመሪያ ሰዓት (UTC Date). `from` ራሱ ልክ የመጀመሪያው ሰዓት ከሆነ → ነገ.
 */
function getNextDailyStart(fee, from = new Date()) {
  const eat = from.getTime() + EAT_OFFSET_MS;
  const eatMidnight = Math.floor(eat / DAY_MS) * DAY_MS;
  let target =
    eatMidnight + START_HOUR * 3600 * 1000 + startMinuteFor(fee) * 60 * 1000;
  if (target <= eat) target += DAY_MS;
  return new Date(target - EAT_OFFSET_MS);
}

function isWeeklyRoom(roomCode) {
  return roomCode === "ROOM50" || roomCode === "ROOM100";
}

function getWeeklyFee(roomCode) {
  return roomCode === "ROOM50" ? 50 : 100;
}

module.exports = {
  getNextDailyStart,
  isWeeklyRoom,
  getWeeklyFee,
  EAT_OFFSET_MS,
};