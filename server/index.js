const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// Game constants
const GAME_CONFIG = {
  MAP_WIDTH: 1200,
  MAP_HEIGHT: 800,
  PLAYER_SPEED: 200,
  PLAYER_SIZE: 32,
  LASER_SPEED: 600,
  LASER_COOLDOWN: 250, // ms between shots
  KILLS_TO_WIN: 5,
  ROUND_TIME: 60, // seconds
  RESPAWN_TIME: 2000 // ms
};

// Game state
let gameState = {
  players: {},
  lasers: [],
  scores: {},
  roundActive: false,
  roundTimer: null,
  roundTimeRemaining: GAME_CONFIG.ROUND_TIME,
  gameOver: false,
  winner: null
};

// Obstacles/cover on the map
const obstacles = [
  { x: 200, y: 200, width: 100, height: 100 },
  { x: 900, y: 200, width: 100, height: 100 },
  { x: 200, y: 500, width: 100, height: 100 },
  { x: 900, y: 500, width: 100, height: 100 },
  { x: 550, y: 350, width: 100, height: 100 }, // center
  { x: 400, y: 100, width: 80, height: 40 },
  { x: 720, y: 100, width: 80, height: 40 },
  { x: 400, y: 660, width: 80, height: 40 },
  { x: 720, y: 660, width: 80, height: 40 },
];

// Spawn points
const spawnPoints = [
  { x: 100, y: 400 },
  { x: 1100, y: 400 }
];

function resetGameState() {
  gameState.lasers = [];
  gameState.scores = {};
  gameState.roundActive = false;
  gameState.roundTimeRemaining = GAME_CONFIG.ROUND_TIME;
  gameState.gameOver = false;
  gameState.winner = null;

  if (gameState.roundTimer) {
    clearInterval(gameState.roundTimer);
    gameState.roundTimer = null;
  }

  // Reset player positions and scores
  const playerIds = Object.keys(gameState.players);
  playerIds.forEach((id, index) => {
    const spawn = spawnPoints[index % spawnPoints.length];
    gameState.players[id].x = spawn.x;
    gameState.players[id].y = spawn.y;
    gameState.players[id].alive = true;
    gameState.players[id].lastShot = 0;
    gameState.scores[id] = 0;
  });
}

function startRound() {
  if (Object.keys(gameState.players).length < 2) {
    io.emit('waiting', { message: 'Waiting for another player...' });
    return;
  }

  resetGameState();
  gameState.roundActive = true;

  io.emit('roundStart', {
    players: gameState.players,
    scores: gameState.scores,
    timeRemaining: gameState.roundTimeRemaining
  });

  // Round timer
  gameState.roundTimer = setInterval(() => {
    gameState.roundTimeRemaining--;

    if (gameState.roundTimeRemaining <= 0) {
      endRound('timeout');
    }

    io.emit('timerUpdate', { timeRemaining: gameState.roundTimeRemaining });
  }, 1000);
}

function endRound(reason) {
  gameState.roundActive = false;

  if (gameState.roundTimer) {
    clearInterval(gameState.roundTimer);
    gameState.roundTimer = null;
  }

  // Determine winner
  let winner = null;
  let highScore = -1;
  let tie = false;

  for (const [id, score] of Object.entries(gameState.scores)) {
    if (score > highScore) {
      highScore = score;
      winner = id;
      tie = false;
    } else if (score === highScore) {
      tie = true;
    }
  }

  gameState.gameOver = true;
  gameState.winner = tie ? null : winner;

  io.emit('roundEnd', {
    reason,
    winner: gameState.winner,
    winnerName: gameState.winner ? gameState.players[gameState.winner]?.name : null,
    scores: gameState.scores,
    tie
  });

  // Auto-restart after 5 seconds
  setTimeout(() => {
    if (Object.keys(gameState.players).length >= 2) {
      startRound();
    }
  }, 5000);
}

function checkCollision(rect1, rect2) {
  return rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y;
}

function respawnPlayer(playerId) {
  const player = gameState.players[playerId];
  if (!player) return;

  // Find spawn point furthest from other players
  let bestSpawn = spawnPoints[0];
  let maxDist = 0;

  for (const spawn of spawnPoints) {
    let minDistToEnemy = Infinity;
    for (const [id, p] of Object.entries(gameState.players)) {
      if (id !== playerId && p.alive) {
        const dist = Math.hypot(spawn.x - p.x, spawn.y - p.y);
        minDistToEnemy = Math.min(minDistToEnemy, dist);
      }
    }
    if (minDistToEnemy > maxDist) {
      maxDist = minDistToEnemy;
      bestSpawn = spawn;
    }
  }

  player.x = bestSpawn.x;
  player.y = bestSpawn.y;
  player.alive = true;

  io.emit('playerRespawn', { playerId, x: player.x, y: player.y });
}

