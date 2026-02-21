const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname)));

const GAME_CONFIG = {
  MAP_WIDTH: Number(process.env.MAP_WIDTH || 2400),
  MAP_HEIGHT: Number(process.env.MAP_HEIGHT || 1600),
  PLAYER_SPEED: 220,
  PLAYER_SIZE: 30,
  LASER_SPEED: 780,
  LASER_COOLDOWN: 180,
  LASER_TTL_MS: 1200,
  RESPAWN_TIME: 5000,
  MAX_PLAYERS: Number(process.env.MAX_PLAYERS || 40),
  MIN_PLAYERS_TO_START: 2,
  ELIMINATIONS_TO_END: 20,
  ROUND_TIME_SECONDS: 240,
  TICK_RATE: Number(process.env.TICK_RATE || 60),
  STATE_BROADCAST_RATE: Number(process.env.STATE_BROADCAST_RATE || 60),
  OBSTACLE_COUNT: 18
};

const START_COUNTDOWN_MS = 2000;
const NEXT_ROUND_DELAY_MS = 6000;
const MAX_SPAWN_ATTEMPTS = 120;
const MIN_SPAWN_DISTANCE = 90;
const MAX_NAME_LENGTH = 18;
const CPU_BOT_ID = 'cpu-bot-1';
const CPU_BOT_NAME = 'CPU Sentinel';

const gameState = {
  players: {},
  lasers: [],
  scores: {},
  obstacles: [],
  roundActive: false,
  roundNumber: 0,
  roundEndsAt: 0,
  eliminations: 0,
  botMatchRequesters: {},
  autoStartTimeout: null,
  autoNextRoundTimeout: null,
  lastStateBroadcastAt: 0
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeName(input) {
  if (typeof input !== 'string') {
    return 'Pilot';
  }

  const cleaned = input.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  return cleaned || 'Pilot';
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => {
    const color = light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };

  return `#${f(0)}${f(8)}${f(4)}`;
}

function randomTankColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 70 + Math.floor(Math.random() * 20);
  const lightness = 45 + Math.floor(Math.random() * 12);
  return hslToHex(hue, saturation, lightness);
}

function checkCollision(rectA, rectB) {
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function pointHitsObstacle(x, y) {
  for (const obstacle of gameState.obstacles) {
    if (pointInRect(x, y, obstacle)) {
      return true;
    }
  }

  return false;
}

function lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 0.000001) {
    return false;
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) {
    return true;
  }

  return (
    lineIntersectsLine(x1, y1, x2, y2, rect.x, rect.y, rect.x + rect.width, rect.y) ||
    lineIntersectsLine(x1, y1, x2, y2, rect.x, rect.y, rect.x, rect.y + rect.height) ||
    lineIntersectsLine(
      x1,
      y1,
      x2,
      y2,
      rect.x + rect.width,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height
    ) ||
    lineIntersectsLine(
      x1,
      y1,
      x2,
      y2,
      rect.x,
      rect.y + rect.height,
      rect.x + rect.width,
      rect.y + rect.height
    )
  );
}

function playerRectAt(x, y) {
  const half = GAME_CONFIG.PLAYER_SIZE / 2;
  return {
    x: x - half,
    y: y - half,
    width: GAME_CONFIG.PLAYER_SIZE,
    height: GAME_CONFIG.PLAYER_SIZE
  };
}

function collidesWithAnyObstacle(rect) {
  for (const obstacle of gameState.obstacles) {
    if (checkCollision(rect, obstacle)) {
      return true;
    }
  }

  return false;
}

function isSpawnClear(x, y) {
  const half = GAME_CONFIG.PLAYER_SIZE / 2;
  if (x < half || x > GAME_CONFIG.MAP_WIDTH - half || y < half || y > GAME_CONFIG.MAP_HEIGHT - half) {
    return false;
  }

  return !collidesWithAnyObstacle(playerRectAt(x, y));
}

function distanceToClosestAlivePlayer(x, y, excludePlayerId = null) {
  let minDistance = Infinity;

  for (const [id, player] of Object.entries(gameState.players)) {
    if (!player.alive) {
      continue;
    }

    if (excludePlayerId && id === excludePlayerId) {
      continue;
    }

    const d = Math.hypot(player.x - x, player.y - y);
    if (d < minDistance) {
      minDistance = d;
    }
  }

  return minDistance;
}

