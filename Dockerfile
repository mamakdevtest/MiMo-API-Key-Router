# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: Install ALL dependencies (including dev for building)
# ============================================================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/

# Install ALL deps including devDependencies (tsc, vite, etc.)
# npm ci skips devDeps when NODE_ENV=production, so force include
RUN npm ci --include=dev

# ============================================================
# Stage 2: Build shared → frontend → backend
# ============================================================
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

# Copy everything from deps stage (includes devDependencies with tsc)
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY shared/ ./shared/
COPY frontend/ ./frontend/
COPY backend/ ./backend/
COPY package.json tsconfig.json ./

# Build in correct order: shared → frontend → backend
RUN npm run build --workspace=shared && \
    npm run build --workspace=frontend && \
    npm run build --workspace=backend

# ============================================================
# Stage 3: Production runner (minimal image)
# ============================================================
FROM node:20-alpine AS runner
RUN apk add --no-cache curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL=file:/data/mimo-router.sqlite

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 router
RUN mkdir -p /data && chown router:nodejs /data

# Copy only production artifacts
COPY --from=builder --chown=router:nodejs /app/backend/dist ./backend/dist
COPY --from=builder --chown=router:nodejs /app/backend/drizzle ./backend/drizzle
COPY --from=builder --chown=router:nodejs /app/backend/package.json ./backend/package.json
COPY --from=builder --chown=router:nodejs /app/frontend/dist ./frontend/dist
COPY --from=builder --chown=router:nodejs /app/shared/dist ./shared/dist
COPY --from=builder --chown=router:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=router:nodejs /app/package.json ./package.json
COPY --chown=router:nodejs healthcheck.sh ./healthcheck.sh
RUN chmod +x ./healthcheck.sh

USER router

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["./healthcheck.sh"]

CMD ["node", "backend/dist/index.js"]
