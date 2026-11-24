# 💸 Pocket Ledger Bot — Serverless Telegram Expense & Receipt Logger - https://t.me/pocket_spendbot

A zero-cost, serverless Telegram bot built on **Google Apps Script** that turns everyday chat messages and receipt photos into structured financial records inside **Google Sheets** and **Google Drive**.

Designed with a **multi-tenant headless architecture**, Google Sheets remains strictly private behind the backend while each Telegram user interacts exclusively with their own isolated spending data.

---

## ✨ Key Features

- **Natural Text Expense Logging:** Send messages like `12000 lunch with team` to automatically parse amounts, generate an 8-character UUID `Entry ID`, and log timestamped entries.
- **One-Tap Inline Categorization:** Interactive Telegram inline keyboards (`🍔 Food`, `🚕 Transport`, `🧾 Bills`, `🛍️ Shopping`, `📦 Other`) update records via `callback_query` events with row-ownership verification.
- **Receipt Photo Archiving:** Send receipt photos (with or without captions) to automatically download the highest-resolution image, archive it inside a user-isolated Google Drive folder, and store the shareable link.
- **Isolated Monthly Analytics (`/summary`):** Aggregates monthly spending totals, transaction counts, and percentage breakdowns by category strictly filtered by the sender's Telegram `User ID`.
- **Webhook Idempotency Guard:** Uses Apps Script `CacheService` to deduplicate Telegram `update_id` retries and prevent duplicate ledger entries.

---

## 🏗️ System Architecture

```text
┌──────────────┐   HTTPS POST (Webhook)   ┌───────────────────────────┐
│   Telegram   │ ───────────────────────► │    Google Apps Script     │
│  User Client │ ◄─────────────────────── │      (doPost Router)      │
└──────────────┘   HTML Reply / Keyboards └─────────────┬─────────────┘
                                                        │
                              ┌─────────────────────────┴─────────────────────────┐
                              ▼                                                   ▼
               ┌─────────────────────────────┐                     ┌─────────────────────────────┐
               │        Google Sheets        │                     │        Google Drive         │
               │  (Private Headless Ledger)  │                     │  /Telegram_Receipts/<uid>/  │
               └─────────────────────────────┘                     └─────────────────────────────┘
