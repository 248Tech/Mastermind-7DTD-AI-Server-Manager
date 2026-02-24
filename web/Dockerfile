# Dev: install deps and run next dev (source mounted in compose)
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ["pnpm", "run", "dev"]
