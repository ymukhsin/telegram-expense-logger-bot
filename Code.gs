/**
 * Milestone 2: Text Expense Parsing & Google Sheets Logging
 * Includes update_id deduplication to prevent Telegram webhook retry loops.
 */

const SHEET_NAME = "Expenses";

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    BOT_TOKEN: props.getProperty("BOT_TOKEN"),
    SPREADSHEET_ID: props.getProperty("SPREADSHEET_ID"),
    DRIVE_FOLDER_ID: props.getProperty("DRIVE_FOLDER_ID"),
    WEB_APP_URL: props.getProperty("WEB_APP_URL")
  };
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput("OK");
    }

    const update = JSON.parse(e.postData.contents);

    // Deduplication guard: ignore duplicate retries of the same update_id
    if (!update.update_id || isDuplicateUpdate(update.update_id)) {
      return ContentService.createTextOutput("OK");
    }

    if (update.message) {
      handleMessage(update.message, getConfig());
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return ContentService.createTextOutput("OK");
}

// Remembers processed update IDs for 10 minutes (600 seconds)
function isDuplicateUpdate(updateId) {
  const cache = CacheService.getScriptCache();
  const key = "upd_" + updateId;
  if (cache.get(key)) return true;
  cache.put(key, "1", 600);
  return false;
}

function handleMessage(message, config) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const text = (message.text || "").trim();

  if (!text) return;

  // 1. Welcome / Help command
  if (text === "/start" || text === "/help") {
    const welcome =
      "💸 <b>Pocket Ledger Bot</b>\n\n" +
      "Send an expense starting with the amount:\n" +
      "• <code>12000 lunch with team</code>\n" +
      "• <code>4500 iced americano</code>";
    sendReply(chatId, welcome, config.BOT_TOKEN);
    return;
  }

  // 2. Parse amount & description
  const parsed = parseExpenseInput(text);
  if (!parsed) {
    sendReply(
      chatId,
      "⚠️ Invalid format. Start with a number, e.g.:\n<code>12000 lunch with team</code>",
      config.BOT_TOKEN
    );
    return;
  }

  // 3. Save row to Google Sheets
  const entryId = Utilities.getUuid().slice(0, 8).toUpperCase();
  appendExpenseRow(config.SPREADSHEET_ID, {
    entryId: entryId,
    userId: userId,
    amount: parsed.amount,
    category: "Uncategorized",
    description: parsed.description,
    receiptUrl: "-"
  });

  // 4. Confirm back to user
  const reply =
    `✅ <b>Expense Logged!</b>\n` +
    `💰 <b>Amount:</b> ${parsed.amount.toLocaleString("en-US")}\n` +
    `📝 <b>Note:</b> ${escapeHtml(parsed.description)}\n` +
    `🆔 <code>${entryId}</code>`;

  sendReply(chatId, reply, config.BOT_TOKEN);
}

/**
 * Extracts leading number and note.
 * Example: "12000 lunch with team" -> { amount: 12000, description: "lunch with team" }
 */
function parseExpenseInput(rawText) {
  const match = rawText.match(/^([\d,]+(?:\.\d{1,2})?)\s*(.*)$/);
  if (!match) return null;

  const amount = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(amount) || amount <= 0) return null;

  const description = match[2].trim() || "General expense";
  return { amount, description };
}

function appendExpenseRow(spreadsheetId, entry) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
  const tz = Session.getScriptTimeZone();
  const timestamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([
    entry.entryId,
    entry.userId,
    timestamp,
    entry.amount,
    entry.category,
    entry.description,
    entry.receiptUrl
  ]);
}

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function registerWebhook() {
  const config = getConfig();
  const url = `https://api.telegram.org/bot${config.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(config.WEB_APP_URL)}&drop_pending_updates=true`;
  console.log(UrlFetchApp.fetch(url).getContentText());
}