# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY index.html ./
COPY src ./src

RUN npm run build

# Production stage: serve with Caddy
FROM caddy:2-alpine AS production

COPY --from=builder /app/dist /srv

EXPOSE 80

CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
