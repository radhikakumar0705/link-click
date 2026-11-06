# Architecture Decision Records

Six decisions that define how link-click works and why. A hiring manager who reads this understands the engineering thinking behind the project.

---

## ADR-001: Base62 Encoding over Random Strings

**Decision:** Use Postgres `BIGSERIAL` auto-increment IDs encoded to Base62 as the `short_code`.

**Alternatives considered:**
1. Random 6-char alphanumeric string with collision check on every insert
2. MD5 hash truncated to 6 chars

**Why Base62 wins:**

Random strings require a DB round-trip on every insert to check for collisions. At 100 million links, that round-trip adds latency to every shorten operation. At 80% capacity (~45 billion links), the birthday problem means ~3% of random 6-char codes collide on the first try.

MD5 truncation produces genuine hash collisions and gives you no dedup story.

Base62 encoding of a monotonically increasing integer is collision-free by construction (Postgres guarantees ID uniqueness), deterministically reversible (decode gives back the original ID with no DB lookup), and produces naturally ordered codes. At 62^6 ≈ 56 billion 6-char codes, we extend to 7 chars at 80% capacity via feature flag.

**Implementation note:** We pull `nextval()` from the Postgres sequence before inserting, so the shortCode is computed and inserted in a single atomic operation — no two-step insert-then-update, no race condition.

---

## ADR-002: HTTP 302 over 301 for Redirects

**Decision:** All short-link redirects use HTTP 302 Temporary Redirect.

**Why not 301:**

301 instructs browsers to cache the redirect permanently. Once a browser has seen a 301 for `/aB3kP9`, it never asks the server again — it goes directly to the destination. This breaks three things:

1. **Analytics** — return visitors are invisible. Click counts are permanently wrong.
2. **Link updates** — if you change the destination URL, users who already visited see the old one forever.
3. **Features** — expiry checking, max-clicks enforcement, and password prompts all require the request to reach the server.

302 keeps every request hitting the server. Redirects are also sent with `Cache-Control: no-store`, so no browser or CDN caches them: every visit must reach the redirect service to be counted and to have expiry, click limits and passwords enforced. Load is handled in Redis instead (sub-5 ms cache hits).

The original spec put CloudFront in front, caching 302s for 5 minutes. That's not deployed, and it would conflict with the above: edge hits are never counted and skip the checks. If a CDN is added later for viral links, it should cache only links with no expiry, limit or password, and click counting would have to move to edge logs.

---

## ADR-003: Kafka for Click Event Ingestion

**Decision:** Redirect Service publishes click events to Kafka. A Kafka Consumer batch-writes them to Postgres every 5 seconds.

**The problem without Kafka:**

At 1 billion redirects/day (~11,600 req/s average, 23,000 req/s peak), writing one Postgres row per redirect would add 5–20ms of DB latency to every redirect and create write contention that degrades read performance.

**How Kafka fixes it:**

The redirect returns in microseconds after publishing a 200-byte message to Kafka — the user's browser is already loading the destination. The Kafka consumer batch-inserts thousands of rows in one DB round-trip. Events are durable on Kafka for 7 days — a replay buffer for backfills and bug fixes.

**Local dev and free-tier fallback:**

The Kafka plugin wraps `connect()` in a try/catch with a 3-second timeout. If Kafka is unavailable, it falls back to direct Postgres writes silently. The redirect service never crashes due to Kafka being absent.

---

## ADR-004: Separate Read and Write Services

**Decision:** Deploy the redirect path and the shorten path as separate Fastify services.

**Why:**

Redirect traffic is 100× write traffic. A single service means scaling to handle redirects wastes resources on write capacity, and a slow shorten operation (bcrypt, Safe Browsing API call, DB write) competes for event-loop time with latency-sensitive redirects.

Separate services have independent autoscaling: redirect scales 3–50 instances; write scales 1–10 instances. Different reliability SLOs: redirect targets five-nines uptime; write can tolerate brief maintenance windows.

---

## ADR-005: Refresh Tokens in Redis, not Postgres

