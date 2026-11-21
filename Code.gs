/**
 * Milestone 1: Multi-User Webhook Ping
 * Google Sheets acts as a private headless database; Telegram is the sole user UI.
 */

// 1. Reads secret keys from Google's secure Script Properties
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    BOT_TOKEN: props.getProperty("BOT_TOKEN"),
    SPREADSHEET_ID: props.getProperty("SPREADSHEET_ID"),
    DRIVE_FOLDER_ID: props.getProperty("DRIVE_FOLDER_ID"),
    WEB_APP_URL: props.getProperty("WEB_APP_URL")
  };
}

// 2. Runs automatically whenever any user messages the bot
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    if (!update.message) return ContentService.createTextOutput("OK");

    const config = getConfig();
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const firstName = escapeHtml(update.message.from.first_name || "there");
    const text = escapeHtml(update.message.text || "(non-text message)");

    const reply =
      `✅ <b>Webhook connected!</b>\n` +
      `👋 Hey ${firstName}, your isolated User ID is <code>${userId}</code>.\n` +
      `💬 You sent: <b>${text}</b>`;

    sendReply(chatId, reply, config.BOT_TOKEN);
  } catch (err) {
    console.error(err);
  }

  // Always return HTTP 200 OK so Telegram doesn't retry the request
  return ContentService.createTextOutput("OK");
}

// 3. Helper function to send an HTML-formatted message back to Telegram
function sendReply(chatId, htmlText, token) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: "HTML"
    })
  });
}

// Prevents user text containing < or > from breaking Telegram HTML formatting
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 4. One-time setup function to bind Telegram to your Web App URL
function registerWebhook() {
  const config = getConfig();
  const url = `https://api.telegram.org/bot${config.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(config.WEB_APP_URL)}`;
  console.log(UrlFetchApp.fetch(url).getContentText());
}