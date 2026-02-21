# Laser Arena

Real-time multiplayer top-down shooter built with Node.js, Socket.IO, and Phaser.

## Current Game Rules

- Supports up to **40 concurrent players** per server
- **Free-for-all** mode
- Optional **1vCPU** quick-match from the join screen
- Rounds end at **20 total eliminations**
- **Live leaderboard** in the top-right UI
- **5 second respawn timer**
- Random respawns that avoid obstacles
- Obstacles are generated server-side and block both movement and laser shots
- End-of-round victory screen with **top 3 performers**

## Controls

- `W/A/S/D`: Move
- Mouse: Aim
- Left click: Shoot
- Mobile: Joystick move+aim, fire button shoot

## Run Locally (Node)

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Docker Build

```bash
docker build -t laser-arena:latest .
```

## Docker Compose (Two Containers)

```bash
docker compose up --build
```

This brings up:

- `laser-arena-1` on `http://localhost:3000`
- `laser-arena-2` on `http://localhost:3001`

Each container runs an independent arena server with capacity for up to 40 players.

## Homelab Deploy (Caddy + Cloudflare Tunnel)

This stack runs the game behind Caddy and publishes it through a Cloudflare Tunnel.

1. In Cloudflare Zero Trust, create a tunnel and choose the Docker connector flow.
2. In that tunnel, add a public hostname (for example `game.yourdomain.com`) with service URL `http://caddy:80`.
3. Copy the tunnel token into a local env file:

```bash
cp .env.homelab.example .env.homelab
```

4. Start the homelab stack:

```bash
docker compose --env-file .env.homelab -f docker-compose.homelab.yml up -d --build
```

5. Verify containers:

```bash
docker compose --env-file .env.homelab -f docker-compose.homelab.yml ps
docker compose --env-file .env.homelab -f docker-compose.homelab.yml logs -f cloudflared
```

Notes:
- Caddy is exposed only to localhost at `http://127.0.0.1:8080` for local testing.
- Public traffic enters through Cloudflare and is proxied to the game over the tunnel.
- Socket.IO/WebSocket upgrade traffic is handled by Caddy `reverse_proxy` automatically.

## Environment Variables

- `PORT` (default `3000`)
- `MAX_PLAYERS` (default `40`)
- `MAP_WIDTH` (default `2400`)
- `MAP_HEIGHT` (default `1600`)
