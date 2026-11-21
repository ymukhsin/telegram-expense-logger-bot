/**
 * Milestone 1: Minimal Webhook Ping & User ID Security Guard
 */

// 1. Reads your secret keys from Google's secure storage (never hardcoded in GitHub)
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    BOT_TOKEN: props.getProperty("BOT_TOKEN"),
    ALLOWED_USER_ID: props.getProperty("ALLOWED_USER_ID"),
    WEB_APP_URL: props.getProperty("WEB_APP_URL")
  };
}

// 2. Runs automatically whenever Telegram sends a message to our Web App URL
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    if (!update.message) return ContentService.createTextOutput("OK");

    const config = getConfig();
    const chatId = update.message.chat.id;
    const userId = String(update.message.from.id);

    // Security check: ignore anyone except your own Telegram account
    if (userId !== String(config.ALLOWED_USER_ID)) {
      sendReply(chatId, "⛔ Private bot.", config.BOT_TOKEN);
      return ContentService.createTextOutput("OK");
    }

    const text = update.message.text || "(non-text message)";
    sendReply(chatId, `✅ Webhook connected! You sent: <b>${text}</b>`, config.BOT_TOKEN);
  } catch (err) {
    console.error(err);
  }

  // Always return "OK" (HTTP 200) so Telegram doesn't keep retrying the message
  return ContentService.createTextOutput("OK");
}

// 3. Helper function to send a text reply back to Telegram
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

// 4. One-time setup function to tell Telegram where to send messages
function registerWebhook() {
  const config = getConfig();
  const url = `https://api.telegram.org/bot${config.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(config.WEB_APP_URL)}`;
  console.log(UrlFetchApp.fetch(url).getContentText());
}