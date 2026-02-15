class LaserArena extends Phaser.Scene {
  constructor() {
    super({ key: 'LaserArena' });
    this.socket = null;
    this.connected = false;
    this.joined = false;

    this.playerId = null;
    this.configFromServer = null;

    this.players = {};
    this.playerSprites = {};
    this.obstacles = [];
    this.lasers = [];

    this.roundActive = false;
    this.roundEndsAt = 0;
    this.eliminations = 0;
    this.eliminationsToEnd = 20;

    this.mouseAngle = 0;
    this.isAlive = true;
    this.localRespawnAt = 0;

    this.keys = null;
    this.lastInputSentAt = 0;
    this.lastInputState = { moveX: 0, moveY: 0, angle: 0 };

    this.obstacleGraphics = null;
    this.laserGraphics = null;
  }

  create() {
    this.cameras.main.setBackgroundColor('#0f1428');

    this.obstacleGraphics = this.add.graphics();
    this.laserGraphics = this.add.graphics();

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });

    this.input.on('pointermove', (pointer) => {
      const local = this.playerSprites[this.playerId];
      if (!local) {
        return;
      }

      this.mouseAngle = Phaser.Math.Angle.Between(local.x, local.y, pointer.worldX, pointer.worldY);
    });

    this.input.on('pointerdown', () => {
      if (this.joined && this.roundActive && this.isAlive) {
        this.socket.emit('shoot', { angle: this.mouseAngle });
      }
    });

    this.drawArenaBorder();
    this.setupJoinUi();
    this.connectToServer();
  }

  setupJoinUi() {
    const joinOverlay = document.getElementById('join-overlay');
    const joinButton = document.getElementById('join-btn');
    const nameInput = document.getElementById('player-name');
    const nameUpdateButton = document.getElementById('rename-btn');
    const nameUpdateInput = document.getElementById('rename-input');

    const submitJoin = () => {
      const name = (nameInput.value || '').trim();
      if (!name) {
        this.setJoinStatus('Enter a display name first.');
        return;
      }

      if (!this.connected) {
        this.setJoinStatus('Connecting...');
        return;
      }

      this.socket.emit('joinGame', { name });
      this.setJoinStatus('Joining arena...');
    };

    joinButton.addEventListener('click', submitJoin);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        submitJoin();
      }
    });

    nameUpdateButton.addEventListener('click', () => {
      const nextName = (nameUpdateInput.value || '').trim();
      if (!nextName || !this.joined) {
        return;
      }

      this.socket.emit('setName', { name: nextName });
      nameUpdateInput.value = '';
    });

    nameUpdateInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        nameUpdateButton.click();
      }
    });

    joinOverlay.classList.remove('hidden');
  }

  connectToServer() {
    this.socket = io();

    this.socket.on('connect', () => {
      this.connected = true;
      this.setJoinStatus('Connected. Pick a name and join.');
      this.setBanner('Connected. Waiting to join...');
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.joined = false;
      this.roundActive = false;
      this.setBanner('Disconnected. Refresh to reconnect.');
    });

    this.socket.on('welcome', (data) => {
      this.configFromServer = data.config;
      this.obstacles = data.obstacles || [];
      this.drawObstacles();

      const seats = `${data.currentPlayers}/${data.maxPlayers}`;
      this.setJoinStatus(`Arena occupancy: ${seats}`);
      this.setMeta(`Players: ${seats}`);
    });

    this.socket.on('gameFull', (data) => {
      this.setJoinStatus(data.message || 'Game is full.');
      this.setBanner('Arena full. Try another server.');
    });

    this.socket.on('init', (data) => {
      this.joined = true;
      this.playerId = data.playerId;
      this.players = data.players || {};
      this.obstacles = data.obstacles || this.obstacles;
      this.eliminations = data.eliminations || 0;
      this.eliminationsToEnd = data.eliminationsToEnd || this.eliminationsToEnd;
      this.roundActive = Boolean(data.roundActive);
      this.roundEndsAt = data.roundEndsAt || 0;

      this.drawObstacles();
      this.syncPlayerSprites();
      this.updateLeaderboard(data.leaderboard || []);
      this.updateRoundStatus();

      const joinOverlay = document.getElementById('join-overlay');
      joinOverlay.classList.add('hidden');

      if (this.roundActive) {
        this.setBanner('Round in progress. Fight.');
      } else {
        this.setBanner('Waiting for round start...');
      }

      this.showHud();
    });

    this.socket.on('roundQueued', (data) => {
      const seconds = Math.ceil((data.startsInMs || 0) / 1000);
      this.setBanner(`Round starts in ${seconds}s...`);
    });

    this.socket.on('waiting', (data) => {
      this.setBanner(data.message || 'Waiting for players...');
    });

    this.socket.on('playerJoined', (data) => {
      this.players[data.playerId] = data.player;
      this.syncPlayerSprites();
      this.setMeta(`Players: ${data.playerCount}/${data.maxPlayers || this.configFromServer?.MAX_PLAYERS || 40}`);
    });

    this.socket.on('playerLeft', (data) => {
      delete this.players[data.playerId];
      this.removePlayerSprite(data.playerId);
      this.setMeta(`Players: ${data.playerCount}/${this.configFromServer?.MAX_PLAYERS || 40}`);
    });

    this.socket.on('gameState', (data) => {
      this.roundActive = Boolean(data.roundActive);
      this.roundEndsAt = data.roundEndsAt || 0;
      this.eliminations = data.eliminations || 0;
      this.eliminationsToEnd = data.eliminationsToEnd || this.eliminationsToEnd;

      this.lasers = data.lasers || [];
      this.players = data.players || {};
      this.syncPlayerSprites();
      this.applyPlayerSnapshot();
      this.updateRoundStatus();
    });

    this.socket.on('leaderboardUpdate', (data) => {
      this.eliminations = data.eliminations || this.eliminations;
      this.eliminationsToEnd = data.eliminationsToEnd || this.eliminationsToEnd;
      this.updateLeaderboard(data.leaderboard || []);
      this.updateRoundStatus();
    });

    this.socket.on('playerHit', (data) => {
      const victimSprite = this.playerSprites[data.playerId];
      if (victimSprite) {
        this.createDeathEffect(victimSprite.x, victimSprite.y, this.players[data.playerId]?.color || '#ffffff');
        victimSprite.setVisible(false);
      }

      const killerName = this.players[data.shooterId]?.name || 'Pilot';
      const victimName = this.players[data.playerId]?.name || 'Pilot';
      this.addKillFeed(`${killerName} eliminated ${victimName}`);

      if (data.playerId === this.playerId) {
        this.isAlive = false;
        this.localRespawnAt = data.respawnAt || 0;
        this.cameras.main.shake(150, 0.01);
      }

      this.eliminations = data.eliminations || this.eliminations;
      this.eliminationsToEnd = data.eliminationsToEnd || this.eliminationsToEnd;
      this.updateRoundStatus();
    });

    this.socket.on('playerRespawn', (data) => {
      if (this.playerSprites[data.playerId]) {
        this.playerSprites[data.playerId].x = data.x;
        this.playerSprites[data.playerId].y = data.y;
        this.playerSprites[data.playerId].setVisible(true);
      }

      this.createSpawnEffect(data.x, data.y);

      if (data.playerId === this.playerId) {
        this.isAlive = true;
        this.localRespawnAt = 0;
      }
    });

    this.socket.on('roundStart', (data) => {
      this.roundActive = true;
      this.roundEndsAt = data.roundEndsAt || 0;
      this.eliminations = data.eliminations || 0;
      this.eliminationsToEnd = data.eliminationsToEnd || this.eliminationsToEnd;
      this.players = data.players || this.players;
      this.isAlive = true;
      this.localRespawnAt = 0;

      this.syncPlayerSprites();
      this.applyPlayerSnapshot(true);
      this.clearKillFeed();
      this.setBanner(`Round ${data.roundNumber} live`);
      this.updateRoundStatus();
      this.cameras.main.flash(220, 255, 255, 255);
    });

    this.socket.on('roundEnd', (data) => {
      this.roundActive = false;
      this.isAlive = true;
      this.localRespawnAt = 0;
      this.showVictory(data.top3 || [], data.nextRoundInMs || 0, data.reason);
      this.updateLeaderboard(data.leaderboard || []);
      this.updateRoundStatus();
    });

    this.socket.on('laserFired', (data) => {
      const laser = data.laser;
      if (laser) {
        this.createMuzzleFlash(laser.x, laser.y, laser.color || '#ffffff');
      }
    });
  }

  drawArenaBorder() {
    const border = this.add.graphics();
    border.lineStyle(3, 0x344264, 1);
    border.strokeRect(0, 0, 1200, 800);

    border.lineStyle(1, 0x1b2742, 0.5);
    for (let x = 0; x < 1200; x += 50) {
      border.lineBetween(x, 0, x, 800);
    }

    for (let y = 0; y < 800; y += 50) {
      border.lineBetween(0, y, 1200, y);
    }
  }

  drawObstacles() {
    this.obstacleGraphics.clear();

    for (const obstacle of this.obstacles) {
      this.obstacleGraphics.fillStyle(0x2c3045, 1);
      this.obstacleGraphics.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);

      this.obstacleGraphics.lineStyle(2, 0x5f6ea1, 0.9);
      this.obstacleGraphics.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);

      this.obstacleGraphics.lineStyle(1, 0x8ea2e6, 0.25);
      this.obstacleGraphics.strokeRect(
        obstacle.x + 4,
        obstacle.y + 4,
        Math.max(0, obstacle.width - 8),
        Math.max(0, obstacle.height - 8)
      );
    }
  }

  syncPlayerSprites() {
    const ids = new Set(Object.keys(this.players));

    for (const id of Object.keys(this.playerSprites)) {
      if (!ids.has(id)) {
        this.removePlayerSprite(id);
      }
    }

    for (const [id, player] of Object.entries(this.players)) {
      if (!this.playerSprites[id]) {
        this.playerSprites[id] = this.createPlayerSprite(player);
      }
    }
  }

  createPlayerSprite(player) {
    const container = this.add.container(player.x, player.y);
    container.setDepth(20);

    const body = this.add.graphics();
    const color = Phaser.Display.Color.HexStringToColor(player.color || '#00ffff').color;

    body.fillStyle(color, 1);
    body.fillRoundedRect(-12, -10, 24, 20, 5);

    body.fillStyle(0x0f1117, 0.3);
    body.fillRoundedRect(-8, -6, 16, 12, 3);

    body.fillStyle(color, 1);
    body.fillRect(0, -3, 18, 6);

    body.lineStyle(2, color, 0.6);
    body.strokeRoundedRect(-13, -11, 26, 22, 5);

    const label = this.add.text(0, -23, player.name, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: player.color || '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    container.add([body, label]);
    return container;
  }

  applyPlayerSnapshot(snapImmediately = false) {
    for (const [id, player] of Object.entries(this.players)) {
      const sprite = this.playerSprites[id];
      if (!sprite) {
        continue;
      }

      if (id === this.playerId || snapImmediately) {
        sprite.x = player.x;
        sprite.y = player.y;
      } else {
        sprite.x = Phaser.Math.Linear(sprite.x, player.x, 0.35);
        sprite.y = Phaser.Math.Linear(sprite.y, player.y, 0.35);
      }

      sprite.rotation = player.angle || 0;
      sprite.setVisible(Boolean(player.alive));

      if (id === this.playerId) {
        this.isAlive = Boolean(player.alive);
        if (player.respawnAt) {
          this.localRespawnAt = player.respawnAt;
        }
      }
    }
  }

  removePlayerSprite(id) {
    const sprite = this.playerSprites[id];
    if (!sprite) {
      return;
    }

    sprite.destroy(true);
    delete this.playerSprites[id];
  }

  drawLasers() {
    this.laserGraphics.clear();

    for (const laser of this.lasers) {
      const color = Phaser.Display.Color.HexStringToColor(laser.color || '#ffffff').color;
      this.laserGraphics.lineStyle(5, color, 0.2);
      this.laserGraphics.lineBetween(
        laser.x - Math.cos(laser.angle) * 18,
        laser.y - Math.sin(laser.angle) * 18,
        laser.x,
        laser.y
      );

      this.laserGraphics.lineStyle(2, color, 1);
      this.laserGraphics.lineBetween(
        laser.x - Math.cos(laser.angle) * 12,
        laser.y - Math.sin(laser.angle) * 12,
        laser.x,
        laser.y
      );

      this.laserGraphics.lineStyle(1, 0xffffff, 1);
      this.laserGraphics.lineBetween(
        laser.x - Math.cos(laser.angle) * 8,
        laser.y - Math.sin(laser.angle) * 8,
        laser.x,
        laser.y
      );
    }
  }

  update(_time, _delta) {
    if (!this.joined) {
      return;
    }

    this.drawLasers();
    this.updateRespawnUi();

    const localSprite = this.playerSprites[this.playerId];
    if (!localSprite) {
      return;
    }

    let moveX = 0;
    let moveY = 0;

    if (this.keys.left.isDown) {
      moveX -= 1;
    }
    if (this.keys.right.isDown) {
      moveX += 1;
    }
    if (this.keys.up.isDown) {
      moveY -= 1;
    }
    if (this.keys.down.isDown) {
      moveY += 1;
    }

    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }

    const now = Date.now();
    const angleChanged = Math.abs(this.lastInputState.angle - this.mouseAngle) > 0.015;
    const moveChanged = this.lastInputState.moveX !== moveX || this.lastInputState.moveY !== moveY;
    const stale = now - this.lastInputSentAt > 50;

    if (stale || moveChanged || angleChanged) {
      this.socket.emit('input', {
        moveX,
        moveY,
        angle: this.mouseAngle
      });

      this.lastInputState = {
        moveX,
        moveY,
        angle: this.mouseAngle
      };
      this.lastInputSentAt = now;
    }
  }

  updateLeaderboard(entries) {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';

    entries.slice(0, 10).forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      if (entry.id === this.playerId) {
        row.classList.add('is-me');
      }

      row.innerHTML = `
        <span class="rank">#${index + 1}</span>
        <span class="name" style="color:${entry.color}">${this.escapeHtml(entry.name)}</span>
        <span class="score">${entry.score}</span>
      `;
      list.appendChild(row);
    });

    if (!entries.length) {
      list.innerHTML = '<div class="leaderboard-row empty">Waiting for players...</div>';
    }
  }

  updateRoundStatus() {
    const status = document.getElementById('round-status');

    let timeText = '--';
    if (this.roundEndsAt) {
      const seconds = Math.max(0, Math.ceil((this.roundEndsAt - Date.now()) / 1000));
      timeText = `${seconds}s`;
    }

    status.textContent = `Eliminations ${this.eliminations}/${this.eliminationsToEnd} | Time ${timeText}`;
  }

  updateRespawnUi() {
    const respawn = document.getElementById('respawn-timer');
    if (!this.roundActive || this.isAlive || !this.localRespawnAt) {
      respawn.classList.add('hidden');
      return;
    }

    const remainMs = Math.max(0, this.localRespawnAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    respawn.textContent = `Respawning in ${remainSec}s`;
    respawn.classList.remove('hidden');
  }

  showVictory(top3, nextRoundMs, reason) {
    const overlay = document.getElementById('victory-overlay');
    const list = document.getElementById('victory-top3');
    const subtitle = document.getElementById('victory-subtitle');

    const reasonLabel = reason === 'eliminationLimit' ? '20 eliminations reached' : 'Round ended';
    subtitle.textContent = `${reasonLabel}. Next round in ${Math.ceil(nextRoundMs / 1000)}s.`;

    list.innerHTML = '';
    top3.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'podium-row';
      row.innerHTML = `
        <span>#${i + 1}</span>
        <strong style="color:${entry.color}">${this.escapeHtml(entry.name)}</strong>
        <span>${entry.score}</span>
      `;
      list.appendChild(row);
    });

    if (!top3.length) {
      list.innerHTML = '<div class="podium-row">No results</div>';
    }

    overlay.classList.remove('hidden');

    setTimeout(() => {
      overlay.classList.add('hidden');
    }, Math.max(nextRoundMs - 500, 1000));
  }

  showHud() {
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('controls-hint').classList.remove('hidden');
  }

  setBanner(text) {
    document.getElementById('banner-text').textContent = text;
  }

  setJoinStatus(text) {
    document.getElementById('join-status').textContent = text;
  }

  setMeta(text) {
    document.getElementById('meta-text').textContent = text;
  }

  addKillFeed(text) {
    const container = document.getElementById('kill-feed');
    const row = document.createElement('div');
    row.className = 'kill-entry';
    row.textContent = text;

    container.insertBefore(row, container.firstChild);

    while (container.children.length > 6) {
      container.removeChild(container.lastChild);
    }

    setTimeout(() => {
      if (row.parentNode) {
        row.remove();
      }
    }, 4500);
  }

  clearKillFeed() {
    document.getElementById('kill-feed').innerHTML = '';
  }

  createDeathEffect(x, y, colorHex) {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const circle = this.add.circle(x, y, 16, color, 0.6);
    circle.setDepth(30);
    this.tweens.add({
      targets: circle,
      scale: 2.2,
      alpha: 0,
      duration: 220,
      onComplete: () => circle.destroy()
    });
  }

  createSpawnEffect(x, y) {
    const circle = this.add.circle(x, y, 22, 0xffffff, 0.55);
    circle.setDepth(30);
    this.tweens.add({
      targets: circle,
      scale: 1.8,
      alpha: 0,
      duration: 180,
      onComplete: () => circle.destroy()
    });
  }

  createMuzzleFlash(x, y, colorHex) {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const flash = this.add.circle(x, y, 5, color, 1);
    flash.setDepth(25);
    this.tweens.add({
      targets: flash,
      scale: 0.1,
      alpha: 0,
      duration: 70,
      onComplete: () => flash.destroy()
    });
  }

  escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

const config = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  parent: 'game-container',
  backgroundColor: '#0f1428',
  scene: LaserArena,
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  pixelArt: true,
  antialias: false
};

new Phaser.Game(config);
