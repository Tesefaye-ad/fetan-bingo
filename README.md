# Fetan Bingo

Real-time multiplayer 75-ball Bingo as a Telegram Web App.
Backend: Node.js + Express + Socket.io + MongoDB (Mongoose).
Frontend: React (Create React App) + socket.io-client.

## ⚠️ Rotate your bot token first

Your uploaded project had a **real Telegram bot token committed in `backend/.env`**
(and in the repo's `.git` history). Treat that token as compromised:

1. Open @BotFather → your bot → **API Token** 
2. Put the new token only in Render's environment variables (Dashboard →
   your service → Environment) — never in a file you commit to Git.
3. If you already pushed this repo anywhere public, the old token is
   permanently in the Git history, so revoking it is the only real fix.

None of the example files in this project contain real secrets.

## Project layout

```
fetan-bingo/
  backend/
    Server.js              # entry point
    config/db.js            # Mongoose connection (non-blocking on boot)
    models/                 # User, Game, Transaction
    middleware/auth.js       # JWT auth for REST + Socket.io
    utils/telegramVerify.js  # validates Telegram WebApp initData
    utils/bingoCard.js       # card generation + win checking
    routes/auth.js           # POST /api/auth/telegram
    routes/wallet.js         # balance / history / deposit / withdraw
    routes/game.js           # list/create rooms
    socket/gameSocket.js     # real-time game loop (join, mark, claim, auto-caller)
  frontend/
    public/index.html
    src/
      App.jsx, Gamelobby.jsx, Bingocard.jsx, Livegame.jsx
      Login.jsx, Wallet.jsx
      api.js, socket.js, useTelegram.js
```

## 1. Backend setup

```bash
cd backend
cp .env.example .env   # fill in real values, see below
npm install
npm run dev             # nodemon, local development
```

Required environment variables (see `backend/.env.example`):

| Variable | Description |
|---|---|
| `PORT` | Render sets this automatically; `.env.example` uses 10000 for local dev |
| `CLIENT_URL` | Comma-separated list of allowed frontend origins (CORS) |
| `MONGO_URI` | MongoDB Atlas connection string |
| `TELEGRAM_BOT_TOKEN` | From @BotFather (see rotation note above) |
| `JWT_SECRET` | Long random string — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `BINGO_MAX_NUMBER` | 75 for standard 75-ball bingo |
| `CALL_INTERVAL_MS` | Time between auto-called numbers |
| `ENTRY_FEE` | Default entry fee (ETB) for rooms created without specifying one |

### Deploying the backend to Render

1. Push `backend/` to a GitHub repo (or the whole monorepo — just set the
   **Root Directory** to `backend` in Render).
2. Render → New → Web Service → connect the repo.
   - **Build command:** `npm install`
   - **Start command:** `npm start` (runs `node Server.js`)
3. Add the environment variables above under Environment.
4. Render assigns `PORT` itself — the code already reads
   `process.env.PORT` and calls `server.listen(PORT, "0.0.0.0")`
   **before** connecting to MongoDB, so Render detects the open port
   immediately and won't time out the deploy while Mongo connects.
5. Set up a free MongoDB Atlas cluster, whitelist `0.0.0.0/0` (or
   Render's IPs) under Network Access, and paste the connection string
   into `MONGO_URI`.

## 2. Frontend setup

```bash
cd frontend
cp .env.example .env    # set REACT_APP_API_URL to your Render backend URL
npm install
npm start                # local dev server
npm run build             # production build → frontend/build/
```

### Deploying the frontend

Any static host works (Render Static Site, Netlify, Vercel, Cloudflare
Pages):

1. **Build command:** `npm install && npm run build`
2. **Publish directory:** `build`
3. Set `REACT_APP_API_URL` to your deployed backend's URL (no trailing
   slash) as a build-time environment variable — CRA bakes
   `REACT_APP_*` vars into the build, so set it *before* building.
4. Once deployed, set that same URL as your bot's **Web App URL**
   in @BotFather (`/mybots` → your bot → Bot Settings → Menu Button, or
   `/setmenubutton`), or wire it to an inline "Play" button via your
   bot's message handler.

