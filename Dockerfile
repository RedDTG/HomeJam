FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    YTDLP_PATH=yt-dlp \
    FFMPEG_PATH=/usr/bin

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY public ./public

RUN mkdir -p data media \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