function randomSpawn(excludePlayerId = null) {
  const half = GAME_CONFIG.PLAYER_SIZE / 2 + 2;
  let bestPoint = null;
  let bestDistance = -1;

  for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i += 1) {
    const x = Math.floor(Math.random() * (GAME_CONFIG.MAP_WIDTH - half * 2)) + half;
    const y = Math.floor(Math.random() * (GAME_CONFIG.MAP_HEIGHT - half * 2)) + half;

    if (!isSpawnClear(x, y)) {
      continue;
    }

    const nearest = distanceToClosestAlivePlayer(x, y, excludePlayerId);
    if (nearest === Infinity || nearest >= MIN_SPAWN_DISTANCE) {
      return { x, y };
    }

    if (nearest > bestDistance) {
      bestDistance = nearest;
      bestPoint = { x, y };
    }
  }

  if (bestPoint) {
    return bestPoint;
  }

  return {
    x: GAME_CONFIG.MAP_WIDTH / 2,
    y: GAME_CONFIG.MAP_HEIGHT / 2
  };
}

function generateObstacles() {
  const generated = [];
  const minSize = 70;
  const maxSize = 170;
  const margin = 40;
  const centerSafeWidth = 220;
  const centerSafeHeight = 150;
  let attempts = 0;

  while (generated.length < GAME_CONFIG.OBSTACLE_COUNT && attempts < 900) {
    attempts += 1;

    const width = minSize + Math.floor(Math.random() * (maxSize - minSize));
    const height = minSize + Math.floor(Math.random() * (maxSize - minSize));
    const x = margin + Math.floor(Math.random() * (GAME_CONFIG.MAP_WIDTH - width - margin * 2));
    const y = margin + Math.floor(Math.random() * (GAME_CONFIG.MAP_HEIGHT - height - margin * 2));

    const candidate = { x, y, width, height };

    const centerX = x + width / 2;
    const centerY = y + height / 2;
    if (
      Math.abs(centerX - GAME_CONFIG.MAP_WIDTH / 2) < centerSafeWidth / 2 &&
      Math.abs(centerY - GAME_CONFIG.MAP_HEIGHT / 2) < centerSafeHeight / 2
    ) {
      continue;
    }

    const padded = {
      x: x - 34,
      y: y - 34,
      width: width + 68,
      height: height + 68
    };

    if (generated.some((obstacle) => checkCollision(padded, obstacle))) {
      continue;
    }

    generated.push(candidate);
  }

  if (generated.length < 8) {
    return [
      { x: 140, y: 120, width: 140, height: 110 },
      { x: 430, y: 140, width: 120, height: 90 },
      { x: 740, y: 140, width: 120, height: 90 },
      { x: 960, y: 120, width: 140, height: 110 },
      { x: 180, y: 520, width: 120, height: 120 },
      { x: 430, y: 530, width: 130, height: 100 },
      { x: 740, y: 530, width: 130, height: 100 },
      { x: 920, y: 520, width: 120, height: 120 }
    ];
  }

  return generated;
}

function activePlayerCount() {
  return Object.keys(gameState.players).length;
}

function activeHumanPlayerCount() {
  return Object.values(gameState.players).filter((player) => !player.isBot).length;
}

function botMatchRequesterCount() {
  return Object.keys(gameState.botMatchRequesters).length;
}

