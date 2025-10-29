const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Serwer HTTP do obsługi strony
const server = http.createServer((req, res) => {
    // Obsługa żądań WebSocket
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        res.writeHead(400);
        res.end('WebSocket requests should be handled by WebSocket server');
        return;
    }

    // Obsługa plików statycznych
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    
    // Zabezpieczenie
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Access denied');
        return;
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }
        
        const ext = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css'
        }[ext] || 'text/plain';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// Serwer WebSocket na tym SAMYM porcie
const wss = new WebSocket.Server({ 
    server: server,
    path: '/ws'  // Specjalna ścieżka dla WebSocket
});

// Stan gry
let gameState = {
    players: {},
    projectiles: [],
    nextPlayerId: 1
};

wss.on('connection', (ws, req) => {
    console.log('Nowe połączenie WebSocket');
    
    const playerId = `player${gameState.nextPlayerId++}`;
    const isHost = Object.keys(gameState.players).length === 0;
    
    // Tworzenie nowego gracza z systemem życia
    gameState.players[playerId] = {
        id: playerId,
        x: Math.random() * 1800 + 100,
        y: Math.random() * 1800 + 100,
        color: getRandomColor(),
        velocityX: 0,
        velocityY: 0,
        angle: 0,
        lives: 3, // Nowe pole: życia
        isAlive: true, // Nowe pole: czy gracz żyje
        lastShotTime: 0, // Nowe pole: czas ostatniego strzału
        respawnTime: 0, // Nowe pole: czas odrodzenia
        invulnerableUntil: Date.now() + 1000
    };
    
    // Wysłanie ID gracza
    ws.send(JSON.stringify({
        type: 'playerId',
        id: playerId,
        isHost: isHost
    }));
    
    // Powiadomienie innych graczy
    broadcast({
        type: 'playerJoined',
        playerId: playerId
    }, ws);
    
    // Wysłanie aktualnego stanu gry
    ws.send(JSON.stringify({
        type: 'gameState',
        players: gameState.players,
        projectiles: gameState.projectiles
    }));
    
    // Obsługa wiadomości
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'playerUpdate':
                    if (gameState.players[data.player.id]) {
                        // Aktualizuj tylko jeśli gracz żyje
                        if (gameState.players[data.player.id].isAlive) {
                            gameState.players[data.player.id].x = data.player.x;
                            gameState.players[data.player.id].y = data.player.y;
                            gameState.players[data.player.id].angle = data.player.angle;
                            gameState.players[data.player.id].velocityX = data.player.velocityX;
                            gameState.players[data.player.id].velocityY = data.player.velocityY;
                        }
                        broadcastGameState();
                    }
                    break;
                    
                case 'shoot':
                    const player = gameState.players[data.playerId];
                    if (player && player.isAlive) {
                        data.projectile.createdAt = Date.now();
                        gameState.projectiles.push(data.projectile);
                        broadcastGameState();
                    }
                    break;

                case 'playerHit':
                    handlePlayerHit(data.hitPlayerId, data.shooterId);
                    break;
            }
        } catch (error) {
            console.error('Błąd parsowania:', error);
        }
    });
    
    // Obsługa rozłączenia
    ws.on('close', () => {
        console.log(`Gracz ${playerId} rozłączył się`);
        delete gameState.players[playerId];
        
        gameState.projectiles = gameState.projectiles.filter(
            p => p.playerId !== playerId
        );
        
        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });
        
        broadcastGameState();
    });
    
    ws.on('error', (error) => {
        console.error('Błąd WebSocket:', error);
    });
});

// Obsługa trafienia gracza
function handlePlayerHit(hitPlayerId, shooterId) {
    const hitPlayer = gameState.players[hitPlayerId];
    if (!hitPlayer || !hitPlayer.isAlive) return;

    console.log(`[HIT] ${hitPlayerId} trafiony przez ${shooterId}. Lives przed: ${hitPlayer.lives}`);

    // Odejmij życie
    hitPlayer.lives--;
    
    if (hitPlayer.lives <= 0) {
        // Gracz nie żyje - ustaw czas odrodzenia
        hitPlayer.isAlive = false;
        hitPlayer.respawnTime = Date.now() + 10000; // 10 sekund
        console.log(`Gracz ${hitPlayerId} zginął, odrodzi się za 10s`);
        
        broadcast({
            type: 'playerDied',
            playerId: hitPlayerId,
            respawnTime: hitPlayer.respawnTime
        });
    } else {
        console.log(`Gracz ${hitPlayerId} trafiony, pozostało żyć: ${hitPlayer.lives}`);
    }
    
    broadcastGameState();
}

// Funkcja odradzania graczy
function respawnPlayers() {
    const now = Date.now();
    let needsUpdate = false;

    Object.values(gameState.players).forEach(player => {
        if (!player.isAlive && now >= player.respawnTime) {
            player.isAlive = true;
            player.lives = 3;
            player.x = Math.random() * 1800 + 100;
            player.y = Math.random() * 1800 + 100;
            player.invulnerableUntil = Date.now() + 1000;
            needsUpdate = true;
            console.log(`Gracz ${player.id} odrodził się`);
        }
    });

    if (needsUpdate) {
        broadcastGameState();
    }
}

// Kolizje pocisków z graczami
function checkCollisions() {
    const now = Date.now();
    let needsUpdate = false;

    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const projectile = gameState.projectiles[i];
        
        // Sprawdź kolizje z każdym graczem
        Object.values(gameState.players).forEach(player => {
            if (player.id !== projectile.playerId && player.isAlive) {
                const dx = projectile.x - player.x;
                const dy = projectile.y - player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 25) { // Promień gracza + pocisku
                    // Trafienie!
                    console.log(`[COLLISION] projectile from ${projectile.playerId} hit ${player.id}. dist=${distance.toFixed(2)} proj=(x:${projectile.x.toFixed(1)},y:${projectile.y.toFixed(1)}) player=(x:${player.x.toFixed(1)},y:${player.y.toFixed(1)}) createdAt=${projectile.createdAt}`);
                    handlePlayerHit(player.id, projectile.playerId);
                    gameState.projectiles.splice(i, 1);
                    needsUpdate = true;
                    return;
                }
            }
        });

        // Usuń stare pociski
        if (now - projectile.createdAt > 2000) {
            gameState.projectiles.splice(i, 1);
            needsUpdate = true;
        }
    }

    if (needsUpdate) {
        broadcastGameState();
    }
}

function broadcast(message, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastGameState() {
    broadcast({
        type: 'gameState',
        players: gameState.players,
        projectiles: gameState.projectiles
    });
}

function getRandomColor() {
    const colors = [
        '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', 
        '#536DFE', '#448AFF', '#40C4FF', '#18FFFF',
        '#64FFDA', '#69F0AE', '#B2FF59', '#EEFF41'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Główna pętla gry serwera
setInterval(() => {
    checkCollisions();
    respawnPlayers();
}, 100);

// Uruchomienie na porcie > 1024 (bez uprawnień)
const PORT = 8080;
server.listen(PORT, () => {
    console.log(`Serwer uruchomiony na http://localhost:${PORT}`);
    console.log(`WebSocket dostępny na ws://localhost:${PORT}/ws`);
});