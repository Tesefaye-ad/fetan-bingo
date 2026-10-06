// ═══════════════════════════════════════════════════════
// SERVER CLOCK — ሁሉም ተጠቃሚ የሰርቨሩን ሰዓት እንዲጠቀም
// ═══════════════════════════════════════════════════════
// የሰዓት ቆጣሪው ከስልኩ ሰዓት ሳይሆን ከሰርቨር absolute ሰዓት (selectionEndsAt) ይሰላል.
// ስለዚህ ተጠቃሚው በ 50ኛ, በ 20ኛ ወይም በ 3ኛ ሰከንድ ቢገባ የሚያየው ቆጣሪ ለሁሉም ተመሳሳይ ነው.
let offsetMs = 0;
let bestRtt = Infinity;
let bestAt = 0;

/**
 * @param serverNowMs ሰርቨሩ ምላሽ ሲሰጥ የነበረው ሰዓት
 * @param sentAt     ጥያቄው የተላከበት የአካባቢ ሰዓት
 * @param receivedAt ምላሹ የደረሰበት የአካባቢ ሰዓት
 */
export function syncClock(serverNowMs, sentAt, receivedAt) {
  if (!Number.isFinite(serverNowMs)) return;
  const rtt = Math.max(0, receivedAt - sentAt);
  const stale = Date.now() - bestAt > 60000;
  // ከሁሉም ፈጣኑ (ትንሹ RTT) ናሙና ትክክለኛ ነው — ረጅም RTT ያለውን አትተካ
  if (rtt <= bestRtt * 1.5 || stale) {
    offsetMs = serverNowMs - (sentAt + receivedAt) / 2;
    bestRtt = Math.min(rtt, stale ? rtt : bestRtt);
    bestAt = Date.now();
  }
}

export function serverNow() {
  return Date.now() + offsetMs;
}

export function hasClockSync() {
  return bestRtt !== Infinity;
}

export function formatCountdown(totalSeconds, long) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (!long) return `${s}s`;
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}
