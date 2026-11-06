#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# link-click — one-time setup script
# Run: bash setup.sh
# Works on macOS and Linux. Windows users: see docs/WINDOWS.md
# ─────────────────────────────────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v node   >/dev/null 2>&1 || error "Node.js 20+ required — https://nodejs.org"
command -v docker >/dev/null 2>&1 || error "Docker required — https://docs.docker.com/get-docker/"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 20 ] || error "Node.js 20+ required (found $NODE_MAJOR)"
info "Node.js $(node --version) ✓"

# ── Generate .env if missing ──────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "Generating .env with fresh RSA keys..."
  node -e "
const crypto = require('crypto');
const fs = require('fs');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',   format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8',  format: 'pem' },
});
const priv = privateKey.replace(/\n/g, '\\\\n');
const pub  = publicKey.replace(/\n/g, '\\\\n');
fs.writeFileSync('.env', [
  'DATABASE_URL=postgresql://linkclick:linkclick_dev_password@localhost:5432/linkclick',
  'REDIS_URL=redis://localhost:6379',
  'KAFKA_BROKERS=localhost:9092',
  'SHORT_BASE_URL=http://localhost:3002',
  'EXTENSION_ORIGIN=chrome-extension://placeholder',
  'COOKIE_SECRET=local-dev-cookie-secret-32chars!!',
  'IP_HASH_SECRET=' + crypto.randomBytes(32).toString('hex'),
  'NODE_ENV=development',
  'LOG_LEVEL=info',
  'FREE_TIER_ANALYTICS_DAYS=7',
  'PRO_TIER_ANALYTICS_DAYS=90',
  'SAFE_BROWSING_API_KEY=',
  'GOOGLE_CLIENT_ID=',
  'GOOGLE_CLIENT_SECRET=',
  'JWT_PRIVATE_KEY=' + priv,
  'JWT_PUBLIC_KEY='  + pub,
].join('\n') + '\n');
console.log('.env created');
"
  info ".env created ✓"
else
  warn ".env already exists — skipping key generation"
fi

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing npm dependencies..."
npm install
info "Dependencies installed ✓"

# ── Start infrastructure ──────────────────────────────────────────────────────
info "Starting Postgres, Redis, Kafka..."
docker compose -f infra/docker-compose.yml up -d

info "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  docker exec link-click-postgres pg_isready -U linkclick -d linkclick >/dev/null 2>&1 && break
  sleep 2
done
docker exec link-click-postgres pg_isready -U linkclick -d linkclick >/dev/null 2>&1 \
  || error "Postgres did not become ready in time. Run: docker logs link-click-postgres"
info "Postgres ready ✓"

# ── Run migrations ────────────────────────────────────────────────────────────
info "Running database migrations..."
set -a; source .env; set +a
npx prisma migrate dev --schema=migrations/schema.prisma --name init --skip-seed
info "Migrations complete ✓"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅  link-click is ready!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Start all services:     npm run dev"
echo ""
echo "  Write API:              http://localhost:3001"
echo "  Redirect (short links): http://localhost:3002"
echo "  Analytics API:          http://localhost:3003"
echo "  Kafka UI:               http://localhost:8080"
echo ""
echo "  Quick test:"
echo "    curl -s -X POST http://localhost:3001/shorten \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"longUrl\":\"https://example.com\"}' | jq ."
echo ""
