# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

# Vite inlines VITE_* vars at build time, so the API base URL must be supplied
# as a build arg (e.g. --build-arg VITE_API_BASE_URL=https://api.signalpro.example).
ARG VITE_API_BASE_URL=http://localhost:3001
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY frontend/ ./
RUN npm run build

# ── Serve ─────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
