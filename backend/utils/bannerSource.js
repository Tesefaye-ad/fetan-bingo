const fs = require("fs");
const path = require("path");

const LOCAL_BANNER_PATH = path.join(__dirname, "..", "assets", "banner.png");

function getBannerSource() {
  const url = process.env.BOT_BANNER_URL;
  if (url) return url;
  if (fs.existsSync(LOCAL_BANNER_PATH)) {
    return { source: fs.createReadStream(LOCAL_BANNER_PATH) };
  }
  return null;
}

module.exports = { getBannerSource };