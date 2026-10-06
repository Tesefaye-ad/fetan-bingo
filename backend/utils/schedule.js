// ═══════════════════════════════════════════════════════
// SCHEDULE — ለ Play 50 / Play 100 የዕለት መጀመሪያ ሰዓት (ኢትዮጵያ ሰዓት, UTC+3)
// ═══════════════════════════════════════════════════════
// Play 50  → በየቀኑ 12:00:00
// Play 100 → በየቀኑ 12:05:00
//
// ማሳሰቢያ: "12:00" እዚህ እንደ ዓለም አቀፍ (24-ሰዓት) የኢትዮጵያ የሰዓት ሰቅ (EAT) ተወስዷል።
// በኢትዮጵያ ባህላዊ አቆጣጠር (ከ6 ሰዓት ልዩነት ጋር) ለመጠቀም WEEKLY_START_HOUR ን በ .env ቀይር
// (ለምሳሌ 6 = ቀን 12 ሰዓት በባህላዊ አቆጣጠር).
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const START_HOUR = Number(process.env.WEEKLY_START_HOUR ?? 12);
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
