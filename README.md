# ⚡ LASER ARENA ⚡

A real-time multiplayer top-down shooter built for demo purposes. Two players battle it out in a pixel-art arena with laser weapons!

![Laser Arena](https://via.placeholder.com/800x400/1a1a2e/00ffff?text=LASER+ARENA)

## 🎮 Gameplay

- **First to 5 kills wins** the round
- **1-minute timer** - if time runs out, highest score wins (ties are draws)
- **WASD** to move
- **Mouse** to aim
- **Click** to shoot lasers
- Respawn after 2 seconds when killed

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Build and run
docker build -t laser-arena .
docker run -p 3000:3000 laser-arena

# Or use docker-compose
docker-compose up -d
```

Then open `http://localhost:3000` in two browser windows (or two different computers on the same network).

### Option 2: Node.js

```bash
# Install dependencies
npm install

# Start server
npm start
```

## 🐳 Cloud Deployment

### For your two-container setup:

You only need **ONE container** running the game server. Both players connect to the same server.

```bash
# Build the image
docker build -t laser-arena:latest .

# Push to your registry (example with Docker Hub)
docker tag laser-arena:latest your-registry/laser-arena:latest
docker push your-registry/laser-arena:latest
```

Then on your cloud VM/container:
```bash
docker run -d -p 3000:3000 --name laser-arena your-registry/laser-arena:latest
```

### Architecture

```
┌─────────────────────────────────────────────────┐
│              Cloud Container/VM                 │
│  ┌─────────────────────────────────────────┐    │
│  │         laser-arena:3000                │    │
│  │  ┌─────────────┐  ┌─────────────────┐   │    │
│  │  │  Express    │  │  Socket.IO      │   │    │
│  │  │  (static)   │  │  (realtime)     │   │    │
│  │  └─────────────┘  └─────────────────┘   │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   ┌─────────┐                 ┌─────────┐
   │ Player 1│                 │ Player 2│
   │ Browser │                 │ Browser │
   └─────────┘                 └─────────┘
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | 3000    | Server port |

## 🎨 Customization

### Tweak game settings in `server/index.js`:

```javascript
const GAME_CONFIG = {
  MAP_WIDTH: 1200,
  MAP_HEIGHT: 800,
  PLAYER_SPEED: 200,      // Pixels per second
  LASER_SPEED: 600,       // Pixels per second
  LASER_COOLDOWN: 250,    // Ms between shots
  KILLS_TO_WIN: 5,        // First to X kills
  ROUND_TIME: 60,         // Seconds per round
  RESPAWN_TIME: 2000      // Ms to respawn
};
```

### Add more obstacles by editing the `obstacles` array:

```javascript
const obstacles = [
  { x: 200, y: 200, width: 100, height: 100 },
  // Add more here...
];
```

## 🔧 Technical Details

- **Server**: Node.js + Express + Socket.IO
- **Client**: Phaser 3 (HTML5 Canvas game engine)
- **Networking**: WebSocket for real-time state sync
- **Architecture**: Authoritative server (anti-cheat friendly)

## 📁 Project Structure

```
laser-arena/
├── server/
│   └── index.js        # Game server (authoritative)
├── client/
│   ├── index.html      # Game UI
│   └── game.js         # Phaser game client
├── Dockerfile          # Container build
├── docker-compose.yml  # Local dev setup
├── package.json
└── README.md
```

## 🐛 Troubleshooting

**Players can't connect:**
- Ensure port 3000 is exposed and accessible
- Check firewall rules allow WebSocket connections
- For cloud deployments, ensure your load balancer supports WebSockets

**Laggy gameplay:**
- The game uses client-side prediction for your own player
- Other players may appear slightly laggy on high-latency connections
- Consider deploying closer to your users geographically

**Game says "Game Full":**
- Only 2 players can play at once
- Refresh the page after someone leaves

## 📝 License

MIT - Do whatever you want with it!

---

Built for a kids' demo 🎮 Have fun!
