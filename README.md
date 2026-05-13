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
PRIMARY_COLOR=#b8f6d0
PRIMARY_COLOR_FROM_ARTWORK=false
```

`PRIMARY_COLOR` controls the main accent color used by existing colored elements such as buttons, status labels, progress bars, focus rings, and visualizer bars. Use a hex color (`#rgb` or `#rrggbb`).
Set `PRIMARY_COLOR_FROM_ARTWORK=true` to derive that accent color from the dominant color of the current track artwork. `PRIMARY_COLOR` remains the fallback when no artwork color can be extracted.
