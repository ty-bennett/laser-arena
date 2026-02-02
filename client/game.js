// Laser Arena - Game Client
// Top-down 2D multiplayer shooter

class LaserArena extends Phaser.Scene {
  constructor() {
    super({ key: 'LaserArena' });
    this.socket = null;
    this.playerId = null;
    this.config = null;
    this.obstacles = [];
    this.players = {};
    this.playerSprites = {};
    this.lasers = [];
    this.laserGraphics = null;
    this.keys = null;
    this.mouseAngle = 0;
    this.isAlive = true;
    this.roundActive = false;
  }

  preload() {
    // We'll generate sprites programmatically for that crisp pixel look
  }

  create() {
    // Set up graphics
    this.cameras.main.setBackgroundColor('#1a1a2e');
    
    // Create graphics objects
    this.obstacleGraphics = this.add.graphics();
    this.laserGraphics = this.add.graphics();
    this.playerGraphics = this.add.graphics();
    
    // Input
    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
    
    // Mouse tracking
    this.input.on('pointermove', (pointer) => {
      if (this.playerSprites[this.playerId]) {
        const player = this.playerSprites[this.playerId];
        this.mouseAngle = Phaser.Math.Angle.Between(
          player.x, player.y,
          pointer.x, pointer.y
        );
      }
    });
    
    // Shooting
    this.input.on('pointerdown', () => {
      if (this.roundActive && this.isAlive) {
        this.socket.emit('shoot', { angle: this.mouseAngle });
      }
    });
    
    // Connect to server
    this.connectToServer();
    
    // Draw arena border
    this.drawArenaBorder();
  }