// Game loop - runs at 60fps
setInterval(() => {
  if (!gameState.roundActive) return;

  // Update lasers
  const lasersToRemove = [];

  for (let i = 0; i < gameState.lasers.length; i++) {
    const laser = gameState.lasers[i];

    // Move laser
    laser.x += laser.vx * (1 / 60);
    laser.y += laser.vy * (1 / 60);

    // Check bounds
    if (laser.x < 0 || laser.x > GAME_CONFIG.MAP_WIDTH ||
      laser.y < 0 || laser.y > GAME_CONFIG.MAP_HEIGHT) {
      lasersToRemove.push(i);
      continue;
    }

    // Check obstacle collision
    let hitObstacle = false;
    for (const obs of obstacles) {
      if (laser.x >= obs.x && laser.x <= obs.x + obs.width &&
        laser.y >= obs.y && laser.y <= obs.y + obs.height) {
        hitObstacle = true;
        break;
      }
    }
    if (hitObstacle) {
      lasersToRemove.push(i);
      continue;
    }

    // Check player collision
    for (const [playerId, player] of Object.entries(gameState.players)) {
      if (playerId === laser.ownerId || !player.alive) continue;

      const playerRect = {
        x: player.x - GAME_CONFIG.PLAYER_SIZE / 2,
        y: player.y - GAME_CONFIG.PLAYER_SIZE / 2,
        width: GAME_CONFIG.PLAYER_SIZE,
        height: GAME_CONFIG.PLAYER_SIZE
      };

      if (laser.x >= playerRect.x && laser.x <= playerRect.x + playerRect.width &&
        laser.y >= playerRect.y && laser.y <= playerRect.y + playerRect.height) {
        // Hit!
        player.alive = false;
        gameState.scores[laser.ownerId] = (gameState.scores[laser.ownerId] || 0) + 1;
        lasersToRemove.push(i);

        io.emit('playerHit', {
          playerId,
          shooterId: laser.ownerId,
          scores: gameState.scores
        });

        // Check win condition
        if (gameState.scores[laser.ownerId] >= GAME_CONFIG.KILLS_TO_WIN) {
          endRound('killLimit');
        } else {
          // Respawn after delay
          setTimeout(() => respawnPlayer(playerId), GAME_CONFIG.RESPAWN_TIME);
        }

        break;
      }
    }
  }

  // Remove dead lasers (reverse order to maintain indices)
  for (let i = lasersToRemove.length - 1; i >= 0; i--) {
    gameState.lasers.splice(lasersToRemove[i], 1);
  }

  // Broadcast game state
  io.emit('gameState', {
    players: gameState.players,
    lasers: gameState.lasers.map(l => ({ x: l.x, y: l.y, angle: l.angle, color: l.color }))
  });

}, 1000 / 60);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Check if game is full
  if (Object.keys(gameState.players).length >= 2) {
    socket.emit('gameFull', { message: 'Game is full. Try again later.' });
    socket.disconnect();
    return;
  }

  // Assign player to spawn point
  const playerIndex = Object.keys(gameState.players).length;
  const spawn = spawnPoints[playerIndex];
  const playerColors = ['#00ffff', '#ff00ff']; // Cyan and Magenta

  gameState.players[socket.id] = {
    id: socket.id,
    name: `Player ${playerIndex + 1}`,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    color: playerColors[playerIndex],
    alive: true,
    lastShot: 0
  };
  gameState.scores[socket.id] = 0;

  socket.emit('init', {
    playerId: socket.id,
    config: GAME_CONFIG,
    obstacles,
    players: gameState.players
  });

  io.emit('playerJoined', {
    playerId: socket.id,
    player: gameState.players[socket.id],
    playerCount: Object.keys(gameState.players).length
  });

  // Start game if we have 2 players
  if (Object.keys(gameState.players).length === 2) {
    setTimeout(() => startRound(), 2000);
  }

  // Handle player movement
  socket.on('move', (data) => {
    const player = gameState.players[socket.id];
    if (!player || !player.alive || !gameState.roundActive) return;

    let newX = player.x + (data.dx || 0);
    let newY = player.y + (data.dy || 0);

    // Bounds checking
    const halfSize = GAME_CONFIG.PLAYER_SIZE / 2;
    newX = Math.max(halfSize, Math.min(GAME_CONFIG.MAP_WIDTH - halfSize, newX));
    newY = Math.max(halfSize, Math.min(GAME_CONFIG.MAP_HEIGHT - halfSize, newY));

    // Obstacle collision
    const playerRect = {
      x: newX - halfSize,
      y: newY - halfSize,
      width: GAME_CONFIG.PLAYER_SIZE,
      height: GAME_CONFIG.PLAYER_SIZE
    };

    let blocked = false;
    for (const obs of obstacles) {
      if (checkCollision(playerRect, obs)) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      player.x = newX;
      player.y = newY;
    }

    player.angle = data.angle || player.angle;
  });

  // Handle shooting
  socket.on('shoot', (data) => {
    const player = gameState.players[socket.id];
    if (!player || !player.alive || !gameState.roundActive) return;

    const now = Date.now();
    if (now - player.lastShot < GAME_CONFIG.LASER_COOLDOWN) return;

    player.lastShot = now;

    const angle = data.angle;
    const laser = {
      id: `${socket.id}-${now}`,
      ownerId: socket.id,
      x: player.x + Math.cos(angle) * 20,
      y: player.y + Math.sin(angle) * 20,
      vx: Math.cos(angle) * GAME_CONFIG.LASER_SPEED,
      vy: Math.sin(angle) * GAME_CONFIG.LASER_SPEED,
      angle,
      color: player.color
    };

    gameState.lasers.push(laser);

    io.emit('laserFired', {
      playerId: socket.id,
      laser: { x: laser.x, y: laser.y, angle: laser.angle, color: laser.color }
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete gameState.players[socket.id];
    delete gameState.scores[socket.id];

    io.emit('playerLeft', {
      playerId: socket.id,
      playerCount: Object.keys(gameState.players).length
    });

    // End round if less than 2 players
    if (Object.keys(gameState.players).length < 2 && gameState.roundActive) {
      endRound('playerLeft');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Laser Arena server running on port ${PORT}`);
  console.log(`   Open http://localhost:${PORT} in your browser`);
});