function buildLeaderboard() {
  return Object.entries(gameState.players)
    .map(([id, player]) => ({
      id,
      name: player.name,
      color: player.color,
      score: gameState.scores[id] || 0
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.name.localeCompare(b.name);
    });
}

function emitLeaderboard() {
  io.emit('leaderboardUpdate', {
    leaderboard: buildLeaderboard(),
    eliminations: gameState.eliminations,
    eliminationsToEnd: GAME_CONFIG.ELIMINATIONS_TO_END
  });
}

function publicPlayersState() {
  const snapshot = {};

  for (const [id, player] of Object.entries(gameState.players)) {
    snapshot[id] = {
      id,
      name: player.name,
      x: player.x,
      y: player.y,
      angle: player.angle,
      color: player.color,
      alive: player.alive,
      respawnAt: player.respawnAt || 0
    };
  }

  return snapshot;
}

function emitGameState(force = false) {
  const now = Date.now();
  const minFrameInterval = 1000 / GAME_CONFIG.STATE_BROADCAST_RATE;
  if (!force && now - gameState.lastStateBroadcastAt < minFrameInterval) {
    return;
  }

  gameState.lastStateBroadcastAt = now;

  io.emit('gameState', {
    players: publicPlayersState(),
    lasers: gameState.lasers.map((laser) => ({
      x: laser.x,
      y: laser.y,
      angle: laser.angle,
      color: laser.color
    })),
    roundActive: gameState.roundActive,
    roundEndsAt: gameState.roundEndsAt,
    eliminations: gameState.eliminations,
    eliminationsToEnd: GAME_CONFIG.ELIMINATIONS_TO_END,
    serverTime: now
  });
}

function hasClearShot(x1, y1, x2, y2) {
  for (const obstacle of gameState.obstacles) {
    if (segmentIntersectsRect(x1, y1, x2, y2, obstacle)) {
      return false;
    }
  }

  return true;
}

function normalizeVector(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.000001) {
    return { x: 0, y: 0 };
  }

  return {
    x: x / magnitude,
    y: y / magnitude
  };
}

function chooseSafeDirection(player, desiredX, desiredY) {
  const lookAheadDistance = GAME_CONFIG.PLAYER_SPEED * 0.22;
  const candidates = [
    { x: desiredX, y: desiredY },
    { x: -desiredY, y: desiredX },
    { x: desiredY, y: -desiredX },
    { x: -desiredX, y: -desiredY },
    { x: 0, y: 0 }
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVector(candidate.x, candidate.y);
    const sampleRect = playerRectAt(
      player.x + normalized.x * lookAheadDistance,
      player.y + normalized.y * lookAheadDistance
    );

    if (!collidesWithAnyObstacle(sampleRect)) {
      return normalized;
    }
  }

  return { x: 0, y: 0 };
}

function closestHumanTarget(sourcePlayerId) {
  const source = gameState.players[sourcePlayerId];
  if (!source) {
    return null;
  }

  let bestTarget = null;
  let bestDistance = Infinity;

  for (const [id, player] of Object.entries(gameState.players)) {
    if (id === sourcePlayerId || player.isBot || !player.alive) {
      continue;
    }

    const distance = Math.hypot(player.x - source.x, player.y - source.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTarget = { id, player, distance };
    }
  }

  return bestTarget;
}

function fireLaserFromPlayer(playerId, angleOverride) {
  if (!gameState.roundActive) {
    return false;
  }

  const player = gameState.players[playerId];
  if (!player || !player.alive) {
    return false;
  }

  const now = Date.now();
  if (now - player.lastShot < GAME_CONFIG.LASER_COOLDOWN) {
    return false;
  }

  const angle = typeof angleOverride === 'number' ? angleOverride : player.angle;
  player.angle = angle;
  player.lastShot = now;

  const spawnOffset = GAME_CONFIG.PLAYER_SIZE / 2 + 6;
  const startX = player.x + Math.cos(angle) * spawnOffset;
  const startY = player.y + Math.sin(angle) * spawnOffset;

  if (pointHitsObstacle(startX, startY)) {
    return false;
  }

  const laser = {
    id: `${playerId}-${now}`,
    ownerId: playerId,
    x: startX,
    y: startY,
    prevX: startX,
    prevY: startY,
    vx: Math.cos(angle) * GAME_CONFIG.LASER_SPEED,
    vy: Math.sin(angle) * GAME_CONFIG.LASER_SPEED,
    angle,
    color: player.color,
    ttlMs: GAME_CONFIG.LASER_TTL_MS
  };

  gameState.lasers.push(laser);

  io.emit('laserFired', {
    playerId,
    laser: {
      x: laser.x,
      y: laser.y,
      angle: laser.angle,
      color: laser.color
    }
  });

  return true;
}

