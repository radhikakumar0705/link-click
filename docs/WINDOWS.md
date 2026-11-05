# Windows Setup Guide

`bash setup.sh` uses Linux commands that fail on Windows PowerShell.
Follow these steps instead.

## Prerequisites

- **Node.js 20+** from https://nodejs.org (verify: `node --version`)
- **Docker Desktop** from https://docs.docker.com/desktop/install/windows/

## Step 1 — Generate .env

```powershell
node -e "const crypto=require('crypto'),fs=require('fs');const{privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});const priv=privateKey.replace(/\n/g,'\\\\n'),pub=publicKey.replace(/\n/g,'\\\\n');fs.writeFileSync('.env',['DATABASE_URL=postgresql://linkclick:linkclick_dev_password@localhost:5432/linkclick','REDIS_URL=redis://localhost:6379','KAFKA_BROKERS=localhost:9092','SHORT_BASE_URL=http://localhost:3002','EXTENSION_ORIGIN=chrome-extension://placeholder','COOKIE_SECRET=local-dev-cookie-secret-32chars!!','NODE_ENV=development','LOG_LEVEL=info','FREE_TIER_ANALYTICS_DAYS=7','PRO_TIER_ANALYTICS_DAYS=90','SAFE_BROWSING_API_KEY=','GOOGLE_CLIENT_ID=','GOOGLE_CLIENT_SECRET=','JWT_PRIVATE_KEY='+priv,'JWT_PUBLIC_KEY='+pub].join('\n')+'\n');console.log('.env created');"
```

## Step 2 — Install dependencies

```powershell
npm install
```

## Step 3 — Start infrastructure

Make sure Docker Desktop is open, then:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

Wait 15 seconds. Check all containers are `Up`:

```powershell
docker ps
```

## Step 4 — Wait for Postgres

```powershell
docker exec link-click-postgres pg_isready -U linkclick -d linkclick
```

Repeat until you see `accepting connections`.

## Step 5 — Run migrations

```powershell
$env:DATABASE_URL="postgresql://linkclick:linkclick_dev_password@localhost:5432/linkclick"
npx prisma migrate dev --schema=migrations/schema.prisma --name init
```

## Step 6 — Start services

```powershell
npm run dev
```

## Step 7 — Test

```powershell
curl.exe -s -X POST http://localhost:3001/shorten -H "Content-Type: application/json" -d "{""longUrl"":""https://example.com""}"
```

Should return JSON with a `shortUrl`. Done.

## Troubleshooting

**`bash setup.sh` fails:** Use this guide instead. The bash script is for macOS/Linux only.

**Port 5432 in use:** Another Postgres is running locally. Stop it or change the port in `infra/docker-compose.yml`.

**Docker not found:** Open Docker Desktop first, wait for it to fully start (whale icon in taskbar).
