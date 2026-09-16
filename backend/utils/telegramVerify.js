const crypto = require("crypto");

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  try {
    if (!initData || !botToken) {
      return { valid: false, data: null, reason: "missing initData or botToken" };
    }

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return { valid: false, data: null, reason: "missing hash" };
    urlParams.delete("hash");

    const dataCheckArr = [];
    for (const [key, value] of [...urlParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dataCheckArr.push(`${key}=${value}`);
    }
    const dataCheckString = dataCheckArr.join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const valid =
      computedHash.length === hash.length &&
      crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));

    if (!valid) return { valid: false, data: null, reason: "hash mismatch" };

    const authDate = Number(urlParams.get("auth_date") || 0);
    if (authDate && Date.now() / 1000 - authDate > maxAgeSeconds) {
      return { valid: false, data: null, reason: "initData expired" };
    }

    const userRaw = urlParams.get("user");
    const data = {
      user: userRaw ? JSON.parse(userRaw) : null,
      auth_date: authDate,
    };

    return { valid: true, data };
  } catch (err) {
    return { valid: false, data: null, reason: err.message };
  }
}

module.exports = { verifyTelegramInitData };