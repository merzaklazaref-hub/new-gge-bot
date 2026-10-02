# GGE-BOT

> ⚠️ DISCLAIMER: use at your own risk. Not affiliated with GoodGameStudios.

## Overview

GGE-BOT is a self-hosted game automation service for Goodgame Empire. It provides:
- Multi-account bot management (`SubUsers`) via a web UI and WebSocket API
- Bridge for Discord integrations (optional, via OAuth2)
- Extensible plugin system loaded from `plugins/`, `plugins-extra/`, and `plugins-exploits/`
- Game protocol access (`sendXT`, `xtHandler`, etc.) with built-in request rate limiting
- Support for safe persistence in SQLite (`Users`, `SubUsers`)

## Core components

- `main.js` — server backend
  - HTTP + websocket portal
  - local cache for game resources (`items`, `lang`, `1.xml`)
  - authentication and signup flows
  - user/bot lifecycle and worker thread orchestration
- `ggeBot.js` — worker interacting with game server
  - WebSocket connection to GGS protocol
  - protocol translation (`xt`/`gfl`/`gai` events)
  - plugin hooks (`events` emitter, `parentPort` messages)
- `protocols.js` — helper types and server-side map/area computation
- `getEquipment.js` / `getMap.js` / `imageGen.js` / `units.js` — utilities used by worker and UI
- `sqliteCompat.js` — fallback adapter for environments lacking `node:sqlite`

## Setup

1. Install the latest Node.js version and enable `pnpm` via Corepack (`corepack enable`).
2. Clone this repo and run `pnpm install`.
3. Copy `.env`/`ggeConfig.json` as needed and configure:
   - `webPort` (default `3001`)
   - `discordToken`, `discordClientId`, `discordClientSecret` (optional)
   - `signupToken` for Web public register
   - `fontPath`, `privateKey`, `cert` (optional)
4. Start app: `node main.js`.

> The server auto-downloads item translations and `1.xml` network data if missing.

## API and UI

- REST endpoints
  - `GET /health` => `ok`
  - `GET /` => web UI app
  - `POST /api` for login/signup commands (`id = 0` or `1`)
  - `GET /1.xml`, `/assets.json` as proxies for game client resources
- WebSocket messages are in format `[errorType, actionType, payload]`
  - `ActionType.GetUsers` => user list / plugin states
  - `ActionType.SetUser` => update user and restart worker as needed
  - `ActionType.GetLogs` => live logs

## Comments and expansion

- I added inline comment coverage across core modules (`main.js`, `ggeBot.js`, `protocols.js`, `getEquipment.js`, `getMap.js`, `imageGen.js`, `units.js`, `sqliteCompat.js`).
- For future contribution, add plugin documentation in `plugins/` directly in plugin files.

## Discord configuration

1. Create app in https://discord.com/developers/applications.
2. Under "OAuth2" set redirect URI to `http://127.0.0.1:3001/discordAuth` (or public URL).
3. Configure tokens in `ggeConfig.json` and restart.
4. In UI, click "Link Discord".

## Troubleshooting

- Missing fonts: set `FONT_PATH` or `ggeConfig.fontPath` to a valid TTF file.
- SQLite lock errors: use `USER_DB_PATH` env to point at persistent writable path.
- Connection issues: validate `gameURL` from `1.xml` and `server` bits in SubUser config.

## License
MIT License. See `LICENSE` file for details.