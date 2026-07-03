# apps/web/Dockerfile - Landing Page / Marketing Site
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ============================================
# STAGE 1: Install dependencies
# ============================================
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# ============================================
# STAGE 2: Build
# ============================================
FROM base AS builder
ARG VITE_APP_URL
ENV VITE_APP_URL=$VITE_APP_URL
# VITE_API_URL is baked into the bundle at build time; the public budget
# share page (/budget/:token) calls the API through it. Without this, the
# build falls back to http://localhost:5001 and the public page fails in prod.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# NOTE: Using stage index (1) instead of name due to Coolify ARG injection issues
COPY --from=1 /app/node_modules ./node_modules
COPY --from=1 /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

# Build landing page.
# NOTE: We call vite directly (not `pnpm build`) to skip the `tsc -b` step,
# which is a no-emit type-check that doubles the builder-stage memory footprint.
# Type-checking still runs in CI via `pnpm lint` / `pnpm test` / local dev.
# This reduced the parallel-build peak RAM enough to keep Coolify (small
# instance) from being OOM-killed during multi-service builds.
WORKDIR /app/apps/web
RUN pnpm exec vite build

# ============================================
# STAGE 3: Production with Nginx
# ============================================
FROM nginx:alpine AS runner

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
# NOTE: Using stage index (2) instead of name due to Coolify ARG injection issues
COPY --from=2 /app/apps/web/dist /usr/share/nginx/html

# Configure for non-root user on port 8080
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
