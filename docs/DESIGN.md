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

302 keeps every request hitting the server (or CDN edge). CloudFront caches 302 responses for 5 minutes for anonymous users, reducing origin load by ~95% for viral links while preserving full control.

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

**Decision:** Client IPs are hashed as `SHA-256(IP + daily_salt)` before any persistence. Raw IPs are never stored.

**Why:**

GDPR Article 4(1) classifies IP addresses as personal data. Storing raw IPs without consent and a legal basis is a violation.

The daily rotation gives us: unique visitor counting within a 24-hour window (same IP → same hash on the same day), but no cross-day tracking (same IP produces a different hash each day — cannot track individuals over time). The hash is computationally irreversible — an HMAC with an unknown rotating salt cannot be reversed to the original IP.

This satisfies GDPR's data minimisation principle while preserving the analytical value of unique-visitor counting.
