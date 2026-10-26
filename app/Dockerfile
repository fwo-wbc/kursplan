# ============================================================
# Dockerfile – Kursplan-App (Next.js 16 / TypeScript)
#
# Multi-Stage-Build für ein minimales Laufzeit-Image:
#   1. deps    : reproduzierbare Abhängigkeiten per `npm ci`
#   2. builder : `next build` mit Output `.next/standalone`
#   3. runner  : schlankes Alpine-Image, non-root, nur App-Bundle
#
# Alle Umgebungsvariablen (DB, n8n, edoobox) werden zur LAUFZEIT
# geliefert – es wird nichts Sensibles ins Image gebacken.
# ============================================================

# ---------- Stage 1: Dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# npm ci: exakte Lockfile-Versionen -> reproduzierbarer Build
RUN npm ci

# ---------- Stage 2: Build ----------
FROM node:22-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build setzt NODE_ENV bereits auf production; explizit setzen,
# damit auch Pfadlogik (z. B. .next/standalone) dieselbe Umgebung sieht.
ENV NODE_ENV=production

RUN npm run build

# ---------- Stage 3: Runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root-User (empfohlener Next.js-Standard)
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Statische Assets und Public-Dateien in das Standalone-Bundle kopieren
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
