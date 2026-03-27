/**
 * Card Game Client - Phaser-based frontend
 * Connects to WebSocket server for multiplayer gameplay
 */

const WS_URL = (window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + window.location.host;

// Game state
let ws = null;
let clientId = null;
let playerName = 'Player';
let roomId = null;
let players = [];
let myHand = [];
let myIndex = 0;
let currentPlayerId = null;
let gameStarted = false;
let trick = [];

// Phaser config
const config = {
    type: Phaser.AUTO,
    parent: 'gameContainer',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0a4d2e',
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

let game;
let scene;
let cardSprites = [];
let trickSprites = [];

// Card dimensions
const CARD_WIDTH = 100;
const CARD_HEIGHT = 140;
const CARD_SPACING = 80;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Connect to server
    connectWebSocket();
    
    // UI event listeners
    document.getElementById('createBtn').addEventListener('click', createRoom);
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('startBtn').addEventListener('click', startGame);
    document.getElementById('playerName').addEventListener('change', updateName);
    
    // Create Phaser game
    game = new Phaser.Game(config);
});

function connectWebSocket() {
    try {
        ws = new WebSocket(WS_URL);
        
        ws.onopen = () => {
            console.log('Connected to server');
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };
        
        ws.onclose = () => {
            console.log('Disconnected from server');
            showError('Disconnected from server. Refresh to reconnect.');
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            showError('Connection error. Make sure the server is running.');
        };
    } catch (e) {
        console.error('Failed to connect:', e);
        showError('Failed to connect to server.');
    }
}

function handleServerMessage(data) {
    console.log('Server message:', data.type, data);
    
    switch (data.type) {
        case 'connected':
            clientId = data.clientId;
            break;
            
        case 'nameSet':
            console.log('Name set:', data.name);
            break;
            
        case 'roomCreated':
            roomId = data.roomId;
            players = data.players;
            showRoomInfo();
            break;
            
        case 'roomJoined':
            roomId = data.roomId;
            players = data.players;
            showRoomInfo();
            break;
            
        case 'playerJoined':
            players = data.players;
            updatePlayerList();
            break;
            
        case 'playerLeft':
            updatePlayerList();
            break;
            
        case 'gameStarted':
            gameStarted = true;
            players = data.players;
            myHand = data.yourHand;
            myIndex = data.yourIndex;
            currentPlayerId = data.currentPlayer;
            hideLobby();
            showGameUI();
            updatePlayerList();
            renderHand();
            updateTurnIndicator();
            break;
            
        case 'cardPlayed':
            handleCardPlayed(data);
            break;
            
        case 'turnChanged':
            currentPlayerId = data.currentPlayer;
            updateTurnIndicator();
            break;
            
        case 'trickComplete':
            handleTrickComplete(data);
            break;
            
        case 'roundComplete':
            handleRoundComplete(data);
            break;
            
        case 'gameComplete':
            handleGameComplete(data);
            break;
            
        case 'error':
            showError(data.message);
            break;
    }
}

function sendMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function createRoom() {
    updateName();
    sendMessage({ type: 'createRoom' });
}

function joinRoom() {
    const code = document.getElementById('roomCode').value.trim().toUpperCase();
    if (!code) {
        showError('Enter a room code');
        return;
    }
    updateName();
    sendMessage({ type: 'joinRoom', roomId: code });
}

function updateName() {
    playerName = document.getElementById('playerName').value.trim() || 'Player';
    sendMessage({ type: 'setName', name: playerName });
}

function startGame() {
    sendMessage({ type: 'startGame' });
}

function showRoomInfo() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('roomInfo').style.display = 'block';
    document.getElementById('roomIdDisplay').textContent = roomId;
    document.getElementById('playerCount').textContent = players.length;
    
    // Show start button only for host (first player)
    if (players.length > 0 && players[0].id === clientId) {
        document.getElementById('startBtn').style.display = 'inline-block';
    }
    
    updatePlayerList();
}

function hideLobby() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('roomInfo').style.display = 'none';
}

function showGameUI() {
    document.getElementById('players').style.display = 'block';
    document.getElementById('instructions').style.display = 'block';
}

function updatePlayerList() {
    const listEl = document.getElementById('playerList');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item' + (player.id === currentPlayerId ? ' active' : '');
        
        const isMe = player.id === clientId;
        const nameText = isMe ? `${player.name} (You)` : player.name;
        const aiText = player.isAI ? ' 🤖' : '';
        
        div.innerHTML = `
            <span>${nameText}${aiText}</span>
            <span class="score">${player.score || 0} pts</span>
        `;
        
        listEl.appendChild(div);
    });
    
    // Update room info player count
    const pc = document.getElementById('playerCount');
    if (pc) pc.textContent = players.length;
}