  drawArenaBorder() {
    const border = this.add.graphics();
    border.lineStyle(4, 0x333366, 1);
    border.strokeRect(0, 0, 1200, 800);
    
    // Grid lines for visual effect
    border.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < 1200; x += 50) {
      border.lineBetween(x, 0, x, 800);
    }
    for (let y = 0; y < 800; y += 50) {
      border.lineBetween(0, y, 1200, y);
    }
  }

  drawObstacles() {
    this.obstacleGraphics.clear();
    
    for (const obs of this.obstacles) {
      // Main block
      this.obstacleGraphics.fillStyle(0x2a2a4a, 1);
      this.obstacleGraphics.fillRect(obs.x, obs.y, obs.width, obs.height);
      
      // Border glow
      this.obstacleGraphics.lineStyle(2, 0x4a4a7a, 1);
      this.obstacleGraphics.strokeRect(obs.x, obs.y, obs.width, obs.height);
      
      // Inner detail
      this.obstacleGraphics.lineStyle(1, 0x3a3a5a, 0.5);
      this.obstacleGraphics.strokeRect(obs.x + 4, obs.y + 4, obs.width - 8, obs.height - 8);
    }
  }

  connectToServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = io();
    
    this.socket.on('connect', () => {
      this.updateMessage('Connected! Waiting for players...');
    });
    
    this.socket.on('init', (data) => {
      this.playerId = data.playerId;
      this.config = data.config;
      this.obstacles = data.obstacles;
      this.players = data.players;
      
      this.drawObstacles();
      this.createPlayerSprites();
      
      const playerCount = Object.keys(data.players).length;
      if (playerCount < 2) {
        this.updateMessage('Waiting for opponent...', 'Share the URL with a friend!');
      }
    });
    
    this.socket.on('gameFull', (data) => {
      this.updateMessage('Game Full', data.message);
    });
    
    this.socket.on('playerJoined', (data) => {
      this.players[data.playerId] = data.player;
      this.createPlayerSprite(data.playerId, data.player);
      
      if (data.playerCount === 2) {
        this.updateMessage('OPPONENT FOUND!', 'Get ready...');
      }
    });
    
    this.socket.on('playerLeft', (data) => {
      if (this.playerSprites[data.playerId]) {
        this.playerSprites[data.playerId].destroy();
        delete this.playerSprites[data.playerId];
      }
      delete this.players[data.playerId];
      
      if (data.playerCount < 2) {
        this.updateMessage('Opponent disconnected', 'Waiting for new player...');
      }
    });
    
    this.socket.on('roundStart', (data) => {
      this.roundActive = true;
      this.isAlive = true;
      this.players = data.players;
      
      // Reset player positions
      for (const [id, player] of Object.entries(data.players)) {
        if (this.playerSprites[id]) {
          this.playerSprites[id].x = player.x;
          this.playerSprites[id].y = player.y;
          this.playerSprites[id].setVisible(true);
        }
      }
      
      this.updateScores(data.scores);
      this.hideMessage();
      this.showHUD();
      
      // Flash effect
      this.cameras.main.flash(500, 255, 255, 255);
    });
    
    this.socket.on('roundEnd', (data) => {
      this.roundActive = false;
      
      let title, subtitle;
      if (data.tie) {
        title = "DRAW!";
        subtitle = "No winner this round";
      } else if (data.winner === this.playerId) {
        title = "🏆 VICTORY! 🏆";
        subtitle = "You dominated the arena!";
      } else {
        title = "DEFEATED";
        subtitle = `${data.winnerName} wins!`;
      }
      
      this.updateMessage(title, subtitle + '\n\nNext round starting soon...');
      this.hideHUD();
    });
    
    this.socket.on('gameState', (data) => {
      // Update player positions
      for (const [id, player] of Object.entries(data.players)) {
        if (this.playerSprites[id]) {
          // Smooth interpolation for other players
          if (id !== this.playerId) {
            this.playerSprites[id].x = Phaser.Math.Linear(
              this.playerSprites[id].x, player.x, 0.3
            );
            this.playerSprites[id].y = Phaser.Math.Linear(
              this.playerSprites[id].y, player.y, 0.3
            );
          }
          this.playerSprites[id].rotation = player.angle;
        }
        this.players[id] = player;
      }
      
      // Update lasers
      this.lasers = data.lasers;
    });
    
    this.socket.on('playerHit', (data) => {
      // Death effect
      if (this.playerSprites[data.playerId]) {
        this.createDeathEffect(
          this.playerSprites[data.playerId].x,
          this.playerSprites[data.playerId].y,
          this.players[data.playerId]?.color
        );
        this.playerSprites[data.playerId].setVisible(false);
      }
      
      if (data.playerId === this.playerId) {
        this.isAlive = false;
        this.cameras.main.shake(300, 0.02);
      }
      
      // Kill feed
      const killer = this.players[data.shooterId]?.name || 'Player';
      const victim = this.players[data.playerId]?.name || 'Player';
      this.addKillFeed(killer, victim);
      
      this.updateScores(data.scores);
    });
    
    this.socket.on('playerRespawn', (data) => {
      if (this.playerSprites[data.playerId]) {
        this.playerSprites[data.playerId].x = data.x;
        this.playerSprites[data.playerId].y = data.y;
        this.playerSprites[data.playerId].setVisible(true);
        
        // Spawn effect
        this.createSpawnEffect(data.x, data.y);
      }
      
      if (data.playerId === this.playerId) {
        this.isAlive = true;
      }
    });
    
    this.socket.on('laserFired', (data) => {
      // Play sound effect would go here
      this.createMuzzleFlash(data.laser.x, data.laser.y, data.laser.angle, data.laser.color);
    });
    
    this.socket.on('timerUpdate', (data) => {
      this.updateTimer(data.timeRemaining);
    });
    
    this.socket.on('waiting', (data) => {
      this.updateMessage('Waiting...', data.message);
    });
    
    this.socket.on('disconnect', () => {
      this.updateMessage('Disconnected', 'Connection lost. Refresh to reconnect.');
      this.roundActive = false;
    });
  }

  createPlayerSprites() {
    for (const [id, player] of Object.entries(this.players)) {
      this.createPlayerSprite(id, player);
    }
  }

  createPlayerSprite(id, player) {
    // Create player container
    const container = this.add.container(player.x, player.y);
    
    // Body
    const body = this.add.graphics();
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    
    // Tank-like shape
    body.fillStyle(color, 1);
    body.fillRect(-12, -10, 24, 20);
    
    // Darker inner
    body.fillStyle(0x000000, 0.3);
    body.fillRect(-10, -8, 20, 16);
    
    // Gun barrel
    body.fillStyle(color, 1);
    body.fillRect(0, -3, 20, 6);
    
    // Glow effect
    body.lineStyle(2, color, 0.5);
    body.strokeRect(-14, -12, 28, 24);
    
    container.add(body);
    
    // Name tag
    const nameTag = this.add.text(0, -25, player.name, {
      fontSize: '12px',
      fontFamily: 'Orbitron',
      color: player.color,
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);
    container.add(nameTag);
    
    this.playerSprites[id] = container;
    
    // Update HUD names
    const playerIds = Object.keys(this.players);
    if (playerIds[0]) {
      document.getElementById('p1-name').textContent = this.players[playerIds[0]].name;
    }
    if (playerIds[1]) {
      document.getElementById('p2-name').textContent = this.players[playerIds[1]].name;
    }
  }

  createDeathEffect(x, y, color) {
    const particles = this.add.particles(x, y, null, {
      speed: { min: 100, max: 300 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      lifespan: 500,
      quantity: 20,
      emitting: false
    });
    
    // Create particle texture
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    const particleColor = color ? Phaser.Display.Color.HexStringToColor(color).color : 0xffffff;
    graphics.fillStyle(particleColor, 1);
    graphics.fillRect(0, 0, 6, 6);
    graphics.generateTexture('particle_' + color, 6, 6);
    
    particles.setTexture('particle_' + color);
    particles.explode(20);
    
    // Screen shake for local player death
    this.time.delayedCall(600, () => particles.destroy());
  }

  createSpawnEffect(x, y) {
    const circle = this.add.circle(x, y, 40, 0xffffff, 0.5);
    this.tweens.add({
      targets: circle,
      scale: 2,
      alpha: 0,
      duration: 300,
      onComplete: () => circle.destroy()
    });
  }

  createMuzzleFlash(x, y, angle, color) {
    const flashColor = Phaser.Display.Color.HexStringToColor(color).color;
    const flash = this.add.circle(x, y, 8, flashColor, 1);
    this.tweens.add({
      targets: flash,
      scale: 0,
      alpha: 0,
      duration: 100,
      onComplete: () => flash.destroy()
    });
  }

  update(time, delta) {
    if (!this.roundActive || !this.isAlive || !this.playerId) return;
    
    // Movement
    let dx = 0;
    let dy = 0;
    const speed = (this.config?.PLAYER_SPEED || 200) * (delta / 1000);
    
    if (this.keys.up.isDown) dy -= speed;
    if (this.keys.down.isDown) dy += speed;
    if (this.keys.left.isDown) dx -= speed;
    if (this.keys.right.isDown) dx += speed;
    
    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      dx *= 0.707;
      dy *= 0.707;
    }
    
    if (dx !== 0 || dy !== 0) {
      this.socket.emit('move', { dx, dy, angle: this.mouseAngle });
      
      // Immediate local update for responsiveness
      if (this.playerSprites[this.playerId]) {
        const player = this.playerSprites[this.playerId];
        player.x += dx;
        player.y += dy;
        player.rotation = this.mouseAngle;
        
        // Clamp to bounds
        const halfSize = 16;
        player.x = Phaser.Math.Clamp(player.x, halfSize, 1200 - halfSize);
        player.y = Phaser.Math.Clamp(player.y, halfSize, 800 - halfSize);
      }
    } else {
      // Still send angle updates for aiming
      this.socket.emit('move', { dx: 0, dy: 0, angle: this.mouseAngle });
      if (this.playerSprites[this.playerId]) {
        this.playerSprites[this.playerId].rotation = this.mouseAngle;
      }
    }
    
    // Draw lasers
    this.drawLasers();
  }

  drawLasers() {
    this.laserGraphics.clear();
    
    for (const laser of this.lasers) {
      const color = Phaser.Display.Color.HexStringToColor(laser.color).color;
      
      // Glow
      this.laserGraphics.lineStyle(8, color, 0.2);
      this.laserGraphics.lineBetween(
        laser.x - Math.cos(laser.angle) * 30,
        laser.y - Math.sin(laser.angle) * 30,
        laser.x,
        laser.y
      );
      
      // Core
      this.laserGraphics.lineStyle(3, color, 1);
      this.laserGraphics.lineBetween(
        laser.x - Math.cos(laser.angle) * 20,
        laser.y - Math.sin(laser.angle) * 20,
        laser.x,
        laser.y
      );
      
      // Bright center
      this.laserGraphics.lineStyle(1, 0xffffff, 1);
      this.laserGraphics.lineBetween(
        laser.x - Math.cos(laser.angle) * 15,
        laser.y - Math.sin(laser.angle) * 15,
        laser.x,
        laser.y
      );
    }
  }

  updateMessage(title, subtitle = '') {
    const overlay = document.getElementById('message-overlay');
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <h1>${title}</h1>
      ${subtitle ? `<p>${subtitle.replace(/\n/g, '<br>')}</p>` : ''}
    `;
  }

  hideMessage() {
    document.getElementById('message-overlay').classList.add('hidden');
  }

  showHUD() {
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('controls-hint').classList.remove('hidden');
  }

  hideHUD() {
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('controls-hint').classList.add('hidden');
  }

  updateScores(scores) {
    const playerIds = Object.keys(this.players);
    if (playerIds[0]) {
      document.getElementById('p1-score').textContent = scores[playerIds[0]] || 0;
    }
    if (playerIds[1]) {
      document.getElementById('p2-score').textContent = scores[playerIds[1]] || 0;
    }
  }

  updateTimer(seconds) {
    const timer = document.getElementById('timer');
    timer.textContent = seconds;
    
    if (seconds <= 10) {
      timer.classList.add('warning');
    } else {
      timer.classList.remove('warning');
    }
  }

  addKillFeed(killer, victim) {
    const feed = document.getElementById('kill-feed');
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `<strong>${killer}</strong> ⚡ ${victim}`;
    feed.insertBefore(entry, feed.firstChild);
    
    // Remove old entries
    while (feed.children.length > 5) {
      feed.removeChild(feed.lastChild);
    }
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (entry.parentNode) {
        entry.remove();
      }
    }, 5000);
  }
}

// Game configuration
const config = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
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

// Start game
const game = new Phaser.Game(config);