## 3. The Telegram bot (`backend/bot.js`)

`bot.js` reproduces the "Fetan Lottery" `/start` menu: a welcome banner
and a persistent keyboard with **Play, Register, Check Balance, Deposit,
Withdraw, Invite, Instruction, Contact Support, Convert Bonus**. It runs
as its **own process**, separate from `Server.js`, but imports the same
`models/` so a balance shown in the bot is always the same number as in
the Web App.

| Button | What it does |
|---|---|
| **Play 🎮** | Opens `BOT_WEBAPP_URL` as a native Telegram Web App button |
| **Register 📝** | Creates the user record if it doesn't exist yet (also happens automatically on `/start`) |
| **Check Balance 💰** | Shows main balance + bonus balance |
| **Deposit 💵** | Asks for an amount, gives Telebirr transfer instructions, logs a `pending` transaction, and pings `ADMIN_CHAT_ID` |
| **Withdraw 🤑** | Asks for an amount, deducts it immediately, logs a `pending` withdrawal for an admin to pay out and mark complete |
| **Invite 🔗** | Generates a `t.me/<bot>?start=ref_<telegramId>` referral link; inviter gets a 5 ETB bonus per signup |
| **Instruction 📖** | Static how-to-play text (English + Amharic) |
| **Contact Support ☎️** | Shows `SUPPORT_CONTACT` |
| **Convert Bonus 💱** | Moves `bonusBalance` into the spendable `balance` |

Deposit/withdraw here are **manual, admin-approved placeholders** (same
caveat as the Web App wallet routes) — swap them for a real Telebirr
webhook before accepting live funds.

### Running the bot

```bash
cd backend
npm install
npm run bot        # or: npm run bot:dev  (nodemon, local development)
```

Required env vars beyond the ones above: `BOT_WEBAPP_URL`, and
optionally `BOT_BANNER_URL`, `ADMIN_CHAT_ID`, `SUPPORT_CONTACT`,
`DEPOSIT_TELEBIRR_PHONE`, `MIN_DEPOSIT`, `MIN_WITHDRAW`,
`BONUS_CONVERSION_RATE` — see `backend/.env.example`.

### Deploying the bot

Deploy it as a **second Render service** using **Background Worker**
(not Web Service — it has no HTTP port to expose):
- **Root Directory:** `backend`
- **Build command:** `npm install`
- **Start command:** `npm run bot`
- Environment variables: same `MONGO_URI` as the API, plus
  `TELEGRAM_BOT_TOKEN` and the bot-specific vars above.

Once it's running, `/start` in Telegram shows the menu from your
screenshot, with **Play** launching your deployed Web App directly.

## How the game works

- A room is created (auto-created on first join, or explicitly via
  `POST /api/game/rooms`) with a `waiting` status and an entry fee.
- When a player joins over Socket.io (`join_room`), the entry fee is
  deducted from their wallet and they're dealt a random 5×5 card
  (75-ball layout, free center space).
- Once **2+ players** have joined, the room auto-starts: the server
  calls a random uncalled number every `CALL_INTERVAL_MS` and
  broadcasts it, auto-marking every player's card server-side (so
  players don't lose sync if the Telegram WebView is backgrounded).
- A player taps **BINGO!** to claim a win; the server independently
  re-validates the win pattern before paying out the full prize pool
  and ending the round.

## Payments

The wallet's deposit/withdraw endpoints are wired as clearly-marked
placeholders (`routes/wallet.js`) — they simulate success so the app is
runnable end-to-end, but **do not accept real money as-is**. Before
going live you need a real payment provider (e.g. Telebirr) merchant
agreement, and the `deposit/confirm` route must be replaced with a
server-to-server webhook handler that verifies the payment
independently — never trust a client-supplied "payment succeeded" call.

You're also building what is, functionally, a real-money game of
chance for ETB — worth checking Ethiopia's current rules on online
gaming/lottery licensing before accepting real deposits.