function createCpuBotPlayer() {
  if (gameState.players[CPU_BOT_ID]) {
    return;
  }

  const spawn = randomSpawn();

  gameState.players[CPU_BOT_ID] = {
    id: CPU_BOT_ID,
    name: CPU_BOT_NAME,
    color: '#ff8f5a',
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    inputX: 0,
    inputY: 0,
    lastShot: 0,
    alive: true,
    respawnAt: 0,
    isBot: true,
    aiState: {
      strafeDirection: Math.random() < 0.5 ? -1 : 1,
      nextDecisionAt: 0,
      nextDirectionSwapAt: 0,
      nextShotAt: 0
    }
  };

  gameState.scores[CPU_BOT_ID] = gameState.scores[CPU_BOT_ID] || 0;

  io.emit('playerJoined', {
    playerId: CPU_BOT_ID,
    player: {
      id: CPU_BOT_ID,
      name: CPU_BOT_NAME,
      color: gameState.players[CPU_BOT_ID].color,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      alive: true,
      respawnAt: 0
    },
    playerCount: activePlayerCount(),
    maxPlayers: GAME_CONFIG.MAX_PLAYERS
  });

  emitLeaderboard();
  emitGameState(true);
}

function removeCpuBotPlayer() {
  if (!gameState.players[CPU_BOT_ID]) {
    return;
  }

  delete gameState.players[CPU_BOT_ID];
  delete gameState.scores[CPU_BOT_ID];
  gameState.lasers = gameState.lasers.filter((laser) => laser.ownerId !== CPU_BOT_ID);

  io.emit('playerLeft', {
    playerId: CPU_BOT_ID,
    playerCount: activePlayerCount()
  });

  emitLeaderboard();
  emitGameState(true);
}

function syncCpuBotPresence() {
  if (botMatchRequesterCount() > 0 && activeHumanPlayerCount() > 0) {
    createCpuBotPlayer();
    return;
  }

  removeCpuBotPlayer();
}

function clearTimers() {
  if (gameState.autoStartTimeout) {
    clearTimeout(gameState.autoStartTimeout);
    gameState.autoStartTimeout = null;
  }

  if (gameState.autoNextRoundTimeout) {
    clearTimeout(gameState.autoNextRoundTimeout);
    gameState.autoNextRoundTimeout = null;
  }
}

function maybeScheduleRoundStart() {
  if (gameState.roundActive || gameState.autoStartTimeout || activePlayerCount() < GAME_CONFIG.MIN_PLAYERS_TO_START) {
    return;
  }

  gameState.autoStartTimeout = setTimeout(() => {
    gameState.autoStartTimeout = null;
    if (activePlayerCount() >= GAME_CONFIG.MIN_PLAYERS_TO_START && !gameState.roundActive) {
      startRound();
    }
  }, START_COUNTDOWN_MS);

  io.emit('roundQueued', {
    startsInMs: START_COUNTDOWN_MS,
    neededPlayers: GAME_CONFIG.MIN_PLAYERS_TO_START
  });
}

function resetRoundState() {
  gameState.lasers = [];
  gameState.scores = {};
  gameState.eliminations = 0;
  gameState.roundEndsAt = Date.now() + GAME_CONFIG.ROUND_TIME_SECONDS * 1000;

  for (const [id, player] of Object.entries(gameState.players)) {
    const spawn = randomSpawn(id);
    player.x = spawn.x;
    player.y = spawn.y;
    player.inputX = 0;
    player.inputY = 0;
    player.lastShot = 0;
    player.respawnAt = 0;
    player.alive = true;

    if (player.isBot && player.aiState) {
      player.aiState.nextDecisionAt = 0;
      player.aiState.nextDirectionSwapAt = 0;
      player.aiState.nextShotAt = 0;
      player.aiState.strafeDirection = Math.random() < 0.5 ? -1 : 1;
    }

    gameState.scores[id] = 0;
  }
}

function startRound() {
  if (activePlayerCount() < GAME_CONFIG.MIN_PLAYERS_TO_START) {
    io.emit('waiting', {
      message: `Waiting for at least ${GAME_CONFIG.MIN_PLAYERS_TO_START} players...`
    });
    return;
  }

  clearTimers();
  gameState.roundActive = true;
  gameState.roundNumber += 1;
  resetRoundState();

  io.emit('roundStart', {
    roundNumber: gameState.roundNumber,
    players: publicPlayersState(),
    scores: gameState.scores,
    roundEndsAt: gameState.roundEndsAt,
    eliminations: gameState.eliminations,
    eliminationsToEnd: GAME_CONFIG.ELIMINATIONS_TO_END,
    config: {
      respawnTimeMs: GAME_CONFIG.RESPAWN_TIME,
      roundTimeSeconds: GAME_CONFIG.ROUND_TIME_SECONDS
    }
  });

  emitLeaderboard();
  emitGameState(true);
}

