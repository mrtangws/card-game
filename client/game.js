/**
 * Card Game Client - Phaser-based frontend
 * Connects to WebSocket server for multiplayer gameplay
 */

const WS_URL = (window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + window.location.host;

// Game state
let ws = null;
let clientId = null;
let playerName = localStorage.getItem('cardGamePlayerName') || 'Player';
let roomId = null;
let gameType = 'hearts'; // 'hearts' or 'big2'
let players = [];
let myHand = [];
let myIndex = 0;
let currentPlayerId = null;
let gameStarted = false;
let trick = [];
let selectedCards = []; // For Big 2 multi-card selection

// Snake game state
let snakeBoardWidth = 40;
let snakeBoardHeight = 30;
let snakePlayers = []; // Array of {id, name, color, snake, score, alive}
let snakeFood = [];
let snakeCellSize = 20; // Pixels per cell
let snakeGraphics = null; // Phaser graphics for snake rendering
let snakeKeyListeners = null; // Keyboard listeners for snake
let currentPlay = [];   // Current play on table (Big 2)
let canFollow = true;   // Whether you can follow current play (Big 2)
let playHistory = [];   // Last 10 plays for Big 2

// Phaser config
const config = {
    type: Phaser.AUTO,
    parent: 'gameContainer',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#1a1a2e',  // Dark navy - distinct from green play area
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
    
    // Pre-fill player name from localStorage
    const savedName = localStorage.getItem('cardGamePlayerName');
    if (savedName) {
        document.getElementById('playerName').value = savedName;
    }
    
    // UI event listeners
    document.getElementById('createBtn').addEventListener('click', createRoom);
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('startBtn').addEventListener('click', startGame);
    document.getElementById('playerName').addEventListener('change', updateName);
    
    // Snake Start Game button
    const startSnakeBtn = document.getElementById('startSnakeBtn');
    if (startSnakeBtn) startSnakeBtn.addEventListener('click', startSnakeGame);
    
    // Game type change: show/hide Snake button
    const gameTypeSel = document.getElementById('gameTypeSelect');
    if (gameTypeSel) gameTypeSel.addEventListener('change', updateLobbyForGameType);
    
    // Create Phaser game
    game = new Phaser.Game(config);
    
    // Initial lobby update
    updateLobbyForGameType();
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
            gameType = data.gameType || 'hearts';  // Set gameType from server
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
            
        // Snake specific messages
        case 'snakeGameStarted':
            handleSnakeGameStarted(data);
            break;
            
        case 'snakeGameJoined':
            handleSnakeGameJoined(data);
            break;
            
        case 'snakeState':
            handleSnakeState(data);
            break;
            
        case 'snakeGameOver':
            handleSnakeGameOver(data);
            break;
            
        case 'snakeYouDied':
            handleSnakeYouDied(data);
            break;
            
        case 'snakeRestartProgress':
            handleSnakeRestartProgress(data);
            break;
            
        case 'snakePlayerLeft':
            // Just update player list; the server continues the game
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

function updateLobbyForGameType() {
    const sel = document.getElementById('gameTypeSelect');
    const isSnake = sel && sel.value === 'snake';
    const createBtn = document.getElementById('createBtn');
    const joinBtn = document.getElementById('joinBtn');
    const roomCode = document.getElementById('roomCode');
    const startSnakeBtn = document.getElementById('startSnakeBtn');
    
    if (createBtn) createBtn.style.display = isSnake ? 'none' : 'inline-block';
    if (joinBtn) joinBtn.style.display = isSnake ? 'none' : 'inline-block';
    if (roomCode) roomCode.parentElement.style.display = isSnake ? 'none' : 'block';
    if (startSnakeBtn) startSnakeBtn.style.display = isSnake ? 'block' : 'none';
    
    showGameCounts();
}

function startSnakeGame() {
    updateName();
    gameType = 'snake';
    // Send startGame - server will find or create a Snake game
    sendMessage({ type: 'startGame' });
}

function showGameCounts() {
    const el = document.getElementById('gameCountsText');
    if (!el) return;
    // Count running games by type (approximate from known rooms via server state)
    // For now, just show a placeholder; server could broadcast counts
    el.textContent = 'Hearts: ? | Big 2: ? | Snake: ?';
    // TODO: server can broadcast a 'gameCounts' message; client would update this
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
    localStorage.setItem('cardGamePlayerName', playerName);
    sendMessage({ type: 'setName', name: playerName });
}

function startGame() {
    sendMessage({ type: 'startGame' });
}

function showRoomInfo() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('roomInfo').style.display = 'block';
    document.getElementById('roomIdDisplay').textContent = roomId;
    
    // Show correct max player count based on game type
    const maxPlayers = gameType === 'snake' ? 10 : 4;
    const playerCountText = document.getElementById('playerCountText');
    if (playerCountText) {
        playerCountText.textContent = `${players.length}/${maxPlayers} players`;
    }
    
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
    
    // Update instructions based on game type
    const list = document.getElementById('instructionsList');
    if (list) {
        if (gameType === 'big2') {
            list.innerHTML = `
                <li>Play the 3 of Diamonds to start</li>
                <li>Play 1, 2, or 5 cards (singles, pairs, poker hands)</li>
                <li>No triples allowed!</li>
                <li>Beat the previous play or pass</li>
                <li>First to empty hand wins!</li>
            `;
        } else if (gameType === 'snake') {
            list.innerHTML = `
                <li>Arrow keys or WASD to move</li>
                <li>Eat food (yellow dots) to grow</li>
                <li>Avoid walls and other snakes</li>
                <li>Highest score wins!</li>
            `;
        } else {
            // Hearts default
            list.innerHTML = `
                <li>Play the 2 of Clubs to start</li>
                <li>Follow suit if you can</li>
                <li>Try to avoid hearts and the Queen of Spades</li>
                <li>Lowest score wins!</li>
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
        
        // For Snake, show score and alive status
        let scoreText = '';
        if (gameType === 'snake') {
            const aliveText = player.alive === false ? ' 💀' : '';
            scoreText = `${player.score || 0} pts${aliveText}`;
        } else {
            scoreText = `${player.score || 0} pts`;
        }
        
        div.innerHTML = `
            <span>${nameText}${aiText}</span>
            <span class="score">${scoreText}</span>
        `;
        
        listEl.appendChild(div);
    });
    
    // Update room info player count
    const pcText = document.getElementById('playerCountText');
    if (pcText) {
        const maxPlayers = gameType === 'snake' ? 10 : 4;
        pcText.textContent = `${players.length}/${maxPlayers} players`;
    }
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
    
    // Hide Play/Pass buttons
    const playBtn = document.getElementById('playBtn');
    const passBtn = document.getElementById('passBtn');
    if (playBtn) playBtn.style.display = 'none';
    if (passBtn) passBtn.style.display = 'none';
    
    // Show New Game button
    showNewGameButton();
    
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

function showNewGameButton() {
    let newGameDiv = document.getElementById('newGameDiv');
    if (!newGameDiv) {
        newGameDiv = document.createElement('div');
        newGameDiv.id = 'newGameDiv';
        newGameDiv.style.cssText = 'position:fixed; bottom:220px; left:50%; transform:translateX(-50%); z-index:60;';
        
        const btn = document.createElement('button');
        btn.id = 'newGameBtn';
        btn.textContent = 'New Game';
        btn.className = 'btn btn-primary';
        btn.style.fontSize = '20px';
        btn.onclick = clickNewGame;
        
        newGameDiv.appendChild(btn);
        document.body.appendChild(newGameDiv);
    }
    newGameDiv.style.display = 'block';
}

function clickNewGame() {
    // Tell server we want to start new game
    sendMessage({ type: 'newGame' });
    // Hide the button so it doesn't block the new game
    const newGameDiv = document.getElementById('newGameDiv');
    if (newGameDiv) {
        newGameDiv.style.display = 'none';
    }
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
    
    // Add to play history
    addToPlayHistory(player?.name || 'Player', data.cards, data.playType);
    
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
    
    // Add pass to play history
    addToPlayHistory(player?.name || 'Player', null, 'pass');
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

function addToPlayHistory(playerName, cards, playType) {
    let text = '';
    if (playType === 'pass') {
        text = 'Pass';
    } else if (cards && cards.length > 0) {
        const suitSymbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
        text = cards.map(c => `${c.rank}${suitSymbols[c.suit]}`).join(' ');
        if (playType) text += ` (${playType})`;
    }
    
    playHistory.unshift({ player: playerName, text: text, time: Date.now() });
    
    // Keep only last 10
    if (playHistory.length > 10) playHistory.pop();
    
    // Update history panel
    updatePlayHistoryPanel();
}

function updatePlayHistoryPanel() {
    let panel = document.getElementById('playHistoryPanel');
    if (!panel) {
        // Create panel
        panel = document.createElement('div');
        panel.id = 'playHistoryPanel';
        panel.style.cssText = 'position:fixed; top:220px; right:20px; width:200px; max-height:400px; overflow-y:auto; background:rgba(0,0,0,0.8); color:white; padding:15px; border-radius:10px; font-size:13px; z-index:50;';
        panel.innerHTML = '<h4 style="margin:0 0 10px 0; color:#fff;">Play History</h4><div id="playHistoryList"></div>';
        document.body.appendChild(panel);
    }
    
    const list = document.getElementById('playHistoryList');
    if (!list) return;
    
    list.innerHTML = playHistory.map(p => 
        `<div style="margin:5px 0; padding:5px; background:rgba(255,255,255,0.1); border-radius:4px;">
            <strong style="color:#4CAF50">${p.player}</strong>: ${p.text}
        </div>`
    ).join('');
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

// ===== Snake Game Handlers =====

function handleSnakeGameStarted(data) {
    gameStarted = true;
    gameType = 'snake';
    // Support both new world-based and old board-based
    snakeBoardWidth = data.worldWidth || data.boardWidth || 40;
    snakeBoardHeight = data.worldHeight || data.boardHeight || 30;
    snakePlayers = data.players || [];
    snakeFood = data.food || [];
    
    // Hide restart button if visible
    const restartDiv = document.getElementById('snakeRestartDiv');
    if (restartDiv) restartDiv.style.display = 'none';
    
    hideLobby();
    showGameUI();
    updatePlayerList();
    
    // Set up Snake rendering
    setupSnakeScene();
    
    // Set up keyboard controls
    setupSnakeControls();
    
    showStatus('Snake game started! Use arrow keys or WASD to move.', 3000);
}

function handleSnakeGameJoined(data) {
    // Mid-game join (player added to existing game)
    gameStarted = true;
    gameType = 'snake';
    snakeBoardWidth = data.worldWidth || 1000;
    snakeBoardHeight = data.worldHeight || 1000;
    snakePlayers = data.players || [];
    snakeFood = data.food || [];
    
    hideLobby();
    showGameUI();
    updatePlayerList();
    setupSnakeScene();
    setupSnakeControls();
    
    showStatus('Joined Snake game! Use arrow keys or WASD to move.', 3000);
}

function handleSnakeYouDied(data) {
    // Human died → return to lobby
    gameStarted = false;
    if (snakeKeyListeners) { snakeKeyListeners.forEach(k => k.destroy()); snakeKeyListeners = null; }
    
    showStatus('You died! Returning to lobby...', 2000);
    
    // Show lobby again after brief delay
    setTimeout(() => {
        const restartDiv = document.getElementById('snakeRestartDiv');
        if (restartDiv) restartDiv.style.display = 'none';
        document.getElementById('players').style.display = 'none';
        document.getElementById('roomInfo').style.display = 'none';
        document.getElementById('lobby').style.display = 'block';
        showGameCounts();
    }, 2000);
}

function handleSnakeState(data) {
    snakePlayers = data.players || [];
    snakeFood = data.food || [];
    updatePlayerList();
    renderSnake();
}

function handleSnakeGameOver(data) {
    gameStarted = false;
    
    // Clean up snake controls
    if (snakeKeyListeners) {
        snakeKeyListeners.forEach(k => k.destroy());
        snakeKeyListeners = null;
    }
    
    const winner = data.winner;
    let message = winner ? `🏆 ${winner.name} wins with ${winner.score} points!` : 'Game Over!';
    showStatus(message, 5000);
    
    // Show final scores
    showSnakeFinalScores(data.players);
    
    // Show restart button for Snake
    showSnakeRestartButton();
}

function showSnakeRestartButton() {
    let restartDiv = document.getElementById('snakeRestartDiv');
    if (!restartDiv) {
        restartDiv = document.createElement('div');
        restartDiv.id = 'snakeRestartDiv';
        restartDiv.style.cssText = 'position:fixed; bottom:220px; left:50%; transform:translateX(-50%); z-index:60; text-align:center;';
        
        const btn = document.createElement('button');
        btn.id = 'snakeRestartBtn';
        btn.textContent = 'Restart Game';
        btn.className = 'btn btn-primary';
        btn.style.fontSize = '20px';
        btn.onclick = clickSnakeRestart;
        
        const status = document.createElement('div');
        status.id = 'snakeRestartStatus';
        status.style.cssText = 'margin-top:10px; color:#fff; font-size:14px;';
        
        restartDiv.appendChild(btn);
        restartDiv.appendChild(status);
        document.body.appendChild(restartDiv);
    }
    restartDiv.style.display = 'block';
    
    // Reset button and status for fresh restart (important for 2nd+ game)
    const btn = document.getElementById('snakeRestartBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Restart Game';
    }
    const statusEl = document.getElementById('snakeRestartStatus');
    if (statusEl) statusEl.textContent = '';
}

function clickSnakeRestart() {
    sendMessage({ type: 'snakeRestart' });
    const btn = document.getElementById('snakeRestartBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Waiting for others...';
    }
}

function handleSnakeRestartProgress(data) {
    const statusEl = document.getElementById('snakeRestartStatus');
    if (statusEl) {
        statusEl.textContent = `${data.readyCount}/${data.totalHumans} players ready to restart`;
    }
}

function setupSnakeScene() {
    if (!scene) return;
    
    // Clear existing content
    scene.children.removeAll(true);
    
    // Viewport is always 40x30 (cells), world can be 1000x1000
    const vpW = 40;
    const vpH = 30;
    
    const screenWidth = scene.scale.width;
    const screenHeight = scene.scale.height;
    const padding = 40;
    const availableWidth = screenWidth - padding * 2;
    const availableHeight = screenHeight - padding * 2;
    
    snakeCellSize = Math.min(
        Math.floor(availableWidth / vpW),
        Math.floor(availableHeight / vpH)
    );
    
    const boardPixelWidth = vpW * snakeCellSize;
    const boardPixelHeight = vpH * snakeCellSize;
    const offsetX = (screenWidth - boardPixelWidth) / 2;
    const offsetY = (screenHeight - boardPixelHeight) / 2;
    
    // Dark outer area (non-play)
    scene.add.graphics().fillStyle(0x1a1a2e, 1).fillRect(0, 0, screenWidth, screenHeight);
    
    // Viewport background (green play area)
    const boardBg = scene.add.graphics();
    boardBg.fillStyle(0x0a4d2e, 1);
    boardBg.fillRect(offsetX, offsetY, boardPixelWidth, boardPixelHeight);
    
    // Grid
    boardBg.lineStyle(1, 0x1a5c3a, 0.3);
    for (let x = 0; x <= vpW; x++) {
        boardBg.moveTo(offsetX + x * snakeCellSize, offsetY);
        boardBg.lineTo(offsetX + x * snakeCellSize, offsetY + boardPixelHeight);
    }
    for (let y = 0; y <= vpH; y++) {
        boardBg.moveTo(offsetX, offsetY + y * snakeCellSize);
        boardBg.lineTo(offsetX + boardPixelWidth, offsetY + y * snakeCellSize);
    }
    boardBg.strokePath();
    
    scene.snakeOffsetX = offsetX;
    scene.snakeOffsetY = offsetY;
    scene.viewportWidth = vpW;
    scene.viewportHeight = vpH;
    
    snakeGraphics = scene.add.graphics();
    
    renderSnake();
}

function renderSnake() {
    if (!scene || !snakeGraphics) return;
    
    snakeGraphics.clear();
    
    const offsetX = scene.snakeOffsetX || 0;
    const offsetY = scene.snakeOffsetY || 0;
    const vpW = scene.viewportWidth || 40;
    const vpH = scene.viewportHeight || 30;
    
    // Find my snake to center viewport
    let mySnake = snakePlayers.find(p => p.id === clientId && p.alive);
    if (!mySnake && snakePlayers.length > 0) mySnake = snakePlayers[0]; // fallback
    
    let viewX = 0, viewY = 0; // viewport origin in world coords
    if (mySnake && mySnake.snake && mySnake.snake.length > 0) {
        const head = mySnake.snake[0];
        viewX = Math.floor(head.x - vpW / 2);
        viewY = Math.floor(head.y - vpH / 2);
    }
    
    // Clamp viewport to world bounds
    const worldW = snakeBoardWidth || 1000;
    const worldH = snakeBoardHeight || 1000;
    viewX = Math.max(0, Math.min(worldW - vpW, viewX));
    viewY = Math.max(0, Math.min(worldH - vpH, viewY));
    
    // Draw food within viewport
    snakeFood.forEach(food => {
        if (food.x < viewX || food.x >= viewX + vpW || food.y < viewY || food.y >= viewY + vpH) return;
        const x = offsetX + (food.x - viewX) * snakeCellSize + snakeCellSize / 2;
        const y = offsetY + (food.y - viewY) * snakeCellSize + snakeCellSize / 2;
        snakeGraphics.fillStyle(0xffeb3b, 1);
        snakeGraphics.fillCircle(x, y, snakeCellSize / 2 - 2);
    });
    
    // Draw snakes within viewport
    snakePlayers.forEach(player => {
        if (!player.alive || !player.snake) return;
        const color = parseInt(player.color?.replace('#', '0x') || '0x4CAF50');
        player.snake.forEach((seg, index) => {
            if (seg.x < viewX || seg.x >= viewX + vpW || seg.y < viewY || seg.y >= viewY + vpH) return;
            const x = offsetX + (seg.x - viewX) * snakeCellSize;
            const y = offsetY + (seg.y - viewY) * snakeCellSize;
            
            if (index === 0) {
                snakeGraphics.fillStyle(color, 1);
                snakeGraphics.fillRoundedRect(x + 1, y + 1, snakeCellSize - 2, snakeCellSize - 2, 4);
                // Eyes
                snakeGraphics.fillStyle(0xffffff, 1);
                const eyeSize = snakeCellSize / 6;
                const eyeOffset = snakeCellSize / 4;
                snakeGraphics.fillCircle(x + eyeOffset, y + eyeOffset, eyeSize);
                snakeGraphics.fillCircle(x + snakeCellSize - eyeOffset, y + eyeOffset, eyeSize);
            } else {
                snakeGraphics.fillStyle(color, 0.8);
                snakeGraphics.fillRoundedRect(x + 2, y + 2, snakeCellSize - 4, snakeCellSize - 4, 3);
            }
        });
    });
}

function setupSnakeControls() {
    if (!scene) return;
    
    // Clean up old listeners
    if (snakeKeyListeners) {
        snakeKeyListeners.forEach(k => k.destroy());
    }
    snakeKeyListeners = [];
    
    // Arrow keys and WASD
    const keys = {
        'UP': Phaser.Input.Keyboard.KeyCodes.UP,
        'DOWN': Phaser.Input.Keyboard.KeyCodes.DOWN,
        'LEFT': Phaser.Input.Keyboard.KeyCodes.LEFT,
        'RIGHT': Phaser.Input.Keyboard.KeyCodes.RIGHT,
        'W': Phaser.Input.Keyboard.KeyCodes.W,
        'A': Phaser.Input.Keyboard.KeyCodes.A,
        'S': Phaser.Input.Keyboard.KeyCodes.S,
        'D': Phaser.Input.Keyboard.KeyCodes.D
    };
    
    Object.keys(keys).forEach(name => {
        const key = scene.input.keyboard.addKey(keys[name]);
        key.on('down', () => {
            let direction;
            switch (name) {
                case 'UP': case 'W': direction = 'up'; break;
                case 'DOWN': case 'S': direction = 'down'; break;
                case 'LEFT': case 'A': direction = 'left'; break;
                case 'RIGHT': case 'D': direction = 'right'; break;
            }
            if (direction) {
                sendMessage({ type: 'snakeInput', direction });
            }
        });
        snakeKeyListeners.push(key);
    });
}

function showSnakeFinalScores(playerList) {
    const scoresDiv = document.getElementById('scores');
    if (!scoresDiv) return;
    
    scoresDiv.style.display = 'block';
    
    // Sort by score descending, then alive players before dead (even if scores tied)
    const sorted = [...playerList].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Same score: alive before dead
        return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
    });
    
    let html = '<h3>🐍 Snake Results</h3><table><tr><th>Rank</th><th>Player</th><th>Score</th></tr>';
    sorted.forEach((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        const status = p.alive ? '' : ' (Dead)';
        html += `<tr><td>${i+1} ${medal}</td><td>${p.name}${status}</td><td>${p.score}</td></tr>`;
    });
    html += '</table>';
    
    scoresDiv.innerHTML = html;
    
    setTimeout(() => {
        scoresDiv.style.display = 'none';
    }, 10000);
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
        if (gameType === 'snake' && gameStarted) {
            setupSnakeScene();
        } else {
            drawTable();
            renderHand();
        }
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
