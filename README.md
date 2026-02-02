# LASER ARENA

A real-time multiplayer top-down shooter built for demo purposes. Two players battle it out in a pixel-art arena with laser weapons!

## Gameplay

- **First to 5 kills wins** the round
- **1-minute timer** - if time runs out, highest score wins (ties are draws)
- **WASD** to move
- **Mouse** to aim
- **Click** to shoot lasers
- Respawn after 2 seconds when killed

## To Start

```bash
# Build and run
docker pull tybennett/laser-arena
docker run -p 3000:3000 laser-arena

# Or use docker-compose and clone from this repo
docker-compose up (-d to run in detached state)
```

Then open `http://localhost:3000` in two browser windows (or two different computers on the same network).

## Container Image Deployment

```bash
# Build the image
docker build -t laser-arena:latest .

# Push to your registry (example with Docker Hub)
docker tag laser-arena:latest your-registry/laser-arena:latest
docker push your-registry/laser-arena:latest
```

Then the container is hosted on an AZ Container App using the docker.io/tybennett/laser-arena:latest image 
---

Built for a kids' demo 🎮 Have fun!
