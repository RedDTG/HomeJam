# HomeJam

Self-hosted music jam app with three web surfaces:

- `/admin` controls the jam, shows download progress, and hosts the audio player.
- `/client` lets guests search iTunes metadata and add tracks to the queue.
- `/visualizer` displays the current track, album artwork, and a compact queue.

## Requirements

- Node.js 20+
- `yt-dlp` configured through `YTDLP_PATH` in `.env`
- `ffmpeg` configured through `FFMPEG_PATH` in `.env`

## Run

```sh
npm install
npm run build
npm start
```

Open `http://localhost:3000/admin` on the machine connected to the speakers. Guests can use `http://localhost:3000/client`, and a display can use `http://localhost:3000/visualizer`.

Downloaded tracks are stored in `media/`; jam state is stored in `data/state.json`.

## Environment

Create `.env` from `.env.example` and adjust paths if needed:

```env
YTDLP_PATH=..\yt-dlp_x86.exe
FFMPEG_PATH=tools\ffmpeg\bin
```
