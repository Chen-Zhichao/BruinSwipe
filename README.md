# SwipeWallet

SwipeWallet tracks prepaid balances for UCLA meal swipes.

## What it does

- Add members.
- Record top-ups from Zelle, Venmo, cash, or any other payment source.
- Record a meal date, meal type, swipe price, and all people who used a swipe.
- Show each member's current balance.
- Show a Monday-Sunday weekly swipe view.
- Export and import a JSON backup.
- Optional Supabase cloud sync so friends can open the same URL and see live balances.
- Let friends submit add/top-up/swipe requests for admin approval.

## Run locally

This app is static HTML, CSS, and JavaScript.

Option 1: open `index.html` in a browser.

Option 2: run the local preview server:

```bash
node server.mjs
```

Then open:

```text
http://localhost:4173
```

## Data storage

By default, the app stores data in the browser's `localStorage`. Use **Export**
regularly to keep a JSON backup when running in local mode.

For a shared production version, configure Supabase. Friends can then open the
same GitHub Pages URL and see the same cloud-backed balances in real time.

## Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Copy `supabase/schema.sql` into the editor.
4. Replace every `your-email@example.com` value with your admin email.
5. Run the SQL.
6. Copy `config.example.js` to `config.js`.
7. Fill in:

```js
window.SWIPEWALLET_SUPABASE = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  walletId: "main",
  adminEmail: "your-email@example.com",
};
```

Only use the publishable or anon key in `config.js`. Never put a Supabase
service role key in frontend code.

In cloud mode:

- Everyone can open the page and read balances.
- Everyone can submit requests.
- Only the configured admin email can sign in and edit the ledger.
- Only the admin can approve requests, and approved requests are the only ones that affect balances.
- Updates are pushed to other open browsers through Supabase Realtime.

## Organizer account

When adding yourself, check **Organizer, exclude from balances**.

Organizer accounts:

- Appear in the meal picker.
- Appear in the weekly swipe view when selected.
- Do not appear in the balance table.
- Do not count toward total balance, low balances, or paying member count.
- Are not available in the top-up form.

## Deploy

Because this is a static app, it can be deployed with GitHub Pages:

1. Commit these files, including `config.js` if you want cloud sync enabled.
2. Push to GitHub.
3. In the repo settings, enable GitHub Pages from the default branch.
4. Open the published GitHub Pages URL.

That published URL is the link to send to friends.
