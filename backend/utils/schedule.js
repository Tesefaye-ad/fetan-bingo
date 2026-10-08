// ═══════════════════════════════════════════════════════
// SCHEDULE — ለ Play 50 / Play 100 የዕለት መጀመሪያ ሰዓት (ኢትዮጵያ ሰዓት, UTC+3)
// ═══════════════════════════════════════════════════════
// Play 50  → ኢትዮጵያ ሰዓት 1:00 ማታ (= ፈረንጆች 7:00 PM / 19:00)
// Play 100 → ኢትዮጵያ ሰዓት 1:05 ማታ (= ፈረንጆች 7:05 PM / 19:05)
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════
// 👈 በኮድ ተቀምጧል — Render Dashboard አያስፈልግም
// ═══════════════════════════════════════════════════════
// 19 = ኢትዮጵያ ሰዓት 1:00 ማታ (= ፈረንጆች 7:00 PM) ✅
// 7  = ኢትዮጵያ ሰዓት 1:00 ቀን (= ፈረንጆች 7:00 AM)
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