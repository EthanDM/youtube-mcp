import "dotenv/config";

import { getYoutubeConfig } from "./config.js";
import { checkYtDlp } from "./lib/transcript.js";

const config = getYoutubeConfig();
const version = await checkYtDlp(config.ytDlpPath);
console.log(
  `yt-dlp is available: ${config.ytDlpPath || "yt-dlp"} (${version})`,
);
