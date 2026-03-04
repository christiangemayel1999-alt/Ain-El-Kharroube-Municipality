const fs = require("fs");
const path = require("path");

function escapeJsString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const apiBaseUrl = String(process.env.API_BASE_URL || "").trim();
const outputPath = path.join(__dirname, "..", "public", "app-config.js");

const content = apiBaseUrl
  ? `window.__APP_CONFIG__ = { apiBaseUrl: "${escapeJsString(apiBaseUrl)}" };`
  : "window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};";

fs.writeFileSync(outputPath, `${content}\n`, "utf8");
console.log(
  apiBaseUrl
    ? `[app-config] API_BASE_URL injected: ${apiBaseUrl}`
    : "[app-config] API_BASE_URL not set; frontend will use environment fallback."
);
