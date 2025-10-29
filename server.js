const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ===== STAN GRY =====
let gameState = {
  players: {},
  projectiles: [],
  nextPlayerId: 1,
};
let clients = [];

// ===== FUNKCJE =====
function broadcastGameState() {
  const data = `data: ${JSON.stringify({
    type: "gameState",
    players: gameState.players,
    projectiles: gameState.projectiles,
  })}\n\n`;
  clients.forEach(res => res.write(data));
}

// ===== STRUMIEŃ DANYCH (SSE) =====
app.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const playerId = `player${gameState.nextPlayerId++}`;
  gameState.players[playerId] = {
    id: playerId,
    x: Math.random() * 1800 + 100,
    y: Math.random() * 1800 + 100,
    color: "#" + Math.floor(Math.random() * 16777215).toString(16),
    lives: 3,
    isAlive: true,
    angle: 0,
  };

  res.write(`data: ${JSON.stringify({ type: "playerId", id: playerId })}\n\n`);
  clients.push(res);
  broadcastGameState();

  req.on("close", () => {
    delete gameState.players[playerId];
    clients = clients.filter(c => c !== res);
    broadcastGameState();
  });
});

// ===== AKTUALIZACJE OD KLIENTA =====
app.post("/update", (req, res) => {
  const { type, player, projectile } = req.body;

  if (type === "move" && gameState.players[player.id]) {
    Object.assign(gameState.players[player.id], player);
  }

  if (type === "shoot" && projectile) {
    gameState.projectiles.push({
      x: projectile.x,
      y: projectile.y,
      dx: projectile.dx,
      dy: projectile.dy,
      color: projectile.color,
      shooter: projectile.shooter,
      createdAt: Date.now(),
    });
  }

  res.json({ ok: true });
});

// ===== AKTUALIZACJE POZYCJI POCISKÓW =====
setInterval(() => {
  const now = Date.now();
  const speed = 10;

  gameState.projectiles.forEach(p => {
    p.x += p.dx * speed;
    p.y += p.dy * speed;
  });

  // Usuń stare pociski po 2 sekundach
  gameState.projectiles = gameState.projectiles.filter(p => now - p.createdAt < 2000);

  broadcastGameState();
}, 100);

app.get("/ping", (req, res) => res.send("pong"));
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Serwer działa na porcie ${PORT}`));
