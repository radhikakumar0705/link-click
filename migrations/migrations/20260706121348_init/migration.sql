-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "oauth_provider" VARCHAR(50),
    "oauth_id" VARCHAR(255),
    "display_name" VARCHAR(100),
    "tier" VARCHAR(20) NOT NULL DEFAULT 'free',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urls" (
    "id" BIGSERIAL NOT NULL,
    "short_code" VARCHAR(12) NOT NULL,
    "long_url" TEXT NOT NULL,
    "long_url_hash" CHAR(64) NOT NULL,
    "user_id" BIGINT,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" VARCHAR(255),
    "max_clicks" INTEGER,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_tags" (
    "url_id" BIGINT NOT NULL,
    "tag" VARCHAR(50) NOT NULL,

    CONSTRAINT "url_tags_pkey" PRIMARY KEY ("url_id","tag")
);

-- CreateTable
CREATE TABLE "clicks" (
    "id" BIGSERIAL NOT NULL,
    "short_code" VARCHAR(12) NOT NULL,
    "clicked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" CHAR(64),
    "user_agent" TEXT,
    "country" CHAR(2),
    "city" VARCHAR(100),
    "device_type" VARCHAR(20),
    "browser" VARCHAR(50),
    "os" VARCHAR(50),
    "referrer" TEXT,
    "referrer_domain" VARCHAR(100),
    "is_unique" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_hourly_summary" (
    "short_code" VARCHAR(12) NOT NULL,
    "hour_bucket" TIMESTAMPTZ NOT NULL,
    "total_clicks" INTEGER NOT NULL DEFAULT 0,
    "unique_clicks" INTEGER NOT NULL DEFAULT 0,
    "country_top" JSONB,
    "device_top" JSONB,

    CONSTRAINT "click_hourly_summary_pkey" PRIMARY KEY ("short_code","hour_bucket")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "label" VARCHAR(100),
    "last_used_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "urls_short_code_key" ON "urls"("short_code");

-- CreateIndex
CREATE INDEX "idx_urls_short_code" ON "urls"("short_code");

-- CreateIndex
CREATE INDEX "idx_urls_long_url_hash" ON "urls"("long_url_hash");

-- CreateIndex
CREATE INDEX "idx_urls_user_id" ON "urls"("user_id");

-- CreateIndex
CREATE INDEX "idx_urls_expires_at" ON "urls"("expires_at");

-- CreateIndex
CREATE INDEX "idx_url_tags_url_id" ON "url_tags"("url_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- AddForeignKey
ALTER TABLE "urls" ADD CONSTRAINT "urls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "url_tags" ADD CONSTRAINT "url_tags_url_id_fkey" FOREIGN KEY ("url_id") REFERENCES "urls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