**Decision:** Refresh token hashes are stored in Redis with a 30-day TTL, not in a Postgres table.

**Why Redis:**

Refresh token operations are high-frequency: every token rotation, every 55-minute service-worker refresh. Redis gives sub-millisecond reads, native TTL with no cleanup jobs needed, and O(1) revocation via `DEL`. If Redis is lost, all sessions are invalidated — users must re-login. This is acceptable because sessions are ephemeral by design, and Redis with AOF persistence makes data loss extremely rare.

**Rotation:** Each refresh token is single-use. On every refresh, the old token is deleted and a new one issued. A stolen token becomes invalid the moment the real user uses theirs.

---

## ADR-006: Daily-Rotating Salt for IP Hashing

**Decision:** Client IPs are hashed before any persistence, and raw IPs are never stored:

```
day_key = HMAC-SHA256(IP_HASH_SECRET, "ip-day-key:" + UTC date)
ip_hash = HMAC-SHA256(day_key, ip)
```

- **`IP_HASH_SECRET` must be secret** (env var, required in production). There are only ~4.3 billion IPv4 addresses, so an unkeyed or guessable salt can be brute-forced in minutes on a GPU. An earlier version derived the salt from the date plus a constant string, which anyone could recompute.
- **The date is read per request,** so the key rotates at UTC midnight. An earlier version computed it once at process start, so it only rotated when the service restarted.
- **Unique visitors** = first visit from an `ip_hash` to a link that day, decided in the redirect service with an atomic Redis `SET NX` (not per consumer batch). So "unique" means *unique per day*; a 7-day total sums daily uniques.

**Why:**

GDPR Article 4(1) classifies IP addresses as personal data. Storing raw IPs without consent and a legal basis is a violation.

The daily rotation gives us unique-visitor counting within a day (same IP → same hash on the same day) but no cross-day tracking (a different hash each day). Because the key is secret, the hash can't be reversed by enumerating the IPv4 space.

This satisfies GDPR's data minimisation principle while preserving the analytical value of unique-visitor counting.

---

## Deployment

Target: **Railway** (the four services, built from their Dockerfiles) + **Supabase** (Postgres) + **Upstash** (Redis). Kafka needs a hosted broker too (any Kafka-compatible service; set `KAFKA_BROKERS`).

1. Create the Supabase project, Upstash database and Kafka broker.
2. On Railway, create one service per folder in `services/`, each using its `Dockerfile`.
3. Set environment variables on every service, the same keys as `.env`. Production also needs:
   - `NODE_ENV=production`
   - `IP_HASH_SECRET`: a 64-char random hex string (`openssl rand -hex 32`); redirect service, required
   - `EXTENSION_ORIGIN=chrome-extension://<your extension id>`: write and analytics services, for CORS
   - `SHORT_BASE_URL`: the public URL of the redirect service
4. Apply migrations: push a `v*` tag (CI runs `prisma migrate deploy` with the `PROD_DATABASE_URL`/`PROD_DIRECT_URL` secrets), or run `npm run migrate:deploy` locally with those URLs.

Redis must use the `noeviction` policy (Upstash's default): it stores refresh tokens and rate-limit/click-limit counters that must not be evicted.

---

## Known limitations (v1)

- **No geolocation.** `country` and `city` are always null: there's no GeoIP lookup yet, so the countries breakdown is empty. Adding one (e.g. MaxMind GeoLite2, looked up in the redirect service before hashing) is self-contained.
- **`clicks` isn't partitioned.** The spec's monthly range partitioning needs a hand-written migration (Prisma can't express `PARTITION BY`, and the primary key must become `(id, clicked_at)`). The nightly job checks first and skips partition creation until then.
- **Analytics totals lag up to 5 minutes.** Summary totals and the daily chart read `click_hourly_summary`, which a job refreshes every 5 minutes; referrers read raw clicks and are live.
- **Unique visitors are per day** (see ADR-006).
- **Click delivery is at-least-once.** If the consumer crashes after writing a batch but before committing its offset, that batch is written again on restart, slightly over-counting. Exactly-once would need an idempotency key per event.
