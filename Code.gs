/**
 * Milestone 3: Interactive Inline Category Keyboards & Row Updates
 * Updates Column E (Category) via Telegram callback_query events.
 */

const SHEET_NAME = "Expenses";
const CATEGORIES = [
  ["🍔 Food", "Food"],
  ["🚕 Transport", "Transport"],
  ["🧾 Bills", "Bills"],
  ["🛍️ Shopping", "Shopping"],
  ["📦 Other", "Other"]
];

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

    const config = getConfig();

    if (update.callback_query) {
      handleCallbackQuery(update.callback_query, config);
    } else if (update.message) {
      handleMessage(update.message, config);
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return ContentService.createTextOutput("OK");
}

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

  if (text === "/start" || text === "/help") {
    const welcome =
      "💸 <b>Pocket Ledger Bot</b>\n\n" +
      "Send an expense starting with the amount:\n" +
      "• <code>12000 lunch with team</code>\n" +
      "• <code>4500 iced americano</code>";
    sendReply(chatId, welcome, config.BOT_TOKEN);
    return;
  }

  const parsed = parseExpenseInput(text);
  if (!parsed) {
    sendReply(
      chatId,
      "⚠️ Invalid format. Start with a number, e.g.:\n<code>12000 lunch with team</code>",
      config.BOT_TOKEN
    );
    return;
  }

  const entryId = Utilities.getUuid().slice(0, 8).toUpperCase();
  appendExpenseRow(config.SPREADSHEET_ID, {
    entryId: entryId,
    userId: userId,
    amount: parsed.amount,
    category: "Uncategorized",
    description: parsed.description,
    receiptUrl: "-"
  });

  const reply =
    `✅ <b>Expense Logged!</b>\n` +
    `💰 <b>Amount:</b> ${parsed.amount.toLocaleString("en-US")}\n` +
    `📝 <b>Note:</b> ${escapeHtml(parsed.description)}\n` +
    `🆔 <code>${entryId}</code>\n\n` +
    `👇 <b>Select a category:</b>`;

  sendReply(chatId, reply, config.BOT_TOKEN, buildCategoryKeyboard(entryId));
}

/**
 * Triggered when a user taps one of the inline category buttons.
 */
function handleCallbackQuery(callbackQuery, config) {
  const userId = String(callbackQuery.from.id);
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  // Payload format: "cat:<entryId>:<category>"
  const parts = (callbackQuery.data || "").split(":");
  if (parts.length !== 3 || parts[0] !== "cat") {
    answerCallbackQuery(callbackQuery.id, "Invalid action.", config.BOT_TOKEN);
    return;
  }

  const entryId = parts[1];
  const category = parts[2];
  const updated = updateRowCategory(config.SPREADSHEET_ID, entryId, userId, category);

  if (updated) {
    // 1. Stop the loading spinner on the Telegram button
    answerCallbackQuery(callbackQuery.id, `Saved as ${category}!`, config.BOT_TOKEN);

    // 2. Replace the prompt text & remove the buttons so it can't be clicked twice
    const baseText = callbackQuery.message.text
      .replace("👇 Select a category:", "")
      .trim();
    const updatedText = `${escapeHtml(baseText)}\n🏷️ <b>Category:</b> ${escapeHtml(category)}`;

    editMessageText(chatId, messageId, updatedText, config.BOT_TOKEN);
  } else {
    answerCallbackQuery(callbackQuery.id, "⚠️ Entry not found.", config.BOT_TOKEN);
  }
}

// ============================================================================
// GOOGLE SHEETS HELPERS
// ============================================================================

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

function updateRowCategory(spreadsheetId, entryId, userId, newCategory) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  // Search bottom-up since users categorize their most recent expense first
  for (let i = data.length - 1; i >= 1; i--) {
    const rowEntryId = String(data[i][0]);
    const rowUserId = String(data[i][1]);

    if (rowEntryId === entryId && rowUserId === userId) {
      sheet.getRange(i + 1, 5).setValue(newCategory); // Column E (5) = Category
      return true;
    }
  }
  return false;
}

// ============================================================================
// PARSING & TELEGRAM API HELPERS
// ============================================================================

function parseExpenseInput(rawText) {
  const match = rawText.match(/^([\d,]+(?:\.\d{1,2})?)\s*(.*)$/);
  if (!match) return null;

  const amount = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(amount) || amount <= 0) return null;

  const description = match[2].trim() || "General expense";
  return { amount, description };
}

function buildCategoryKeyboard(entryId) {
  const buttons = CATEGORIES.map(([label, value]) => ({
    text: label,
    callback_data: `cat:${entryId}:${value}`
  }));

  // Group buttons into rows of 3 max
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  return { inline_keyboard: rows };
}

function sendReply(chatId, htmlText, token, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML"
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

function editMessageText(chatId, messageId, htmlText, token) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: htmlText,
      parse_mode: "HTML"
    })
  });
}

function answerCallbackQuery(callbackQueryId, text, token) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text
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