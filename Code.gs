/**
 * Pocket Ledger Bot (v1.0)
 * Zero-cost, serverless Telegram Expense & Receipt Logger built on Google Apps Script.
 * Architecture: Multi-user isolation with Google Sheets as a private headless DB
 * and Google Drive for per-user receipt photo archiving.
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

    // Idempotency guard: ignore duplicate webhook retries of the same update_id
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
  const text = (message.text || "").trim();

  // 1. Help / Start command
  if (text === "/start" || text === "/help") {
    const welcome =
      "💸 <b>Pocket Ledger Bot</b>\n\n" +
      "• <b>Log text expense:</b> <code>12000 lunch with team</code>\n" +
      "• <b>Log receipt photo:</b> Send a photo with caption <code>45000 groceries</code>\n" +
      "• <b>Monthly report:</b> <code>/summary</code> or <code>/summary 2026-11</code>";
    sendReply(chatId, welcome, config.BOT_TOKEN);
    return;
  }

  // 2. Monthly summary command
  if (text.startsWith("/summary")) {
    handleSummaryCommand(message, config);
    return;
  }

  // 3. Receipt photo (with or without caption)
  if (message.photo && message.photo.length > 0) {
    handlePhotoExpense(message, config);
    return;
  }

  // 4. Standard text expense
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

function handlePhotoExpense(message, config) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const caption = (message.caption || "").trim();
  const parsed = caption ? parseExpenseInput(caption) : null;

  const amount = parsed ? parsed.amount : 0;
  const description = parsed
    ? parsed.description
    : caption || "Receipt photo";

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

/**
 * Aggregates and formats monthly expenses strictly for the requesting User ID.
 * Usage: "/summary" (current month) or "/summary YYYY-MM"
 */
function handleSummaryCommand(message, config) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  const tz = Session.getScriptTimeZone();

  const arg = (message.text || "").replace("/summary", "").trim();
  const targetMonth = /^\d{4}-\d{2}$/.test(arg)
    ? arg
    : Utilities.formatDate(new Date(), tz, "yyyy-MM");

  const summary = buildUserMonthlySummary(config.SPREADSHEET_ID, userId, targetMonth, tz);

  if (summary.count === 0) {
    sendReply(
      chatId,
      `📊 <b>Monthly Summary (${targetMonth})</b>\n\nNo expenses recorded for this month yet.`,
      config.BOT_TOKEN
    );
    return;
  }

  // Sort categories from highest spend to lowest
  const sortedCategories = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);

  const breakdownLines = sortedCategories.map(([cat, amt]) => {
    const pct = summary.total > 0 ? Math.round((amt / summary.total) * 100) : 0;
    return `• <b>${escapeHtml(cat)}:</b> ${amt.toLocaleString("en-US")} (${pct}%)`;
  });

  const reply =
    `📊 <b>Monthly Summary (${targetMonth})</b>\n\n` +
    `💰 <b>Total Spent:</b> ${summary.total.toLocaleString("en-US")}\n` +
    `🧾 <b>Transactions:</b> ${summary.count}\n\n` +
    `📂 <b>By Category:</b>\n` +
    breakdownLines.join("\n");

  sendReply(chatId, reply, config.BOT_TOKEN);
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
      sheet.getRange(i + 1, 5).setValue(newCategory);
      return true;
    }
  }
  return false;
}

function buildUserMonthlySummary(spreadsheetId, userId, targetMonth, tz) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  let total = 0;
  let count = 0;
  const byCategory = {};

  for (let i = 1; i < data.length; i++) {
    const rowUserId = String(data[i][1]);
    if (rowUserId !== userId) continue;

    const rawDate = data[i][2];
    const rowMonth = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, tz, "yyyy-MM")
      : String(rawDate).slice(0, 7);

    if (rowMonth !== targetMonth) continue;

    const amount = Number(data[i][3]) || 0;
    const category = String(data[i][4] || "Uncategorized");

    total += amount;
    count += 1;
    byCategory[category] = (byCategory[category] || 0) + amount;
  }

  return { total, count, byCategory };
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
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn("Link sharing restricted by domain policy:", e);
  }
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