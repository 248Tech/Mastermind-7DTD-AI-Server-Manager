# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM deps AS build
# NEXT_PUBLIC_ vars are baked at build time; override via compose build args.
ARG NEXT_PUBLIC_CONTROL_PLANE_URL=http://localhost:3001
ENV NEXT_PUBLIC_CONTROL_PLANE_URL=$NEXT_PUBLIC_CONTROL_PLANE_URL
COPY . .
RUN pnpm build

# ── Stage 3: dev (source mounted in compose for hot reload) ──────────────────
FROM deps AS dev
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ["pnpm", "dev"]

# ── Stage 4: runner (production — Next.js standalone) ────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# next build --standalone copies only the minimal server bundle
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
