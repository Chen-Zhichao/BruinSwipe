# Bruin$wipe🐻🍚

Bruin$wipe🐻🍚 tracks prepaid balances for UCLA meal swipes.

## What it does

- Add members.
- Record top-ups from Zelle, Venmo, cash, or any other payment source.
- Record a meal date, meal type, swipe price, and all people who used a swipe.
- Swipe price can be `$0.00` for free swipes.
- Show each member's current balance.
- Show a Monday-Sunday weekly swipe view.
- Paginate the ledger at 10 entries per page.
- Highlight weekly and monthly swipe leaders with food badges.
- Highlight the non-manager member with the highest current balance with a diamond badge.
- Export and import a JSON backup.
- Optional Supabase cloud sync so friends can open the same URL and see live balances.
- Let friends submit add/top-up/swipe requests for admin approval.
- Let admins edit the name on pending add-member requests before approval.
- Limit each browser to 5 successful public requests per day.
- Show inline feedback after public request submissions.
- Refresh admin auth before saving and show a saving state on meal records.

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
- Only the configured admin Google account can sign in and edit the ledger.
- Only the admin can approve requests, and approved requests are the only ones that affect balances.
- Updates are pushed to other open browsers through Supabase Realtime.

## Admin Google sign-in

Admin sign-in uses Supabase Google OAuth, so it does not send email magic links.

1. In Supabase, open **Authentication > Providers > Google**.
2. Copy the callback URL shown there.
3. In Google Cloud, create a **Web application** OAuth client.
4. Add the GitHub Pages origin as an authorized JavaScript origin:

```text
https://chen-zhichao.github.io
```

5. Add the Supabase callback URL as an authorized redirect URI.
6. Copy the Google client ID and client secret back into the Supabase Google provider settings.
7. In Supabase **Authentication > URL Configuration**, set the site URL and redirect URL to:

```text
https://chen-zhichao.github.io/BruinSwipe/
```

## Organizer account

When adding yourself, check **Organizer, exclude from balances**.

Organizer accounts:

- Appear in the meal picker.
- Appear in the weekly swipe view when selected.
- Appear in the balance table with a fixed display balance of `$100.00`.
- Do not store or display contact information.
- Do not count toward total balance, low balances, or paying member count.
- Are not available in the top-up form.

## Deploy

Because this is a static app, it can be deployed with GitHub Pages:

1. Commit these files, including `config.js` if you want cloud sync enabled.
2. Push to GitHub.
3. In the repo settings, enable GitHub Pages from the default branch.
4. Open the published GitHub Pages URL.

That published URL is the link to send to friends.
