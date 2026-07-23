# ---- builder: install everything + compile TS → dist/ ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Chromium comes from apt in the runtime image — never download it via npm.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime: minimal image with only prod deps + compiled JS ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Chromium for Puppeteer PDF rendering (agent report artifacts).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends chromium fonts-liberation \
	&& rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
	PUPPETEER_SKIP_DOWNLOAD=true \
	PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
# Prod deps include dbmate (used for migrations on container start); drop the cache to slim the image.
RUN npm ci --omit=dev && npm cache clean --force

# Compiled app + migration files + entrypoint.
COPY --from=builder /app/dist ./dist
COPY db ./db
COPY docker-entrypoint.sh ./
# Run as the unprivileged `node` user. Pre-create the artifacts dir owned by node so the named
# volume inherits writable ownership (a fresh volume copies the mount point's perms from the image).
RUN chmod +x docker-entrypoint.sh \
	&& mkdir -p /app/data/artifacts /app/public/uploads \
	&& chown -R node:node /app
USER node

# Informational only — the actual listen port is read from the PORT env var.
EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
