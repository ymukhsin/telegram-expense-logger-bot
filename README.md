# 💸 Pocket Ledger Bot — Serverless Telegram Expense & Receipt Logger

[![Telegram](https://img.shields.io/badge/Telegram-@pocket__spendbot-26A5E4?logo=telegram&logoColor=white)](https://t.me/pocket_spendbot)

A zero-cost, serverless Telegram bot built on **Google Apps Script** that turns everyday chat messages and receipt photos into structured financial records inside **Google Sheets** and **Google Drive**.

Designed with a **multi-tenant headless architecture**, Google Sheets remains strictly private behind the backend while each Telegram user interacts exclusively with their own isolated spending data.

---

## ✨ Key Features

- **Natural Text Expense Logging:** Send messages like `12000 lunch with team` to automatically parse amounts, generate an 8-character UUID `Entry ID`, and log timestamped entries.
- **One-Tap Inline Categorization:** Interactive Telegram inline keyboards (`🍔 Food`, `🚕 Transport`, `🧾 Bills`, `🛍️ Shopping`, `📦 Other`) update records via `callback_query` events with row-ownership verification.
- **Receipt Photo Archiving:** Send receipt photos (with or without captions) to automatically download the highest-resolution image, archive it inside a user-isolated Google Drive folder, and store the shareable link.
- **Isolated Monthly Analytics (`/summary`):** Aggregates monthly spending totals, transaction counts, and percentage breakdowns by category strictly filtered by the sender's Telegram `User ID`.
- **Adaptive Itemized Reports (`/report`):** Returns an itemized list in chat and automatically switches to an itemized **PDF statement** once a period exceeds 15 entries — or on demand with `/report pdf`.
- **Webhook Idempotency Guard:** Uses Apps Script `CacheService` to deduplicate Telegram `update_id` retries and prevent duplicate ledger entries.

---

## 🕹️ Commands

| Command | What it does |
| --- | --- |
| `/start` | Personalized onboarding + quick examples |
| `/help` | Command and input-format reference |
| `/summary` · `/summary YYYY-MM` | Category totals + percentage breakdown for the month |
| `/report` · `/report YYYY-MM` | Itemized list; auto-PDF when the period has >15 entries |
| `/report pdf` | Force the itemized PDF statement |
| `/report all` | Full history as a PDF statement |

Any plain text starting with a number is logged as an expense; any photo is archived as a receipt (caption optional, and it is parsed as a note/amount when present).

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
```

Telegram retries webhooks and GAS answers redirects slowly, so `worker.js` sits in front of the deployment as a **Cloudflare Worker edge relay**: it ACKs Telegram immediately and forwards the update to GAS out of band.

```text
┌──────────────────────────┐   202 OK (instant)   ┌───────────┐
│ Cloudflare Worker relay  │ ───────────────────► │ Telegram  │
│      (worker.js)         │                      └───────────┘
└────────────┬─────────────┘
             │ waitUntil(fetch) → redirect: follow
             ▼
   Google Apps Script doPost
```

---

## 📁 Project Structure

```text
.
├── Code.gs      # Telegram router, Sheets CRUD, Drive archiving, /summary + /report & PDF builder
├── gemini.gs    # Gemini Flash structured-output extraction (v1.1 scaffold, not wired into the router yet)
├── worker.js    # Cloudflare Worker edge relay (bypasses GAS 302 webhook timeouts)
├── .gitignore   # Keeps local Apps Script config / credentials out of the repo
└── README.md    # Architecture documentation and self-hosting guide
```

---

## 🗺️ Roadmap

- [x] **v1.0:** Multi-user webhook architecture, Cloudflare edge relay, text expense parser, inline category keyboards, Drive receipt archiving, and `/summary` monthly reports.
- [x] **v1.0.1:** Adaptive `/report` command — itemized chat list with automatic PDF statement export and `all`-time history mode.
- [x] **v1.0.2:** Streamlined `/start` welcome and `/help` command guide.
- [ ] **v1.1 (In Progress):** Wire `gemini.gs` into the router for Gemini Flash natural-language expense extraction and zero-caption receipt OCR. The module already defines the structured-output schema; it needs the router hook and a caption-less photo path.
- [ ] **v2.0 (Planned):** Interactive Telegram Mini App spending dashboard.
