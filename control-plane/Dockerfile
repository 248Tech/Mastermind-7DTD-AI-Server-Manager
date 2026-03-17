# Dev: install deps and run pnpm dev (source mounted in compose)
FROM node:20-alpine
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# Force devDependencies in this dev image so prisma/ts-node scripts always exist.
RUN pnpm install --frozen-lockfile --prod=false || pnpm install --prod=false
RUN npm install -g prisma@5.22.0
COPY . .
RUN prisma generate
EXPOSE 3001
ENV PORT=3001
CMD ["sh", "-lc", "prisma db push && pnpm prisma:seed && pnpm run dev"]
