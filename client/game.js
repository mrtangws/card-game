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
let gameType = 'hearts'; // 'hearts' or 'big2'
let players = [];
let myHand = [];
let myIndex = 0;
let currentPlayerId = null;
let gameStarted = false;
let trick = [];
let selectedCards = []; // For Big 2 multi-card selection
let currentPlay = [];   // Current play on table (Big 2)
let canFollow = true;   // Whether you can follow current play (Big 2)

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
let playedCardsSprites = []; // Big 2: cards played on table (messy stack)

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
            gameType = data.gameType || 'hearts';
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
            gameType = data.gameType || 'hearts';
            players = data.players;
            myHand = data.yourHand;
            myIndex = data.yourIndex;
            currentPlayerId = data.currentPlayer;
            selectedCards = [];
            currentPlay = [];
            // Clear any previous played cards
            playedCardsSprites.forEach(s => s && s.destroy());
            playedCardsSprites = [];
            hideLobby();
            showGameUI();
            updatePlayerList();
            renderHand();
            updateTurnIndicator();
            showGameControls();
            break;
            
        case 'cardPlayed':
            handleCardPlayed(data);
            break;
            
        case 'turnChanged':
            currentPlayerId = data.currentPlayer;
            if (data.currentPlay !== undefined) currentPlay = data.currentPlay;
            if (data.canFollow !== undefined) canFollow = data.canFollow;
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
            
        // Big 2 specific messages
        case 'cardsPlayed':
            handleCardsPlayed(data);
            break;
            
        case 'playerPassed':
            handlePlayerPassed(data);
            break;
            
        case 'initiativeGained':
            handleInitiativeGained(data);
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
    const selectedType = document.getElementById('gameTypeSelect')?.value || 'hearts';
    gameType = selectedType;
    sendMessage({ type: 'createRoom', gameType: selectedType });
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
    
    // Update instructions for Big 2
    if (gameType === 'big2') {
        const list = document.getElementById('instructionsList');
        if (list) {
            list.innerHTML = `
                <li>Play the 3 of Diamonds to start</li>
                <li>Play 1, 2, or 5 cards (singles, pairs, poker hands)</li>
                <li>No triples allowed!</li>
                <li>Beat the previous play or pass</li>
                <li>First to empty hand wins!</li>
            `;
        }
    }
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
    
    const screenWidth = scene.scale.width;
    const padding = 20; // left/right padding
    const availableWidth = screenWidth - padding * 2;
    
    // Calculate responsive spacing to fit all cards
    const numCards = myHand.length;
    let spacing = CARD_SPACING;
    let cardWidth = CARD_WIDTH;
    let cardHeight = CARD_HEIGHT;
    
    // Calculate total width with default sizes
    let totalWidth = (numCards - 1) * spacing + cardWidth;
    
    // If doesn't fit, scale down
    if (totalWidth > availableWidth) {
        // First try reducing spacing
        spacing = Math.max(20, (availableWidth - cardWidth) / (numCards - 1));
        totalWidth = (numCards - 1) * spacing + cardWidth;
        
        // If still doesn't fit, scale down cards too
        if (totalWidth > availableWidth) {
            const scale = availableWidth / totalWidth;
            cardWidth = Math.max(60, CARD_WIDTH * scale);
            cardHeight = Math.max(84, CARD_HEIGHT * scale);
            spacing = Math.max(15, spacing * scale);
            totalWidth = (numCards - 1) * spacing + cardWidth;
        }
    }
    
    const centerX = screenWidth / 2;
    const y = scene.scale.height - cardHeight / 2 - 30;
    const startX = Math.max(padding + cardWidth/2, centerX - totalWidth / 2);
    
    myHand.forEach((card, index) => {
        const x = startX + index * spacing;
        const cardSprite = createCardSprite(x, y, card, true, cardWidth, cardHeight);
        cardSprites.push(cardSprite);
    });
}

