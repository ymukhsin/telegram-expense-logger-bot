/**
 * Milestone 4: Receipt Photo Archiving (Google Drive) + Text Expenses + Categories
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

  // 1. Slash commands
  if (text === "/start" || text === "/help") {
    const welcome =
      "💸 <b>Pocket Ledger Bot</b>\n\n" +
      "• <b>Log text expense:</b> <code>12000 lunch with team</code>\n" +
      "• <b>Log receipt photo:</b> Send a photo with caption <code>45000 groceries</code>";
    sendReply(chatId, welcome, config.BOT_TOKEN);
    return;
  }

  // 2. Receipt photo (with or without caption)
  if (message.photo && message.photo.length > 0) {
    handlePhotoExpense(message, config);
    return;
  }

  // 3. Standard text expense
  if (text) {
    handleTextExpense(message, config);
  }
}

function handleTextExpense(message, config) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const parsed = parseExpenseInput(message.text.trim());

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
 * Downloads the highest-resolution receipt photo from Telegram, archives it
 * inside a user-specific Google Drive subfolder, and logs the shareable link.
 */
function handlePhotoExpense(message, config) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const caption = (message.caption || "").trim();
  const parsed = caption ? parseExpenseInput(caption) : null;

  const amount = parsed ? parsed.amount : 0;
  const description = parsed
    ? parsed.description
    : caption || "Receipt photo";

  // Telegram sorts photo sizes ascending; the last item is the highest resolution
  const largestPhoto = message.photo[message.photo.length - 1];
  const imageBlob = downloadTelegramFile(largestPhoto.file_id, config.BOT_TOKEN);
  const receiptUrl = saveReceiptToDrive(imageBlob, config.DRIVE_FOLDER_ID, userId);

  const entryId = Utilities.getUuid().slice(0, 8).toUpperCase();
  appendExpenseRow(config.SPREADSHEET_ID, {
    entryId: entryId,
    userId: userId,
    amount: amount,
    category: "Uncategorized",
    description: description,
    receiptUrl: receiptUrl
  });

  const reply =
    `🧾 <b>Receipt Archived!</b>\n` +
    `💰 <b>Amount:</b> ${amount.toLocaleString("en-US")}\n` +
    `📝 <b>Note:</b> ${escapeHtml(description)}\n` +
    `🔗 <a href="${receiptUrl}">View Receipt in Drive</a>\n` +
    `🆔 <code>${entryId}</code>\n\n` +
    `👇 <b>Select a category:</b>`;

  sendReply(chatId, reply, config.BOT_TOKEN, buildCategoryKeyboard(entryId));
}

function handleCallbackQuery(callbackQuery, config) {
  const userId = String(callbackQuery.from.id);
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  const parts = (callbackQuery.data || "").split(":");
  if (parts.length !== 3 || parts[0] !== "cat") {
    answerCallbackQuery(callbackQuery.id, "Invalid action.", config.BOT_TOKEN);
    return;
  }

  const entryId = parts[1];
  const category = parts[2];
  const updated = updateRowCategory(config.SPREADSHEET_ID, entryId, userId, category);

  if (updated) {
    answerCallbackQuery(callbackQuery.id, `Saved as ${category}!`, config.BOT_TOKEN);

    // Preserve clickable Drive link if this confirmation came from a receipt photo
    const linkEntity = (callbackQuery.message.entities || []).find(
      (ent) => ent.type === "text_link"
    );

    const baseText = callbackQuery.message.text
      .replace("👇 Select a category:", "")
      .trim();

    let updatedText = escapeHtml(baseText);
    if (linkEntity && linkEntity.url) {
      updatedText = updatedText.replace(
        "🔗 View Receipt in Drive",
        `🔗 <a href="${linkEntity.url}">View Receipt in Drive</a>`
      );
    }
    updatedText += `\n🏷️ <b>Category:</b> ${escapeHtml(category)}`;

    editMessageText(chatId, messageId, updatedText, config.BOT_TOKEN);
  } else {
    answerCallbackQuery(callbackQuery.id, "⚠️ Entry not found.", config.BOT_TOKEN);
  }
}

// ============================================================================
// GOOGLE SHEETS & GOOGLE DRIVE HELPERS
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

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === entryId && String(data[i][1]) === userId) {
      sheet.getRange(i + 1, 5).setValue(newCategory); // Column E = Category
      return true;
    }
  }
  return false;
}

function downloadTelegramFile(fileId, botToken) {
  const metaUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const metaRes = JSON.parse(UrlFetchApp.fetch(metaUrl).getContentText());

  if (!metaRes.ok) {
    throw new Error("Failed to fetch file path from Telegram");
  }

  const filePath = metaRes.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const blob = UrlFetchApp.fetch(downloadUrl).getBlob();

  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, "yyyyMMdd_HHmmss");
  blob.setName(`receipt_${stamp}.jpg`);
  return blob;
}

function saveReceiptToDrive(blob, rootFolderId, userId) {
  const userFolder = getOrCreateUserFolder(rootFolderId, userId);
  const file = userFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getOrCreateUserFolder(rootFolderId, userId) {
  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const existing = rootFolder.getFoldersByName(String(userId));
  if (existing.hasNext()) {
    return existing.next();
  }
  return rootFolder.createFolder(String(userId));
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
    parse_mode: "HTML",
    disable_web_page_preview: true
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
      parse_mode: "HTML",
      disable_web_page_preview: true
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

// ============================================================================
// DEPLOYMENT & SETUP UTILITIES
// ============================================================================

/**
 * Run once during setup to authorize Google Sheets & Google Drive scopes.
 */
function authorizeServices() {
  const config = getConfig();
  const sheet = SpreadsheetApp.openById(config.SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const folder = DriveApp.getFolderById(config.DRIVE_FOLDER_ID);
  console.log(`Authorized! Sheet: ${sheet.getName()}, Folder: ${folder.getName()}`);
}

function registerWebhook() {
  const config = getConfig();
  const url = `https://api.telegram.org/bot${config.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(config.WEB_APP_URL)}&drop_pending_updates=true`;
  console.log(UrlFetchApp.fetch(url).getContentText());
}