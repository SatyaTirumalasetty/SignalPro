# ── Build ─────────────────────────────────────────────────────────────────────
# All four apps (shell + trading/market/admin remotes) share one npm workspace,
# so they're built together here and then split into per-app runner images below.
FROM node:20-alpine AS build
WORKDIR /app

COPY frontend/package*.json ./
COPY frontend/shell/package*.json ./shell/
COPY frontend/remotes/trading/package*.json ./remotes/trading/
COPY frontend/remotes/market/package*.json ./remotes/market/
COPY frontend/remotes/admin/package*.json ./remotes/admin/
RUN npm ci

# Vite inlines VITE_* vars at build time. The shell needs the *browser-reachable*
# URLs of the remotes' remoteEntry.js bundles; the remotes need the API base URL
# for their own data fetching.
ARG VITE_API_BASE_URL=http://localhost:3001
ARG VITE_TRADING_REMOTE_URL=http://localhost:5174/remoteEntry.js
ARG VITE_MARKET_REMOTE_URL=http://localhost:5175/remoteEntry.js
ARG VITE_ADMIN_REMOTE_URL=http://localhost:5176/remoteEntry.js
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_TRADING_REMOTE_URL=$VITE_TRADING_REMOTE_URL \
    VITE_MARKET_REMOTE_URL=$VITE_MARKET_REMOTE_URL \
    VITE_ADMIN_REMOTE_URL=$VITE_ADMIN_REMOTE_URL

COPY frontend/ ./
RUN npm run build

# ── Serve: shell ──────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS shell
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/shell/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]

# ── Serve: trading remote ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS trading_remote
COPY frontend/nginx.remote.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/remotes/trading/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/remoteEntry.js || exit 1
CMD ["nginx", "-g", "daemon off;"]

# ── Serve: market remote ──────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS market_remote
COPY frontend/nginx.remote.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/remotes/market/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/remoteEntry.js || exit 1
CMD ["nginx", "-g", "daemon off;"]

# ── Serve: admin remote ───────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS admin_remote
COPY frontend/nginx.remote.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/remotes/admin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/remoteEntry.js || exit 1
CMD ["nginx", "-g", "daemon off;"]