function endRound(reason) {
  if (!gameState.roundActive) {
    return;
  }

  gameState.roundActive = false;

  const leaderboard = buildLeaderboard();
  const top3 = leaderboard.slice(0, 3);

  io.emit('roundEnd', {
    reason,
    top3,
    leaderboard,
    eliminations: gameState.eliminations,
    eliminationsToEnd: GAME_CONFIG.ELIMINATIONS_TO_END,
    nextRoundInMs: NEXT_ROUND_DELAY_MS
  });

  gameState.lasers = [];
  emitGameState(true);

  gameState.autoNextRoundTimeout = setTimeout(() => {
    gameState.autoNextRoundTimeout = null;
    if (activePlayerCount() >= GAME_CONFIG.MIN_PLAYERS_TO_START) {
      startRound();
    } else {
      io.emit('waiting', {
        message: `Waiting for at least ${GAME_CONFIG.MIN_PLAYERS_TO_START} players...`
      });
    }
  }, NEXT_ROUND_DELAY_MS);
}

function movePlayerWithCollisions(player, stepX, stepY) {
  const half = GAME_CONFIG.PLAYER_SIZE / 2;

  if (stepX !== 0) {
    const nextX = clamp(player.x + stepX, half, GAME_CONFIG.MAP_WIDTH - half);
    const xRect = playerRectAt(nextX, player.y);
    if (!collidesWithAnyObstacle(xRect)) {
      player.x = nextX;
    }
  }

  if (stepY !== 0) {
    const nextY = clamp(player.y + stepY, half, GAME_CONFIG.MAP_HEIGHT - half);
    const yRect = playerRectAt(player.x, nextY);
    if (!collidesWithAnyObstacle(yRect)) {
      player.y = nextY;
    }
  }
}

function handleElimination(victimId, shooterId) {
  const victim = gameState.players[victimId];
  if (!victim || !victim.alive) {
    return;
  }

  victim.alive = false;
  victim.inputX = 0;
  victim.inputY = 0;
  victim.respawnAt = Date.now() + GAME_CONFIG.RESPAWN_TIME;

  if (gameState.players[shooterId]) {
    gameState.scores[shooterId] = (gameState.scores[shooterId] || 0) + 1;
  }

  gameState.eliminations += 1;

  io.emit('playerHit', {
    playerId: victimId,
    shooterId,
    scores: gameState.scores,
    eliminations: gameState.eliminations,
    eliminationsToEnd: GAME_CONFIG.ELIMINATIONS_TO_END,
    respawnAt: victim.respawnAt
  });

  emitLeaderboard();

  if (gameState.eliminations >= GAME_CONFIG.ELIMINATIONS_TO_END) {
    endRound('eliminationLimit');
  }
}

function respawnPlayer(playerId) {
  const player = gameState.players[playerId];
  if (!player || player.alive || !gameState.roundActive) {
    return;
  }

  const spawn = randomSpawn(playerId);
  player.x = spawn.x;
  player.y = spawn.y;
  player.alive = true;
  player.respawnAt = 0;
  player.inputX = 0;
  player.inputY = 0;

  io.emit('playerRespawn', {
    playerId,
    x: player.x,
    y: player.y
  });
}

function updatePlayers(deltaSeconds) {
  const step = GAME_CONFIG.PLAYER_SPEED * deltaSeconds;

  for (const player of Object.values(gameState.players)) {
    if (!player.alive) {
      continue;
    }

    const stepX = player.inputX * step;
    const stepY = player.inputY * step;

    movePlayerWithCollisions(player, stepX, stepY);
  }
}