function renderHand() {
    if (!scene) return;
    
    // Clear existing cards
    cardSprites.forEach(s => s.destroy());
    cardSprites = [];
    
    if (!myHand || myHand.length === 0) return;
    
    const centerX = scene.scale.width / 2;
    const y = scene.scale.height - CARD_HEIGHT / 2 - 30;
    
    const totalWidth = (myHand.length - 1) * CARD_SPACING + CARD_WIDTH;
    const startX = centerX - totalWidth / 2;
    
    myHand.forEach((card, index) => {
        const x = startX + index * CARD_SPACING;
        const cardSprite = createCardSprite(x, y, card, true);
        cardSprites.push(cardSprite);
    });
}

function createCardSprite(x, y, card, interactive = false) {
    const container = scene.add.container(x, y);
    
    // Card background
    const bg = scene.add.graphics();
    bg.fillStyle(0xffffff, 1);
    bg.fillRoundedRect(-CARD_WIDTH/2, -CARD_HEIGHT/2, CARD_WIDTH, CARD_HEIGHT, 8);
    bg.lineStyle(2, 0x333333, 1);
    bg.strokeRoundedRect(-CARD_WIDTH/2, -CARD_HEIGHT/2, CARD_WIDTH, CARD_HEIGHT, 8);
    container.add(bg);
    
    // Suit color
    const color = (card.suit === 'hearts' || card.suit === 'diamonds') ? '#e74c3c' : '#2c3e50';
    
    // Card rank
    const rankText = scene.add.text(-CARD_WIDTH/2 + 10, -CARD_HEIGHT/2 + 8, card.rank, {
        fontSize: '18px',
        color: color,
        fontStyle: 'bold'
    });
    container.add(rankText);
    
    // Suit symbol
    const suitSymbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
    const suitText = scene.add.text(-CARD_WIDTH/2 + 10, -CARD_HEIGHT/2 + 28, suitSymbols[card.suit], {
        fontSize: '20px',
        color: color
    });
    container.add(suitText);
    
    // Center suit (large)
    const centerSuit = scene.add.text(0, 0, suitSymbols[card.suit], {
        fontSize: '48px',
        color: color
    }).setOrigin(0.5);
    container.add(centerSuit);
    
    // Rank at bottom right (rotated)
    const rankBottom = scene.add.text(CARD_WIDTH/2 - 10, CARD_HEIGHT/2 - 8, card.rank, {
        fontSize: '18px',
        color: color,
        fontStyle: 'bold'
    }).setOrigin(1, 1).setRotation(Math.PI);
    container.add(rankBottom);
    
    if (interactive) {
        container.setInteractive(new Phaser.Geom.Rectangle(-CARD_WIDTH/2, -CARD_HEIGHT/2, CARD_WIDTH, CARD_HEIGHT), Phaser.Geom.Rectangle.Contains);
        
        container.on('pointerover', () => {
            if (isMyTurn()) {
                container.setY(y - 20);
                container.setDepth(100);
            }
        });
        
        container.on('pointerout', () => {
            container.setY(y);
            container.setDepth(0);
        });
        
        container.on('pointerdown', () => {
            if (isMyTurn()) {
                playCard(card);
            }
        });
    }
    
    return container;
}

function isMyTurn() {
    return currentPlayerId === clientId && gameStarted;
}

function playCard(card) {
    sendMessage({ type: 'playCard', card: { suit: card.suit, rank: card.rank } });
}

function handleCardPlayed(data) {
    // Add to trick display
    trick.push(data.card);
    
    // Find player who played
    const playerIndex = players.findIndex(p => p.id === data.playerId);
    if (playerIndex === -1) return;
    
    // Animate card from player's position
    const positions = getPlayerPositions();
    const pos = positions[playerIndex];
    
    // If it was me, remove from hand
    if (data.playerId === clientId) {
        const cardIndex = myHand.findIndex(c => c.suit === data.card.suit && c.rank === data.card.rank);
        if (cardIndex !== -1) {
            myHand.splice(cardIndex, 1);
            renderHand();
        }
    }
    
    // Create card in trick position (centered on table)
    const centerX = scene.scale.width / 2;
    const centerY = scene.scale.height / 2;
    const trickOffset = (trick.length - 1) * 25;
    const trickX = centerX - 50 + trickOffset;
    const trickY = centerY;
    const cardSprite = createCardSprite(trickX, trickY, data.card, false);
    trickSprites.push(cardSprite);
    
    // Animate from player position
    cardSprite.setPosition(pos.x, pos.y);
    scene.tweens.add({
        targets: cardSprite,
        x: trickX,
        y: trickY,
        duration: 300,
        ease: 'Power2'
    });
}

