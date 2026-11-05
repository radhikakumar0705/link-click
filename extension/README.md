# link-click Chrome extension

Manifest V3 · React 18 · Vite · Tailwind · Zustand · Recharts

## What it does

| Where | What |
|---|---|
| Toolbar popup (or **Alt+Shift+L**) | Shortens the current tab's URL, or any URL you paste, and copies it. |
| Right-click a link | **Shorten link with link-click**: shortens it without leaving the page and copies the result. |
| Right-click a page | **Shorten this page with link-click** |
| History tab | Your recent links (up to 50). Click a link to copy it; ✕ deletes it. |
| Analytics tab | Last 7 days: total and unique clicks, daily chart, countries, devices, referrers. |
| Settings tab | Account, notification preference, and server endpoints for self-hosted or local use. |

Shortening works without an account (10 per hour). Signing in adds custom aliases, expiry dates, history synced across devices, and analytics.

## Develop

```bash
cd extension
npm install
npm run dev        # vite build --watch → dist/
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `extension/dist/`.
3. After each rebuild, click ↻ on the extension card. Reopen the popup to see popup changes.

By default the extension talks to `http://localhost:3001` (write service) and `http://localhost:3003` (analytics). Start the backend with `npm run dev` from the repo root. To use a different server, change the endpoints in **Settings**.

Other scripts: `npm run type-check`, `npm run icons` (regenerates `public/icons/*.png`).

## Publish to the Chrome Web Store

1. **Deploy the backend** so it's reachable over HTTPS (see `docs/DESIGN.md`). An extension that only talks to `localhost` will be rejected.
2. **Bake in the production endpoints:**
   ```bash
   cp .env.example .env.production   # set VITE_API_BASE_URL and VITE_ANALYTICS_BASE_URL to your https:// URLs
   ```
3. **Bump `version`** in `package.json`. The build copies it into the manifest.
4. **Package it:** `npm run zip` creates `release/link-click-<version>.zip`.
5. **Upload** the zip at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). There is a one-time $5 developer fee.
6. **Fill in the listing:** description, at least one 1280×800 screenshot, the 128 px icon (`public/icons/icon128.png`), and a privacy policy URL. You can host [`PRIVACY.md`](PRIVACY.md) for this, e.g. on GitHub Pages.
7. **Lock down CORS:** once the store assigns the extension ID, set `EXTENSION_ORIGIN=chrome-extension://<id>` on the write and analytics services with `NODE_ENV=production`.

### Permission justifications (for the store's "Privacy practices" tab)

| Permission | Why |
|---|---|
| `activeTab` | Reads the URL of the current tab when you open the popup or use the right-click menu, so it can be shortened. No other access to pages. |
| `contextMenus` | Adds "Shorten link" and "Shorten this page" to the right-click menu. |
| `clipboardWrite` + `offscreen` | Copies a short link created from the right-click menu. Service workers can't use the clipboard, so a hidden offscreen document does the copy. |
| `storage` | Stores your sign-in tokens, settings, and recent link history on this device. |
| `notifications` | Confirms that a link shortened from the right-click menu was copied, or explains why it failed. |
| `alarms` | Refreshes your sign-in token before it expires (every 55 min). |

The extension has **no host permissions and no content scripts**. It never reads page content. It talks only to the link-click API, which allows its origin through CORS.

## Layout

```
src/
├── popup/            # React UI: App, LoginView, tabs/{Shorten,History,Analytics,Settings}
├── background/       # service worker: context menu, token refresh, clipboard via offscreen
├── offscreen/        # hidden page that performs clipboard writes for the service worker
├── api/client.ts     # typed fetch wrapper, 401 → refresh → retry
├── utils/            # storage, history, validation, clipboard
├── store/            # Zustand store
└── config.ts         # build-time default endpoints (VITE_*)
public/               # manifest.json, icons/
scripts/              # generate-icons.mjs, zip.mjs (no dependencies)
```

## Differences from the spec (§6)

- **No content script.** Spec §6.2 injected one into `<all_urls>` only to copy text. The offscreen document does that job without "read and change all your data on all websites", a warning that slows store review and puts off users.
- **No `identity` permission yet.** Google sign-in (§6.3) isn't implemented, and the store rejects permissions that aren't used. Add it back with `chrome.identity.launchWebAuthFlow` when OAuth lands.
- **No hard-coded host.** `snplink.io` isn't a deployed service. Endpoints come from build-time env vars plus the Settings override.
- **Offline (§7.4):** the popup shows an offline banner and a clear error, but doesn't queue requests to retry later.
