# Dev: install deps and run pnpm dev (source mounted in compose)
FROM node:20-alpine
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# Force devDependencies in this dev image so prisma/ts-node scripts always exist.
RUN pnpm install --frozen-lockfile --prod=false || pnpm install --prod=false
COPY . .
RUN pnpm exec prisma generate || npx prisma generate
EXPOSE 3001
ENV PORT=3001
CMD ["sh", "-lc", "(pnpm exec prisma db push || npx prisma db push) && pnpm prisma:seed && pnpm run dev"]
