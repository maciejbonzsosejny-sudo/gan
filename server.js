const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ========== STAN GRY ==========
let gameState = {
  players: {},
  projectiles: [],
  nextPlayerId: 1,
};

let clients = [];

// ========== FUNKCJE POMOCNICZE ==========

function getRandomColor() {
  const colors = [
    "#FF5252", "#FF4081", "#E040FB", "#7C4DFF",
    "#536DFE", "#448AFF", "#40C4FF", "#18FFFF",
    "#64FFDA", "#69F0AE", "#B2FF59", "#EEFF41",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function broadcastGameState() {
  const data = `data: ${JSON.stringify({
    type: "gameState",
    players: gameState.players,
    projectiles: gameState.projectiles,
  })}\n\n`;

  clients.forEach((res) => res.write(data));
}

function handlePlayerHit(hitPlayerId, shooterId) {
  const hitPlayer = gameState.players[hitPlayerId];
  if (!hitPlayer || !hitPlayer.isAlive) return;

  hitPlayer.lives--;
  if (hitPlayer.lives <= 0) {
    hitPlayer.isAlive = false;
    hitPlayer.respawnTime = Date.now() + 10000;
  }

  broadcastGameState();
}

function respawnPlayers() {
  const now = Date.now();
  let changed = false;
  Object.values(gameState.players).forEach((player) => {
    if (!player.isAlive && now >= player.respawnTime) {
      player.isAlive = true;
      player.lives = 3;
      player.x = Math.random() * 1800 + 100;
      player.y = Math.random() * 1800 + 100;
      changed = true;
    }
  });
  if (changed) broadcastGameState();
}

// ========== SSE: REAL-TIME AKTUALIZACJE ==========
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const playerId = `player${gameState.nextPlayerId++}`;
  const isHost = Object.keys(gameState.players).length === 0;

  gameState.players[playerId] = {
    id: playerId,
    x: Math.random() * 1800 + 100,
    y: Math.random() * 1800 + 100,
    color: getRandomColor(),
    velocityX: 0,
    velocityY: 0,
    angle: 0,
    lives: 3,
    isAlive: true,
    invulnerableUntil: Date.now() + 1000,
  };

  // Wyślij identyfikator nowemu graczowi
  res.write(`data: ${JSON.stringify({ type: "playerId", id: playerId, isHost })}\n\n`);

  clients.push(res);
  console.log(`✅ Nowy gracz: ${playerId} (klienci: ${clients.length})`);

  broadcastGameState();

  req.on("close", () => {
    console.log(`❌ Gracz ${playerId} rozłączył się`);
    delete gameState.players[playerId];
    clients = clients.filter((c) => c !== res);
    broadcastGameState();
  });
});

// ========== AKTUALIZACJE GRY ==========
app.post("/update", (req, res) => {
  const { type, player, projectile, hitPlayerId, shooterId } = req.body;

  switch (type) {
    case "playerUpdate":
      if (gameState.players[player.id] && gameState.players[player.id].isAlive) {
        Object.assign(gameState.players[player.id], player);
      }
      break;

    case "shoot":
      if (projectile) {
        projectile.createdAt = Date.now();
        gameState.projectiles.push(projectile);
      }
      break;

    case "playerHit":
      handlePlayerHit(hitPlayerId, shooterId);
      break;
  }

  broadcastGameState();
  res.json({ ok: true });
});

// ========== OBSŁUGA STATYCZNA ==========
app.use(express.static(path.join(__dirname)));

// ========== GŁÓWNA PĘTLA ==========
setInterval(() => {
  const now = Date.now();
  let changed = false;

  gameState.projectiles = gameState.projectiles.filter((p) => now - p.createdAt < 2000);

  respawnPlayers();
}, 100);

// ========== START SERVERA ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Serwer działa na porcie ${PORT}`);
});
