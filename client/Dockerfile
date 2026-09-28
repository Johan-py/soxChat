# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY index.html ./
COPY src ./src

RUN pnpm run build

# Production stage: serve with Caddy
FROM caddy:2-alpine AS production

COPY --from=builder /app/dist /srv

EXPOSE 80

CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
