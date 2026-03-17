# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false || pnpm install --prod=false
RUN npm install -g prisma@5.22.0 ts-node@10.9.2

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN prisma generate
RUN pnpm build

# ── Stage 3: dev (source mounted in compose for hot reload) ──────────────────
FROM deps AS dev
COPY . .
RUN prisma generate
EXPOSE 3001
ENV PORT=3001
CMD ["sh", "-lc", "prisma db push && ts-node prisma/seed.ts && pnpm dev"]

# ── Stage 4: runner (production) ─────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
RUN npm install -g prisma@5.22.0 ts-node@10.9.2
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY tsconfig.json ./
COPY --from=build /app/dist ./dist
EXPOSE 3001
ENV PORT=3001
CMD ["sh", "-c", "prisma migrate deploy && ts-node prisma/seed.ts && node dist/main"]
