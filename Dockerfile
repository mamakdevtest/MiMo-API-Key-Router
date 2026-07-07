# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
RUN apk add --no-cache curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL=file:/data/mimo-router.sqlite

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 router
RUN mkdir -p /data && chown router:nodejs /data

COPY --from=builder --chown=router:nodejs /app/backend/dist ./backend/dist
COPY --from=builder --chown=router:nodejs /app/backend/drizzle ./backend/drizzle
COPY --from=builder --chown=router:nodejs /app/frontend/dist ./frontend/dist
COPY --from=builder --chown=router:nodejs /app/shared/dist ./shared/dist
COPY --from=builder --chown=router:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=router:nodejs /app/package.json ./package.json
COPY --from=builder --chown=router:nodejs /app/backend/package.json ./backend/package.json
COPY --chown=router:nodejs healthcheck.sh ./healthcheck.sh
RUN chmod +x ./healthcheck.sh

USER router

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["./healthcheck.sh"]

CMD ["node", "backend/dist/index.js"]
