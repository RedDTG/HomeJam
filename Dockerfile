FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY next-env.d.ts next.config.ts tsconfig.json tsconfig.server.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS runtime

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
COPY --from=builder /app/.next ./.next
COPY public ./public

RUN mkdir -p data media \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