function updateCpuBot(now) {
  const bot = gameState.players[CPU_BOT_ID];
  if (!bot || !bot.alive || !gameState.roundActive) {
    return;
  }

  const targetInfo = closestHumanTarget(CPU_BOT_ID);
  if (!targetInfo) {
    bot.inputX = 0;
    bot.inputY = 0;
    return;
  }

  const { player: target, distance } = targetInfo;
  const offsetX = target.x - bot.x;
  const offsetY = target.y - bot.y;
  const toTarget = normalizeVector(offsetX, offsetY);
  const clearShot = hasClearShot(bot.x, bot.y, target.x, target.y);

  if (now >= bot.aiState.nextDirectionSwapAt) {
    bot.aiState.strafeDirection *= Math.random() < 0.68 ? 1 : -1;
    bot.aiState.nextDirectionSwapAt = now + 900 + Math.floor(Math.random() * 900);
  }

  if (now >= bot.aiState.nextDecisionAt) {
    const strafeX = -toTarget.y * bot.aiState.strafeDirection;
    const strafeY = toTarget.x * bot.aiState.strafeDirection;

    let desiredX = 0;
    let desiredY = 0;

    if (!clearShot) {
      desiredX = strafeX;
      desiredY = strafeY;
    } else if (distance > 360) {
      desiredX = toTarget.x * 0.72;
      desiredY = toTarget.y * 0.72;
    } else if (distance < 180) {
      desiredX = -toTarget.x;
      desiredY = -toTarget.y;
    } else {
      desiredX = strafeX + toTarget.x * 0.15;
      desiredY = strafeY + toTarget.y * 0.15;
    }

    const safeDirection = chooseSafeDirection(bot, desiredX, desiredY);
    bot.inputX = safeDirection.x;
    bot.inputY = safeDirection.y;
    bot.aiState.nextDecisionAt = now + 120 + Math.floor(Math.random() * 140);
  }

  const aimAngle = Math.atan2(offsetY, offsetX);
  bot.angle = aimAngle;

  if (clearShot && distance < 500 && now >= bot.aiState.nextShotAt && Math.random() < 0.72) {
    const errorDegrees = Math.random() * 10;
    const errorRadians = (errorDegrees * Math.PI) / 180;
    const jitterDirection = Math.random() < 0.5 ? -1 : 1;
    fireLaserFromPlayer(CPU_BOT_ID, aimAngle + errorRadians * jitterDirection);
    bot.aiState.nextShotAt = now + 260 + Math.floor(Math.random() * 220);
  }
}

function updateLasers(deltaSeconds) {
  const survivors = [];

  for (const laser of gameState.lasers) {
    laser.prevX = laser.x;
    laser.prevY = laser.y;

    laser.x += laser.vx * deltaSeconds;
    laser.y += laser.vy * deltaSeconds;
    laser.ttlMs -= deltaSeconds * 1000;

    if (
      laser.ttlMs <= 0 ||
      laser.x < 0 ||
      laser.x > GAME_CONFIG.MAP_WIDTH ||
      laser.y < 0 ||
      laser.y > GAME_CONFIG.MAP_HEIGHT
    ) {
      continue;
    }

    let obstacleHit = false;
    for (const obstacle of gameState.obstacles) {
      if (segmentIntersectsRect(laser.prevX, laser.prevY, laser.x, laser.y, obstacle)) {
        obstacleHit = true;
        break;
      }
    }
    if (obstacleHit) {
      continue;
    }

    let playerHit = false;
    for (const [playerId, player] of Object.entries(gameState.players)) {
      if (!player.alive || playerId === laser.ownerId) {
        continue;
      }

      if (segmentIntersectsRect(laser.prevX, laser.prevY, laser.x, laser.y, playerRectAt(player.x, player.y))) {
        playerHit = true;
        handleElimination(playerId, laser.ownerId);
        break;
      }
    }

    if (!playerHit) {
      survivors.push(laser);
    }
  }

  gameState.lasers = survivors;
}

function updateRespawns(now) {
  for (const [id, player] of Object.entries(gameState.players)) {
    if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
      respawnPlayer(id);
    }
  }
}

function gameLoop() {
  const now = Date.now();

  if (!gameState.roundActive) {
    return;
  }

  const deltaSeconds = 1 / GAME_CONFIG.TICK_RATE;

  updateCpuBot(now);
  updatePlayers(deltaSeconds);
  updateLasers(deltaSeconds);
  updateRespawns(now);

  if (now >= gameState.roundEndsAt) {
    endRound('timeLimit');
    return;
  }

  emitGameState(false);
}

setInterval(gameLoop, 1000 / GAME_CONFIG.TICK_RATE);

gameState.obstacles = generateObstacles();