function handleTrickComplete(data) {
    // Show winner briefly
    let message = `${players.find(p => p.id === data.winner)?.name || 'Player'} won the trick!`;
    if (data.points > 0) {
        message += ` (+${data.points} points)`;
    }
    showStatus(message, 2000);
    
    // Clear trick after delay
    setTimeout(() => {
        trickSprites.forEach(s => s.destroy());
        trickSprites = [];
        trick = [];
        
        // Update scores
        updatePlayerList();
    }, 2000);
}

function handleRoundComplete(data) {
    let message = `Round ${data.roundNumber} complete!`;
    if (data.shootingMoon) {
        message = `🌙 ${data.shootingMoon.name} shot the moon! (+26 points to everyone else)`;
    }
    showStatus(message, 3000);
    
    // Update player scores
    data.scores.forEach(scoreData => {
        const player = players.find(p => p.id === scoreData.id);
        if (player) {
            player.score = scoreData.score;
        }
    });
    
    updatePlayerList();
    
    // Clear everything
    cardSprites.forEach(s => s.destroy());
    cardSprites = [];
    trickSprites.forEach(s => s.destroy());
    trickSprites = [];
    myHand = [];
}

function handleGameComplete(data) {
    const winner = data.winner;
    showStatus(`🏆 Game Over! ${winner.name} wins with ${winner.score} points!`, 5000);
    
    // Show final scores
    showFinalScores(data.finalScores);
    
    gameStarted = false;
}

function showFinalScores(scores) {
    const scoresDiv = document.getElementById('scores');
    scoresDiv.style.display = 'block';
    
    let html = '<table><tr><th>Player</th><th>Score</th></tr>';
    scores.sort((a, b) => a.score - b.score).forEach(s => {
        const isWinner = s.id === scores[0].id;
        html += `<tr><td>${s.name}${isWinner ? ' 🏆' : ''}</td><td>${s.score}</td></tr>`;
    });
    html += '</table>';
    
    scoresDiv.innerHTML = html;
    
    setTimeout(() => {
        scoresDiv.style.display = 'none';
    }, 8000);
}

function showStatus(text, duration = 3000) {
    const statusEl = document.getElementById('gameStatus');
    statusEl.textContent = text;
    statusEl.style.display = 'block';
    
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, duration);
}

function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 4000);
}

function updateTurnIndicator() {
    const yourTurnEl = document.getElementById('yourTurn');
    const turnIndicatorEl = document.getElementById('turnIndicator');
    
    if (isMyTurn()) {
        yourTurnEl.style.display = 'block';
        turnIndicatorEl.style.display = 'none';
    } else {
        yourTurnEl.style.display = 'none';
        const currentPlayer = players.find(p => p.id === currentPlayerId);
        if (currentPlayer) {
            turnIndicatorEl.textContent = `${currentPlayer.name}'s turn`;
            turnIndicatorEl.style.display = 'block';
        }
    }
    
    updatePlayerList();
}

function getPlayerPositions() {
    const width = scene.scale.width;
    const height = scene.scale.height;
    
    // 4 player positions around the table
    return [
        { x: width / 2, y: height - 50 },      // Bottom (me)
        { x: width - 50, y: height / 2 },      // Right
        { x: width / 2, y: 50 },               // Top
        { x: 50, y: height / 2 }               // Left
    ];
}

// Phaser scene functions
function preload() {
    // No assets to preload - cards are drawn programmatically
}

function create() {
    scene = this;
    
    // Draw table
    drawTable();
    
    // Handle resize
    scene.scale.on('resize', (gameSize) => {
        scene.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
        drawTable();
        renderHand();
    });
}

function drawTable() {
    scene.children.removeAll(true);
    cardSprites = [];
    trickSprites = [];
    
    const width = scene.scale.width;
    const height = scene.scale.height;
    
    // Table background (felt texture)
    const table = scene.add.graphics();
    table.fillStyle(0x0a4d2e, 1);
    table.fillRoundedRect(50, 50, width - 100, height - 100, 100);
    
    // Table border
    table.lineStyle(10, 0x8B4513, 1);
    table.strokeRoundedRect(50, 50, width - 100, height - 100, 100);
    
    // Table center decoration
    const center = scene.add.graphics();
    center.lineStyle(3, 0x1a5c3a, 0.5);
    center.strokeCircle(width / 2, height / 2, 150);
    
    // "HEARTS" text in center
    scene.add.text(width / 2, height / 2, 'HEARTS', {
        fontSize: '48px',
        color: '#1a5c3a',
        fontStyle: 'bold',
        alpha: 0.3
    }).setOrigin(0.5);
    
    // Redraw cards if game is active
    if (gameStarted && myHand.length > 0) {
        renderHand();
    }
    
    if (trickSprites.length > 0) {
        trickSprites.forEach(s => {
            // Re-add to scene
            scene.add.existing(s);
        });
    }
}

function update() {
    // Game loop - nothing needed here for now
}
