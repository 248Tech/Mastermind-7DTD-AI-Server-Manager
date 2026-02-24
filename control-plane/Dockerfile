# Dev: install deps and run pnpm dev (source mounted in compose)
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm prisma generate 2>/dev/null || true
EXPOSE 3001
ENV PORT=3001
CMD ["pnpm", "run", "dev"]