function createCardSprite(x, y, card, interactive = false, width = CARD_WIDTH, height = CARD_HEIGHT) {
    const container = scene.add.container(x, y);
    
    // Selection outline (hidden by default)
    const selectionOutline = scene.add.graphics();
    selectionOutline.lineStyle(4, 0xffff00, 1); // Yellow outline
    selectionOutline.strokeRoundedRect(-width/2 - 4, -height/2 - 4, width + 8, height + 8, 10);
    selectionOutline.visible = false;
    container.add(selectionOutline);
    container.selectionOutline = selectionOutline; // Store reference
    
    // Card background
    const bg = scene.add.graphics();
    bg.fillStyle(0xffffff, 1);
    bg.fillRoundedRect(-width/2, -height/2, width, height, 8);
    bg.lineStyle(2, 0x333333, 1);
    bg.strokeRoundedRect(-width/2, -height/2, width, height, 8);
    container.add(bg);
    
    // Suit color
    const color = (card.suit === 'hearts' || card.suit === 'diamonds') ? '#e74c3c' : '#2c3e50';
    
    // Scale font sizes based on card size
    const scale = Math.min(width / CARD_WIDTH, height / CARD_HEIGHT);
    const fontSize = Math.max(12, Math.floor(18 * scale));
    const centerFontSize = Math.max(24, Math.floor(48 * scale));
    const suitFontSize = Math.max(14, Math.floor(20 * scale));
    
    // Card rank
    const rankText = scene.add.text(-width/2 + 10 * scale, -height/2 + 8 * scale, card.rank, {
        fontSize: fontSize + 'px',
        color: color,
        fontStyle: 'bold'
    });
    container.add(rankText);
    
    // Suit symbol
    const suitSymbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
    const suitText = scene.add.text(-width/2 + 10 * scale, -height/2 + 28 * scale, suitSymbols[card.suit], {
        fontSize: suitFontSize + 'px',
        color: color
    });
    container.add(suitText);
    
    // Center suit (large)
    const centerSuit = scene.add.text(0, 0, suitSymbols[card.suit], {
        fontSize: centerFontSize + 'px',
        color: color
    }).setOrigin(0.5);
    container.add(centerSuit);
    
    // Rank at bottom right (rotated)
    const rankBottom = scene.add.text(width/2 - 10 * scale, height/2 - 8 * scale, card.rank, {
        fontSize: fontSize + 'px',
        color: color,
        fontStyle: 'bold'
    }).setOrigin(1, 1).setRotation(Math.PI);
    container.add(rankBottom);
    
    if (interactive) {
        container.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains);
        
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
                if (gameType === 'big2') {
                    // Toggle card selection for Big 2
                    toggleCardSelection(card, container);
                } else {
                    playCard(card);
                }
            }
        });
    }
    
    return container;
}

function toggleCardSelection(card, container) {
    const idx = selectedCards.findIndex(c => c.suit === card.suit && c.rank === card.rank);
    
    if (idx !== -1) {
        // Deselect
        selectedCards.splice(idx, 1);
        container.setY(container.y + 20); // Move down
        if (container.selectionOutline) container.selectionOutline.visible = false;
    } else {
        // Select
        selectedCards.push(card);
        container.setY(container.y - 20); // Move up
        if (container.selectionOutline) container.selectionOutline.visible = true;
    }
    
    // Update play button state
    const playBtn = document.getElementById('playBtn');
    if (playBtn) {
        playBtn.disabled = selectedCards.length === 0;
    }
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
    // Clear played cards table
    playedCardsSprites.forEach(s => s && s.destroy());
    playedCardsSprites = [];
    
    // Handle Big 2 game complete
    if (data.gameType === 'big2') {
        const winner = data.winner;
        showStatus(`🏆 ${winner.name} wins Big 2!`, 5000);
        
        // Show rankings
        if (data.rankings) {
            showBig2Rankings(data.rankings);
        }
        gameStarted = false;
        return;
    }
    
    // Hearts game complete
    const winner = data.winner;
    showStatus(`🏆 Game Over! ${winner.name} wins with ${winner.score} points!`, 5000);
    
    // Show final scores
    showFinalScores(data.finalScores);
    
    gameStarted = false;
}

function showBig2Rankings(rankings) {
    const scoresDiv = document.getElementById('scores');
    scoresDiv.style.display = 'block';
    
    let html = '<h3>Big 2 Results</h3><table><tr><th>Rank</th><th>Player</th><th>Cards Left</th></tr>';
    rankings.forEach((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        const status = r.cardsLeft === 0 ? ' (Winner!)' : '';
        html += `<tr><td>${i+1} ${medal}</td><td>${r.name}${status}</td><td>${r.cardsLeft}</td></tr>`;
    });
    html += '</table>';
    scoresDiv.innerHTML = html;
    
    setTimeout(() => {
        scoresDiv.style.display = 'none';
    }, 10000);
}

// Big 2 message handlers
function handleCardsPlayed(data) {
    currentPlay = data.cards || [];
    
    // Find player who played
    const player = players.find(p => p.id === data.playerId);
    
    // Remove cards from my hand if it was me
    if (data.playerId === clientId) {
        data.cards.forEach(card => {
            const idx = myHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
            if (idx !== -1) myHand.splice(idx, 1);
        });
        selectedCards = [];
        renderHand();
    }
    
    // Render played cards on table (messy/natural look)
    renderPlayedCards(data.cards);
    
    showStatus(`${player?.name || 'Player'} played ${data.playType || data.cards.length} card(s)`, 2000);
    
    // Update current play display
    updateCurrentPlayDisplay(data.cards);
}

