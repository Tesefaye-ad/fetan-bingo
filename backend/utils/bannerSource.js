const fs = require("fs");
const path = require("path");

const LOCAL_BANNER_PATH = path.join(__dirname, "..", "assets", "banner.png");

/**
 * Returns whatever Telegraf's replyWithPhoto expects for the /start banner:
 *  - If BOT_BANNER_URL is set, use that hosted URL (lets you swap in your
 *    own branded image without redeploying code).
 *  - Otherwise fall back to the bundled backend/assets/banner.png so the
 *    bot always has a photo to show, even with no env var configured.
 */
function getBannerSource() {
  const url = process.env.BOT_BANNER_URL;
  if (url) return url;

  if (fs.existsSync(LOCAL_BANNER_PATH)) {
    return { source: fs.createReadStream(LOCAL_BANNER_PATH) };
  }

  return null;
}

module.exports = { getBannerSource };