io.on('connection', (socket) => {
  socket.data.joined = false;
  socket.data.wantsBotMatch = false;

  socket.emit('welcome', {
    config: GAME_CONFIG,
    currentPlayers: activePlayerCount(),
    maxPlayers: GAME_CONFIG.MAX_PLAYERS,
    obstacles: gameState.obstacles
  });

  socket.on('joinGame', (payload = {}) => {
    if (socket.data.joined) {
      return;
    }

    if (activePlayerCount() >= GAME_CONFIG.MAX_PLAYERS) {
      socket.emit('gameFull', {
        message: `Arena is full (${GAME_CONFIG.MAX_PLAYERS} players). Try again shortly.`
      });
      socket.disconnect();
      return;
    }

    const name = sanitizeName(payload.name);
    socket.data.wantsBotMatch = Boolean(payload.vsBot);

    if (socket.data.wantsBotMatch) {
      gameState.botMatchRequesters[socket.id] = true;
    }

    const spawn = randomSpawn();

    gameState.players[socket.id] = {
      id: socket.id,
      name,
      color: randomTankColor(),
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      inputX: 0,
      inputY: 0,
      lastShot: 0,
      alive: true,
      respawnAt: 0,
      isBot: false
    };

    if (typeof gameState.scores[socket.id] !== 'number') {
      gameState.scores[socket.id] = 0;
    }

    socket.data.joined = true;
    syncCpuBotPresence();

    socket.emit('init', {
      playerId: socket.id,
      config: GAME_CONFIG,
      obstacles: gameState.obstacles,
      players: publicPlayersState(),
      scores: gameState.scores,
      leaderboard: buildLeaderboard(),
      roundActive: gameState.roundActive,
      roundEndsAt: gameState.roundEndsAt,
      eliminations: gameState.eliminations,
      eliminationsToEnd: GAME_CONFIG.ELIMINATIONS_TO_END
    });

    io.emit('playerJoined', {
      playerId: socket.id,
      player: {
        id: socket.id,
        name,
        color: gameState.players[socket.id].color,
        x: spawn.x,
        y: spawn.y,
        angle: 0,
        alive: true,
        respawnAt: 0
      },
      playerCount: activePlayerCount(),
      maxPlayers: GAME_CONFIG.MAX_PLAYERS
    });

    emitLeaderboard();
    emitGameState(true);
    maybeScheduleRoundStart();
  });

  socket.on('input', (payload = {}) => {
    if (!socket.data.joined) {
      return;
    }

    const player = gameState.players[socket.id];
    if (!player) {
      return;
    }

    if (typeof payload.angle === 'number') {
      player.angle = payload.angle;
    }

    const rawX = Number(payload.moveX || 0);
    const rawY = Number(payload.moveY || 0);

    const mag = Math.hypot(rawX, rawY);
    if (mag > 1) {
      player.inputX = rawX / mag;
      player.inputY = rawY / mag;
    } else {
      player.inputX = rawX;
      player.inputY = rawY;
    }
  });

  socket.on('shoot', (payload = {}) => {
    if (!socket.data.joined || !gameState.roundActive) {
      return;
    }

    fireLaserFromPlayer(socket.id, payload.angle);
  });

  socket.on('setName', (payload = {}) => {
    if (!socket.data.joined) {
      return;
    }

    const player = gameState.players[socket.id];
    if (!player) {
      return;
    }

    player.name = sanitizeName(payload.name);
    emitLeaderboard();
    emitGameState(true);
  });

  socket.on('disconnect', () => {
    if (!socket.data.joined) {
      return;
    }

    delete gameState.botMatchRequesters[socket.id];
    delete gameState.players[socket.id];
    delete gameState.scores[socket.id];
    syncCpuBotPresence();

    io.emit('playerLeft', {
      playerId: socket.id,
      playerCount: activePlayerCount()
    });

    emitLeaderboard();

    if (gameState.roundActive && activePlayerCount() < GAME_CONFIG.MIN_PLAYERS_TO_START) {
      endRound('notEnoughPlayers');
    }

    maybeScheduleRoundStart();
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Laser Arena running on http://0.0.0.0:${PORT}`);
  console.log(`Max players: ${GAME_CONFIG.MAX_PLAYERS}, eliminations to end: ${GAME_CONFIG.ELIMINATIONS_TO_END}`);
});