function renderPlayedCards(cards) {
    if (!scene) return;
    
    // Get center of table
    const centerX = scene.scale.width / 2;
    const centerY = scene.scale.height / 2;
    
    // Calculate offset for this batch (stack slightly offset from previous)
    const batchOffsetX = (playedCardsSprites.length % 5) * 15 - 30;
    const batchOffsetY = Math.floor(playedCardsSprites.length / 5) * 10;
    
    cards.forEach((card, i) => {
        // Random "messy" offsets for natural look
        const offsetX = batchOffsetX + (Math.random() - 0.5) * 40 + i * 25;
        const offsetY = batchOffsetY + (Math.random() - 0.5) * 30;
        const rotation = (Math.random() - 0.5) * 0.3; // Slight rotation
        
        const x = centerX + offsetX;
        const y = centerY + offsetY;
        
        const cardSprite = createCardSprite(x, y, card, false, CARD_WIDTH * 0.8, CARD_HEIGHT * 0.8);
        cardSprite.setRotation(rotation);
        cardSprite.setDepth(50 + playedCardsSprites.length); // Stack on top
        
        playedCardsSprites.push(cardSprite);
    });
    
    // Limit total cards on table to prevent clutter (keep last ~15)
    while (playedCardsSprites.length > 15) {
        const old = playedCardsSprites.shift();
        if (old) old.destroy();
    }
}

function handlePlayerPassed(data) {
    const player = players.find(p => p.id === data.playerId);
    showStatus(`${player?.name || 'Player'} passed`, 1500);
}

function handleInitiativeGained(data) {
    const player = players.find(p => p.id === data.playerId);
    showStatus(`Everyone passed! ${player?.name || 'Player'} has initiative!`, 2500);
    currentPlay = [];
    updateCurrentPlayDisplay([]);
    // Clear played cards table for new round
    playedCardsSprites.forEach(s => s && s.destroy());
    playedCardsSprites = [];
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
    const playBtn = document.getElementById('playBtn');
    const passBtn = document.getElementById('passBtn');
    
    if (isMyTurn()) {
        yourTurnEl.style.display = 'block';
        turnIndicatorEl.style.display = 'none';
        
        // Show controls for Big 2
        if (gameType === 'big2') {
            if (playBtn) playBtn.style.display = 'inline-block';
            if (passBtn) {
                // Can't pass on first play
                passBtn.style.display = (currentPlay.length === 0 && !canFollow) ? 'none' : 'inline-block';
            }
        }
    } else {
        yourTurnEl.style.display = 'none';
        const currentPlayer = players.find(p => p.id === currentPlayerId);
        if (currentPlayer) {
            turnIndicatorEl.textContent = `${currentPlayer.name}'s turn`;
            turnIndicatorEl.style.display = 'block';
        }
        
        // Hide controls when not your turn
        if (playBtn) playBtn.style.display = 'none';
        if (passBtn) passBtn.style.display = 'none';
    }
    
    updatePlayerList();
}

function showGameControls() {
    // Create play/pass buttons if they don't exist
    if (!document.getElementById('playBtn')) {
        const controlsDiv = document.createElement('div');
        controlsDiv.id = 'gameControls';
        controlsDiv.style.cssText = 'position:fixed; bottom:180px; left:50%; transform:translateX(-50%); z-index:60; display:none;';
        
        const playBtn = document.createElement('button');
        playBtn.id = 'playBtn';
        playBtn.textContent = 'Play Selected';
        playBtn.className = 'btn btn-primary';
        playBtn.style.marginRight = '10px';
        playBtn.onclick = playSelectedCards;
        
        const passBtn = document.createElement('button');
        passBtn.id = 'passBtn';
        passBtn.textContent = 'Pass';
        passBtn.className = 'btn btn-secondary';
        passBtn.onclick = passTurn;
        
        controlsDiv.appendChild(playBtn);
        controlsDiv.appendChild(passBtn);
        document.body.appendChild(controlsDiv);
    }
    
    if (gameType === 'big2') {
        document.getElementById('gameControls').style.display = 'block';
    }
}

function playSelectedCards() {
    if (selectedCards.length === 0) {
        showError('Select cards to play');
        return;
    }
    sendMessage({ type: 'playCard', cards: selectedCards });
}

function passTurn() {
    sendMessage({ type: 'pass' });
}

function updateCurrentPlayDisplay(cards) {
    const currentPlayEl = document.getElementById('currentPlay');
    if (!currentPlayEl) return;
    
    if (!cards || cards.length === 0) {
        currentPlayEl.style.display = 'none';
        return;
    }
    
    const suitSymbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
    const cardStrs = cards.map(c => `${c.rank}${suitSymbols[c.suit]}`).join(' ');
    currentPlayEl.innerHTML = `<strong>Current Play:</strong><br>${cardStrs}`;
    currentPlayEl.style.display = 'block';
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
