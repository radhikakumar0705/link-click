# link-click

> Full-stack URL shortener · Chrome extension · Sub-50ms redirects · Real-time analytics

## How to start

### macOS / Linux
```bash
bash setup.sh
npm run dev
```

### Windows (PowerShell)
See [docs/WINDOWS.md](docs/WINDOWS.md) for step-by-step instructions.

---

## What's running after `npm run dev`

| Service | URL | Responsibility |
|---------|-----|----------------|
| Write service | http://localhost:3001 | `POST /shorten`, auth, link management, QR codes, API keys |
| Redirect service | http://localhost:3002 | `GET /:code` — the hot redirect path |
| Analytics service | http://localhost:3003 | Click analytics, hourly aggregation |
| Kafka UI | http://localhost:8080 | Inspect the click-events topic |

---

## Try it immediately (no account needed)

```bash
# Shorten a URL
curl -s -X POST http://localhost:3001/shorten \
  -H "Content-Type: application/json" \
  -d '{"longUrl":"https://example.com"}' | jq .

# Follow the redirect (replace 000001 with your shortCode)
curl -v http://localhost:3002/000001
```

## With an account

```bash
# Register
curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"SecurePass1"}' | jq .

# Copy the accessToken, then list your links
curl -s http://localhost:3001/user/links \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | jq .

# Get analytics
curl -s http://localhost:3003/analytics/000001 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | jq .
```

---

## Load the Chrome extension

```bash
cd extension
npm install
npm run build
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select `extension/dist/`

It talks to `http://localhost:3001` and `http://localhost:3003` by default; change them in the extension's **Settings** tab.
To publish to the Chrome Web Store, see [extension/README.md](extension/README.md#publish-to-the-chrome-web-store).

---

## Project structure

```
link-click/
├── shared/
│   ├── types/          # All domain interfaces: User, ShortLink, ClickEvent
│   ├── base62/         # Collision-free short code encoding (see docs/DESIGN.md ADR-001)
│   └── validation/     # Zod schemas — single source of truth for input rules
├── services/
│   ├── write-service/      # POST /shorten · auth (JWT + refresh tokens) · link management
│   ├── redirect-service/   # GET /:code · Redis cache · password protection · click tracking
│   ├── analytics-service/  # Analytics queries · hourly aggregation cron · CSV export
│   └── kafka-consumer/     # Batch-writes click events from Kafka to Postgres
├── extension/              # React 18 · Vite · Tailwind · Manifest V3
├── migrations/             # Prisma schema → all database tables
├── infra/
│   ├── docker-compose.yml  # Postgres · Redis · Kafka · Kafka UI
│   └── terraform/          # Full AWS production infrastructure
├── docs/
│   ├── DESIGN.md           # Architecture Decision Records (why, not just what)
│   └── WINDOWS.md          # Windows PowerShell setup guide
└── .github/workflows/      # CI: lint → test → build → deploy with canary
```

---

## Architecture

```
Chrome Extension (React + MV3)
         │
         ▼ HTTPS
  ┌──────────────────────────────────────┐
  │            Services                  │
  │                                      │
  │  Write :3001       Redirect :3002    │
  │  POST /shorten     GET /:code        │
  │       │                 │            │
  │    Postgres          Redis           │
  │    (writes)       (< 5ms reads)      │
  │                       │             │
  │                  Kafka topic         │
  │                       │             │
  │              Kafka Consumer          │
  │           (batch insert / 5s)        │
  │                       │             │
  │  Analytics :3003       │            │
  │  (every 5 min)────────┘             │
  └──────────────────────────────────────┘
```

Key decisions documented in [docs/DESIGN.md](docs/DESIGN.md):
- **Base62 IDs** over random strings — zero collisions, no round-trips
- **HTTP 302** over 301 — preserves analytics, enables link updates
- **Kafka** for click ingestion — redirect never waits for DB writes
- **Separate read/write services** — redirect scales independently

---

## Running tests

```bash
# Unit tests (no infrastructure needed)
npm test -- --testPathPattern="base62|validation"

# All tests (requires npm run infra:up first)
npm test
```

---

## Deploying for free

See the deployment section in [docs/DESIGN.md](docs/DESIGN.md).

Short version: Supabase (Postgres) + Upstash (Redis) + Railway (services) = **$0/month** for low traffic.
