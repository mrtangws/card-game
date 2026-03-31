/**
 * Card Game Server - Turn-based Hearts-style card game
 * Supports multiplayer with WebSocket connections
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Card suits and ranks
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Game states
const GAME_STATES = {
    WAITING: 'waiting',
    DEALING: 'dealing',
    PLAYING: 'playing',
    TRICK_END: 'trick_end',
    ROUND_END: 'round_end',
    GAME_END: 'game_end'
};

// Big 2 specific constants
// Big 2 card ranking: 3 is smallest, 2 is biggest
const BIG2_RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
// Big 2 suit ranking (ascending strength): diamond < clubs < hearts < spades
const BIG2_SUIT_ORDER = { 'diamonds': 0, 'clubs': 1, 'hearts': 2, 'spades': 3 };

// Client connections and game rooms
const clients = new Map(); // ws -> clientData
const rooms = new Map(); // roomId -> roomData

// Create HTTP server for serving static files
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, '..', 'client', filePath);
    
    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.json': 'application/json'
    };
    
    const contentType = contentTypes[extname] || 'text/plain';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    const clientId = generateId();
    clients.set(ws, {
        id: clientId,
        name: `Player${clientId.slice(0, 4)}`,
        roomId: null,
        ws: ws
    });
    
    sendToClient(ws, {
        type: 'connected',
        clientId: clientId
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Invalid message:', e);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected:', clientId);
        handleDisconnect(ws);
    });
});

function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

// Snake colors for player identification
const SNAKE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#795548', '#607D8B', '#E91E63', '#8BC34A'];

// Color names (matching SNAKE_COLORS order) + extra colors for AI naming
const COLOR_NAMES = ['Green', 'Blue', 'Orange', 'Purple', 'Red', 'Cyan', 'Brown', 'Grey', 'Pink', 'Lime'];

// Animal names for AI snake naming
const ANIMAL_NAMES = ['Fox', 'Snake', 'Wolf', 'Hawk', 'Lion', 'Tiger', 'Bear', 'Eagle', 'Cobra', 'Shark', 'Panther', 'Falcon', 'Leopard', 'Raven', 'Viper'];

function getRandomSnakeColor() {
    return SNAKE_COLORS[Math.floor(Math.random() * SNAKE_COLORS.length)];
}

function getRandomAIColorName() {
    return COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
}

function getRandomAIAnimalName() {
    return ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)];
}

function generateAIName() {
    return `${getRandomAIColorName()} ${getRandomAIAnimalName()}`;
}

function sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastToRoom(roomId, data, excludeWs = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.players.forEach(player => {
        if (player.ws && player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(data));
        }
    });
}

function handleMessage(ws, data) {
    const client = clients.get(ws);
    if (!client) return;
    
    console.log('Received:', data.type, 'from', client.id);
    
    switch (data.type) {
        case 'setName':
            client.name = data.name || client.name;
            sendToClient(ws, { type: 'nameSet', name: client.name });
            break;
            
        case 'createRoom':
            createRoom(ws, client, data.gameType || 'hearts');
            break;
            
        case 'joinRoom':
            joinRoom(ws, client, data.roomId);
            break;
            
        case 'startGame':
            startGame(ws, client);
            break;
            
        case 'playCard':
            playCard(ws, client, data.card || data.cards);
            break;
            
        case 'pass':
            handleBig2Pass(ws, client);
            break;
            
        case 'newGame':
            handleNewGame(ws, client);
            break;
            
        case 'leaveRoom':
            leaveRoom(ws, client);
            break;
            
        case 'snakeInput':
            handleSnakeInput(ws, client, data.direction);
            break;
            
        case 'snakeRestart':
            handleSnakeRestart(ws, client);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleDisconnect(ws) {
    const client = clients.get(ws);
    if (!client) return;
    
    if (client.roomId) {
        const room = rooms.get(client.roomId);
        if (room) {
            // Remove player from room
            room.players = room.players.filter(p => p.id !== client.id);
            
            if (room.players.length === 0) {
                // Stop any game loop (Snake)
                if (room.gameLoopTimeout) {
                    clearTimeout(room.gameLoopTimeout);
                }
                if (room.foodSpawner) {
                    clearInterval(room.foodSpawner);
                }
                if (room.leaderboardInterval) {
                    clearInterval(room.leaderboardInterval);
                }
                rooms.delete(client.roomId);
            } else {
                broadcastToRoom(client.roomId, {
                    type: 'playerLeft',
                    playerId: client.id,
                    playerName: client.name
                });
                
                // If game was in progress, handle based on game type
                if (room.gameState !== GAME_STATES.WAITING) {
                    if (room.gameType === 'snake') {
                        // For Snake: if only 1 player left, end game
                        if (room.players.length === 1) {
                            endSnakeGame(room);
                        } else {
                            // Continue but mark the disconnected player as dead
                            broadcastToRoom(client.roomId, {
                                type: 'snakePlayerLeft',
                                playerId: client.id
                            });
                        }
                    } else {
                        // Card games: end the game
                        broadcastToRoom(client.roomId, {
                            type: 'gameEnded',
                            reason: 'Player disconnected'
                        });
                        room.gameState = GAME_STATES.WAITING;
                    }
                }
            }
        }
    }
    
    clients.delete(ws);
}

function createRoom(ws, client, gameType = 'hearts') {
    const roomId = generateId().slice(0, 6).toUpperCase();
    
    // Snake game has different room structure
    if (gameType === 'snake') {
        return createSnakeRoom(ws, client, roomId);
    }
    
    const room = {
        id: roomId,
        gameType: gameType, // 'hearts' or 'big2'
        players: [{
            id: client.id,
            name: client.name,
            ws: ws,
            hand: [],
            score: 0,
            tricksWon: 0,
            isAI: false
        }],
        gameState: GAME_STATES.WAITING,
        currentPlayerIndex: 0,
        trick: [],
        leadSuit: null,
        roundNumber: 0,
        maxScore: 100,
        heartsBroken: false,
        // Big 2 specific
        currentPlay: [],       // Current play on table
        lastPlayerToPlay: null // Who made the last play (for initiative)
    };
    
    rooms.set(roomId, room);
    client.roomId = roomId;
    
    sendToClient(ws, {
        type: 'roomCreated',
        roomId: roomId,
        gameType: gameType,
        players: room.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI }))
    });
    
    console.log(`Room ${roomId} (${gameType}) created by ${client.name}`);
}

/**
 * Create a Snake game room (supports up to 10 players)
 */
function createSnakeRoom(ws, client, roomId) {
    const room = {
        id: roomId,
        gameType: 'snake',
        players: [{
            id: client.id,
            name: client.name,
            ws: ws,
            isAI: false,
            // Snake-specific state
            snake: [],       // Array of {x, y} segments
            direction: 'right',
            nextDirection: 'right',
            score: 0,
            alive: true,
            color: getRandomSnakeColor()
        }],
        gameState: GAME_STATES.WAITING,
        // Snake game config
        boardWidth: 40,
        boardHeight: 30,
        targetTickRate: 100,      // ms per tick (final/fastest speed)
        initialTickRate: 500,     // ms per tick (base speed - 100% faster than before)
        currentTickMs: 500,       // current tick speed (starts at base)
        food: [],                 // Array of {x, y}
        maxPlayers: 10,
        gameLoopTimeout: null     // using setTimeout for variable speed
    };
    
    rooms.set(roomId, room);
    client.roomId = roomId;
    
    sendToClient(ws, {
        type: 'roomCreated',
        roomId: roomId,
        gameType: 'snake',
        players: room.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI, score: 0 }))
    });
    
    console.log(`Snake room ${roomId} created by ${client.name}`);
}

function joinRoom(ws, client, roomId) {
    const room = rooms.get(roomId);
    
    if (!room) {
        sendToClient(ws, { type: 'error', message: 'Room not found' });
        return;
    }
    
    // Snake allows up to 10 players
    const maxPlayers = room.gameType === 'snake' ? (room.maxPlayers || 10) : 4;
    
    if (room.players.length >= maxPlayers) {
        sendToClient(ws, { type: 'error', message: 'Room is full' });
        return;
    }
    
    if (room.gameState !== GAME_STATES.WAITING) {
        sendToClient(ws, { type: 'error', message: 'Game already in progress' });
        return;
    }
    
    // Snake-specific player structure
    if (room.gameType === 'snake') {
        room.players.push({
            id: client.id,
            name: client.name,
            ws: ws,
            isAI: false,
            snake: [],
            direction: 'right',
            nextDirection: 'right',
            score: 0,
            alive: true,
            color: getRandomSnakeColor()
        });
    } else {
        room.players.push({
            id: client.id,
            name: client.name,
            ws: ws,
            hand: [],
            score: 0,
            tricksWon: 0,
            isAI: false
        });
    }
    
    client.roomId = roomId;
    
    // Broadcast to all in room
    const playerList = room.players.map(p => ({ 
        id: p.id, 
        name: p.name, 
        isAI: p.isAI,
        ...(room.gameType === 'snake' ? { score: p.score } : {})
    }));
    
    broadcastToRoom(roomId, {
        type: 'playerJoined',
        player: { id: client.id, name: client.name },
        players: playerList
    });
    
    sendToClient(ws, {
        type: 'roomJoined',
        roomId: roomId,
        gameType: room.gameType,
        players: playerList
    });
    
    console.log(`${client.name} joined room ${roomId}`);
}

function startGame(ws, client) {
    const room = rooms.get(client.roomId);
    
    // Snake: special flow - find or create a game instance
    if (room && room.gameType === 'snake') {
        // If game is over, clear roomId and treat as new join
        if (room.gameState === GAME_STATES.GAME_END) {
            client.roomId = null;
            // fall through to findOrCreate below
        } else {
            // Already in a Snake room and is host → just start
            if (room.players[0].id === client.id) {
                if (room.gameState === GAME_STATES.WAITING) {
                    initializeSnakeGame(room);
                }
                return;
            }
            // If in a room but not host, ignore (they're already in a game)
            return;
        }
    }
    
    // If not in a snake room, or room is not snake: handle Snake "find or create"
    // This is triggered when client clicks "Start Game" for Snake without being in a room
    // We need to check if the client is trying to play Snake
    // For simplicity, we'll check: if client has no roomId or room is not snake, treat as Snake start
    // (Card games require explicit createRoom/joinRoom first)
    
    // Find or create a Snake game for this player
    const snakeRoom = findOrCreateSnakeGame(client);
    if (!snakeRoom) {
        sendToClient(ws, { type: 'error', message: 'Could not join Snake game' });
        return;
    }
    
    // If game is waiting and has players, start it (or if already running, just add player)
    if (snakeRoom.gameState === GAME_STATES.WAITING) {
        initializeSnakeGame(snakeRoom);
    }
    
    console.log(`${client.name} joined Snake game ${snakeRoom.id}`);
}

function findOrCreateSnakeGame(client) {
    // Find a Snake room with < 10 humans
    for (const [roomId, room] of rooms.entries()) {
        if (room.gameType === 'snake' && room.gameState !== GAME_STATES.GAME_END) {
            const humanCount = room.players.filter(p => !p.isAI).length;
            if (humanCount < 10) {
                // Add this player to existing game
                addHumanToSnakeGame(room, client);
                return room;
            }
        }
    }
    
    // No available game: create new one with 10 AI
    const roomId = generateId().slice(0, 6).toUpperCase();
    const room = {
        id: roomId,
        gameType: 'snake',
        players: [],
        gameState: GAME_STATES.WAITING,
        // World config
        worldWidth: 1000,
        worldHeight: 1000,
        viewportWidth: 40,
        viewportHeight: 30,
        // Tick/speed config
        targetTickRate: 100,
        initialTickRate: 500,   // base speed (100% faster)
        currentTickMs: 500,     // starts at base
        food: [],
        maxHumans: 10,
        gameLoopTimeout: null
    };
    
    // Spawn 10 AI snakes
    for (let i = 0; i < 10; i++) {
        room.players.push(createAISnakePlayer(i));
    }
    
    // Add the human player
    addHumanToSnakeGame(room, client);
    
    rooms.set(roomId, room);
    console.log(`Created new Snake game ${roomId} with 10 AI + 1 human`);
    return room;
}

function createAISnakePlayer(index) {
    const spawn = randomSpawnPosition(1000, 1000, 5);
    return {
        id: `ai_${generateId()}`,
        name: generateAIName(), // e.g., "Red Fox", "Blue Cobra"
        ws: null,
        isAI: true,
        snake: createInitialSnakeSegments(spawn.x, spawn.y, ['up','down','left','right'][Math.floor(Math.random()*4)]),
        direction: ['up','down','left','right'][Math.floor(Math.random()*4)],
        nextDirection: ['up','down','left','right'][Math.floor(Math.random()*4)],
        score: 0,
        alive: true,
        color: getRandomSnakeColor(),
        aiTarget: null, // For AI pathfinding
        aiSpeedMultiplier: 1.5, // AI starts slow (high tick = slow)
        lastInputTime: Date.now() // For inactivity kick
    };
}

function addHumanToSnakeGame(room, client) {
    const spawn = randomSpawnPosition(room.worldWidth, room.worldHeight, 5);
    room.players.push({
        id: client.id,
        name: client.name,
        ws: client.ws,
        isAI: false,
        snake: createInitialSnakeSegments(spawn.x, spawn.y, 'right'),
        direction: 'right',
        nextDirection: 'right',
        score: 0,
        alive: true,
        color: getRandomSnakeColor(),
        lastInputTime: Date.now() // For inactivity kick
    });
    client.roomId = room.id;
    
    // Send game state to this player
    sendToClient(client.ws, {
        type: 'snakeGameJoined',
        roomId: room.id,
        worldWidth: room.worldWidth,
        worldHeight: room.worldHeight,
        viewportWidth: room.viewportWidth,
        viewportHeight: room.viewportHeight,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            snake: p.snake,
            score: p.score,
            alive: p.alive,
            isAI: p.isAI
        })),
        food: room.food,
        isHuman: true
    });
    
    // If game already running, broadcast new player to others
    if (room.gameState === GAME_STATES.PLAYING) {
        broadcastToRoom(room.id, {
            type: 'snakePlayerJoined',
            player: { id: client.id, name: client.name, color: room.players[room.players.length-1].color }
        }, client.ws);
    }
}

function randomSpawnPosition(worldW, worldH, margin) {
    return {
        x: margin + Math.floor(Math.random() * (worldW - margin * 2)),
        y: margin + Math.floor(Math.random() * (worldH - margin * 2))
    };
}

/**
 * Create initial snake with 3 segments (head + 2 body parts)
 * direction: 'up'|'down'|'left'|'right' - body extends opposite direction
 */
function createInitialSnakeSegments(x, y, direction) {
    const segments = [{ x, y }];
    // Body goes opposite to facing direction
    for (let i = 1; i < 3; i++) {
        switch (direction) {
            case 'up':    segments.push({ x, y: y + i }); break;
            case 'down':  segments.push({ x, y: y - i }); break;
            case 'left':  segments.push({ x: x + i, y }); break;
            case 'right': segments.push({ x: x - i, y }); break;
        }
    }
    return segments;
}

function initializeGame(room) {
    // Route to Big 2 initialization if needed
    if (room.gameType === 'big2') {
        initializeBig2Game(room);
        return;
    }
    
    room.gameState = GAME_STATES.DEALING;
    room.roundNumber++;
    room.heartsBroken = false;
    room.trick = [];
    room.leadSuit = null;
    
    // Reset player hands, tricks, and cards taken
    room.players.forEach(p => {
        p.hand = [];
        p.tricksWon = 0;
        p.cardsTaken = []; // Track all cards taken this round
    });
    
    // Create and shuffle deck
    const deck = createDeck();
    shuffleDeck(deck);
    
    // Deal cards
    for (let i = 0; i < 13; i++) {
        room.players.forEach(player => {
            player.hand.push(deck.shift());
        });
    }
    
    // Sort hands
    room.players.forEach(player => {
        sortHand(player.hand);
    });
    
    // Find who has 2 of clubs (first to play)
    let startPlayerIndex = 0;
    for (let i = 0; i < room.players.length; i++) {
        if (room.players[i].hand.some(c => c.suit === 'clubs' && c.rank === '2')) {
            startPlayerIndex = i;
            break;
        }
    }
    room.currentPlayerIndex = startPlayerIndex;
    
    room.gameState = GAME_STATES.PLAYING;
    
    // Broadcast game start
    room.players.forEach((player, index) => {
        if (player.ws) {
            sendToClient(player.ws, {
                type: 'gameStarted',
                players: room.players.map(p => ({ 
                    id: p.id, 
                    name: p.name, 
                    score: p.score,
                    isAI: p.isAI 
                })),
                yourHand: player.hand,
                currentPlayer: room.players[room.currentPlayerIndex].id,
                yourIndex: index
            });
        }
    });
    
    // AI turns
    processAITurns(room);
    
    console.log(`Game started in room ${room.id}`);
}

function createDeck() {
    const deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            deck.push({ suit, rank });
        });
    });
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

function sortHand(hand) {
    const suitOrder = { 'spades': 0, 'hearts': 1, 'diamonds': 2, 'clubs': 3 };
    const rankOrder = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, 
                        '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12 };
    
    hand.sort((a, b) => {
        if (suitOrder[a.suit] !== suitOrder[b.suit]) {
            return suitOrder[a.suit] - suitOrder[b.suit];
        }
        return rankOrder[a.rank] - rankOrder[b.rank];
    });
}

// ===== Big 2 Helper Functions =====

/**
 * Get Big 2 card value for comparison
 * Higher value = stronger card
 * Ranking: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2
 */
function getBig2CardValue(card) {
    const rankValue = BIG2_RANKS.indexOf(card.rank);
    const suitValue = BIG2_SUIT_ORDER[card.suit];
    // Combine rank and suit: rank * 4 + suit gives unique ordering
    return rankValue * 4 + suitValue;
}

/**
 * Compare two Big 2 cards. Returns:
 *  1 if a > b
 * -1 if a < b
 *  0 if equal
 */
function compareBig2Cards(a, b) {
    const valA = getBig2CardValue(a);
    const valB = getBig2CardValue(b);
    return valA - valB;
}

/**
 * Check if cards form a valid Big 2 play
 * Valid plays: single (1), pair (2), or poker hand (5 cards)
 * Poker hands: straight, flush, full house, straight flush, 4 of a kind + 1
 * Triples are NOT allowed
 */
function isValidBig2Play(cards) {
    if (!cards || cards.length === 0) return { valid: false, reason: 'No cards selected' };
    
    const count = cards.length;
    
    if (count === 1) {
        return { valid: true, type: 'single' };
    }
    
    if (count === 2) {
        if (cards[0].rank === cards[1].rank) {
            return { valid: true, type: 'pair' };
        }
        return { valid: false, reason: 'Pair must have same rank' };
    }
    
    if (count === 5) {
        return validateBig2FiveCard(cards);
    }
    
    // 3 cards (triple) or 4 cards not allowed
    return { valid: false, reason: 'Invalid play: must play 1, 2, or 5 cards' };
}

/**
 * Validate 5-card Big 2 hand
 */
function validateBig2FiveCard(cards) {
    const ranks = cards.map(c => c.rank);
    const suits = cards.map(c => c.suit);
    
    // Count ranks
    const rankCounts = {};
    ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    
    // Check for 4 of a kind + 1 (bomb)
    if (counts[0] === 4) {
        return { valid: true, type: 'four_of_a_kind' };
    }
    
    // Check for full house (3 + 2)
    if (counts[0] === 3 && counts[1] === 2) {
        return { valid: true, type: 'full_house' };
    }
    
    // Check for flush (all same suit)
    const isFlush = suits.every(s => s === suits[0]);
    
    // Check for straight (5 consecutive ranks)
    const sortedRanks = [...ranks].sort((a, b) => BIG2_RANKS.indexOf(a) - BIG2_RANKS.indexOf(b));
    const isStraight = sortedRanks.every((r, i) => 
        i === 0 || BIG2_RANKS.indexOf(r) === BIG2_RANKS.indexOf(sortedRanks[i-1]) + 1
    );
    
    // Straight flush
    if (isFlush && isStraight) {
        return { valid: true, type: 'straight_flush' };
    }
    
    // Flush
    if (isFlush) {
        return { valid: true, type: 'flush' };
    }
    
    // Straight
    if (isStraight) {
        return { valid: true, type: 'straight' };
    }
    
    return { valid: false, reason: '5 cards must form a straight, flush, full house, straight flush, or four of a kind' };
}

/**
 * Compare two Big 2 plays. Returns:
 *  1 if playA > playB (playA wins)
 * -1 if playA < playB
 *  0 if can't compare (different types)
 */
function compareBig2Plays(playA, playB) {
    // Must be same number of cards
    if (playA.length !== playB.length) return 0;
    
    const typeA = isValidBig2Play(playA);
    const typeB = isValidBig2Play(playB);
    
    if (!typeA.valid || !typeB.valid) return 0;
    if (typeA.type !== typeB.type) return 0; // Different types can't compare
    
    // Sort cards by value
    const sortedA = [...playA].sort((a, b) => getBig2CardValue(a) - getBig2CardValue(b));
    const sortedB = [...playB].sort((a, b) => getBig2CardValue(a) - getBig2CardValue(b));
    
    // For pairs and singles, compare the cards
    if (typeA.type === 'single' || typeA.type === 'pair') {
        const valA = getBig2CardValue(sortedA[sortedA.length - 1]); // Highest card
        const valB = getBig2CardValue(sortedB[sortedB.length - 1]);
        if (valA > valB) return 1;
        if (valA < valB) return -1;
        return 0;
    }
    
    // For 5-card hands, compare by highest card (except 4 of a kind: compare the 4)
    if (typeA.type === 'four_of_a_kind') {
        // Find the 4 of a kind
        const ranksA = {};
        const ranksB = {};
        sortedA.forEach(c => ranksA[c.rank] = (ranksA[c.rank] || 0) + 1);
        sortedB.forEach(c => ranksB[c.rank] = (ranksB[c.rank] || 0) + 1);
        
        const fourRankA = Object.keys(ranksA).find(r => ranksA[r] === 4);
        const fourRankB = Object.keys(ranksB).find(r => ranksB[r] === 4);
        
        const valA = BIG2_RANKS.indexOf(fourRankA);
        const valB = BIG2_RANKS.indexOf(fourRankB);
        
        if (valA > valB) return 1;
        if (valA < valB) return -1;
        return 0;
    }
    
    // For other 5-card hands, compare highest card
    const valA = getBig2CardValue(sortedA[sortedA.length - 1]);
    const valB = getBig2CardValue(sortedB[sortedB.length - 1]);
    
    if (valA > valB) return 1;
    if (valA < valB) return -1;
    return 0;
}

/**
 * Check if playA can beat playB in Big 2
 * Allows different types (e.g., full house after straight) with type hierarchy
 */
function canBeatBig2Play(playA, playB) {
    if (!playB || playB.length === 0) return true; // First play, anything valid works
    if (playA.length !== playB.length) return false; // Must match count
    
    const typeA = isValidBig2Play(playA);
    const typeB = isValidBig2Play(playB);
    
    if (!typeA.valid || !typeB.valid) return false;
    
    // Type hierarchy for 5-card hands (higher = stronger)
    const typeOrder = {
        'single': 1,
        'pair': 2,
        'straight': 3,
        'flush': 4,
        'full_house': 5,
        'four_of_a_kind': 6,
        'straight_flush': 7
    };
    
    // If same type, compare normally
    if (typeA.type === typeB.type) {
        return compareBig2Plays(playA, playB) > 0;
    }
    
    // Different types: allow if playA is higher in hierarchy
    // (e.g., full house can beat straight)
    const orderA = typeOrder[typeA.type] || 0;
    const orderB = typeOrder[typeB.type] || 0;
    
    if (orderA > orderB) return true; // Higher type beats lower
    if (orderA < orderB) return false; // Lower type cannot beat higher
    
    // Same order (shouldn't happen for different types), fall back to card comparison
    return compareBig2Plays(playA, playB) > 0;
}

/**
 * Initialize Big 2 game
 */
function initializeBig2Game(room) {
    room.gameState = GAME_STATES.DEALING;
    room.roundNumber++;
    room.currentPlay = [];
    room.lastPlayerToPlay = null;
    
    // Shuffle player order for randomized seating
    for (let i = room.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    }
    
    // Reset player hands
    room.players.forEach(p => {
        p.hand = [];
    });
    
    // Create and shuffle deck
    const deck = createDeck();
    shuffleDeck(deck);
    
    // Deal cards (13 each)
    for (let i = 0; i < 13; i++) {
        room.players.forEach(player => {
            player.hand.push(deck.shift());
        });
    }
    
    // Sort hands by Big 2 order (3 low, 2 high)
    room.players.forEach(player => {
        sortBig2Hand(player.hand);
    });
    
    // Find who has 3 of diamonds (starts the game)
    let startPlayerIndex = 0;
    for (let i = 0; i < room.players.length; i++) {
        if (room.players[i].hand.some(c => c.suit === 'diamonds' && c.rank === '3')) {
            startPlayerIndex = i;
            break;
        }
    }
    room.currentPlayerIndex = startPlayerIndex;
    
    room.gameState = GAME_STATES.PLAYING;
    
    // Broadcast game start
    room.players.forEach((player, index) => {
        if (player.ws) {
            sendToClient(player.ws, {
                type: 'gameStarted',
                gameType: 'big2',
                players: room.players.map(p => ({ 
                    id: p.id, 
                    name: p.name, 
                    isAI: p.isAI 
                })),
                yourHand: player.hand,
                currentPlayer: room.players[room.currentPlayerIndex].id,
                yourIndex: index,
                mustInclude: { suit: 'diamonds', rank: '3' } // First play must include 3♦
            });
        }
    });
    
    // AI turns
    processBig2AITurns(room);
    
    console.log(`Big 2 game started in room ${room.id}`);
}

/**
 * Sort hand by Big 2 order (3 low to 2 high)
 */
function sortBig2Hand(hand) {
    hand.sort((a, b) => {
        const valA = getBig2CardValue(a);
        const valB = getBig2CardValue(b);
        return valA - valB;
    });
}

function playCard(ws, client, cardData) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.gameState !== GAME_STATES.PLAYING) {
        return;
    }
    
    // Route to Big 2 play handler if needed
    if (room.gameType === 'big2') {
        playBig2Cards(ws, client, cardData);
        return;
    }
    
    // Hearts single card play
    const currentPlayer = room.players[room.currentPlayerIndex];
    
    if (currentPlayer.id !== client.id) {
        sendToClient(ws, { type: 'error', message: 'Not your turn' });
        return;
    }
    
    // Find the card in hand
    const cardIndex = currentPlayer.hand.findIndex(
        c => c.suit === cardData.suit && c.rank === cardData.rank
    );
    
    if (cardIndex === -1) {
        sendToClient(ws, { type: 'error', message: 'Card not in hand' });
        return;
    }
    
    const card = currentPlayer.hand[cardIndex];
    
    // Validate play
    const validation = validatePlay(room, currentPlayer, card);
    if (!validation.valid) {
        sendToClient(ws, { type: 'error', message: validation.reason });
        return;
    }
    
    // Remove card from hand and add to trick
    currentPlayer.hand.splice(cardIndex, 1);
    room.trick.push({ player: currentPlayer, card });
    
    // Check if hearts are broken
    if (card.suit === 'hearts') {
        room.heartsBroken = true;
    }
    
    // Set lead suit if first card
    if (room.trick.length === 1) {
        room.leadSuit = card.suit;
    }
    
    // Broadcast card played
    broadcastToRoom(room.id, {
        type: 'cardPlayed',
        playerId: currentPlayer.id,
        card: card,
        trick: room.trick.map(t => ({ playerId: t.player.id, card: t.card }))
    });
    
    // Next player
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    
    // Check if trick complete
    if (room.trick.length === room.players.length) {
        completeTrick(room);
    } else {
        // Update current player
        broadcastToRoom(room.id, {
            type: 'turnChanged',
            currentPlayer: room.players[room.currentPlayerIndex].id
        });
        
        // Process AI turns
        processAITurns(room);
    }
}

/**
 * Big 2 play handler - supports multiple cards
 */
function playBig2Cards(ws, client, cardsData) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.gameState !== GAME_STATES.PLAYING) {
        return;
    }
    
    const currentPlayer = room.players[room.currentPlayerIndex];
    
    if (currentPlayer.id !== client.id) {
        sendToClient(ws, { type: 'error', message: 'Not your turn' });
        return;
    }
    
    // cardsData can be single card or array of cards
    const cardsToPlay = Array.isArray(cardsData) ? cardsData : [cardsData];
    
    // Find all cards in hand
    const cardIndices = [];
    for (const cardData of cardsToPlay) {
        const idx = currentPlayer.hand.findIndex(
            c => c.suit === cardData.suit && c.rank === cardData.rank
        );
        if (idx === -1) {
            sendToClient(ws, { type: 'error', message: 'Card not in hand: ' + cardData.rank + cardData.suit });
            return;
        }
        cardIndices.push(idx);
    }
    
    // Validate the play
    const playValidation = isValidBig2Play(cardsToPlay);
    if (!playValidation.valid) {
        sendToClient(ws, { type: 'error', message: playValidation.reason });
        return;
    }
    
    // Check if first play must include 3♦
    if (room.currentPlay.length === 0 && room.lastPlayerToPlay === null) {
        const hasThreeDiamond = cardsToPlay.some(c => c.suit === 'diamonds' && c.rank === '3');
        if (!hasThreeDiamond) {
            sendToClient(ws, { type: 'error', message: 'First play must include 3 of diamonds' });
            return;
        }
    }
    
    // Check if can beat current play
    if (!canBeatBig2Play(cardsToPlay, room.currentPlay)) {
        sendToClient(ws, { type: 'error', message: 'Cannot beat current play' });
        return;
    }
    
    // Remove cards from hand (reverse order to maintain indices)
    cardIndices.sort((a, b) => b - a);
    cardIndices.forEach(idx => currentPlayer.hand.splice(idx, 1));
    
    // Update current play
    room.currentPlay = cardsToPlay;
    room.lastPlayerToPlay = currentPlayer;
    
    // Broadcast cards played
    broadcastToRoom(room.id, {
        type: 'cardsPlayed',
        playerId: currentPlayer.id,
        cards: cardsToPlay,
        playType: playValidation.type,
        handSize: currentPlayer.hand.length
    });
    
    // Check if player won (empty hand)
    if (currentPlayer.hand.length === 0) {
        completeBig2Game(room, currentPlayer);
        return;
    }
    
    // Next player
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    
    // Check if all other players passed (can't follow)
    // For simplicity, just pass to next player
    broadcastToRoom(room.id, {
        type: 'turnChanged',
        currentPlayer: room.players[room.currentPlayerIndex].id,
        currentPlay: room.currentPlay,
        canFollow: true
    });
    
    // Process AI turns
    processBig2AITurns(room);
}

function validatePlay(room, player, card) {
    // First trick must start with 2 of clubs
    if (room.trick.length === 0 && room.leadSuit === null) {
        const hasTwoClubs = player.hand.some(c => c.suit === 'clubs' && c.rank === '2');
        if (hasTwoClubs && (card.suit !== 'clubs' || card.rank !== '2')) {
            return { valid: false, reason: 'Must play 2 of clubs on first trick' };
        }
    }
    
    // Must follow suit if possible
    if (room.leadSuit && card.suit !== room.leadSuit) {
        const hasSuit = player.hand.some(c => c.suit === room.leadSuit);
        if (hasSuit) {
            return { valid: false, reason: `Must follow suit (${room.leadSuit})` };
        }
    }
    
    // Can't play hearts on first trick
    if (room.trick.length === 0 && card.suit === 'hearts' && room.roundNumber === 1) {
        const hasNonHeart = player.hand.some(c => c.suit !== 'hearts');
        if (hasNonHeart) {
            return { valid: false, reason: 'Cannot lead hearts on first trick' };
        }
    }
    
    // Can't break hearts unless necessary
    if (card.suit === 'hearts' && !room.heartsBroken && room.trick.length === 0) {
        const hasNonHeart = player.hand.some(c => c.suit !== 'hearts');
        if (hasNonHeart) {
            return { valid: false, reason: 'Hearts not broken yet' };
        }
    }
    
    return { valid: true };
}

function completeTrick(room) {
    // Determine winner (highest card of lead suit)
    const leadSuit = room.leadSuit;
    let winner = room.trick[0];
    
    for (let i = 1; i < room.trick.length; i++) {
        const t = room.trick[i];
        if (t.card.suit === leadSuit) {
            const winnerRank = RANKS.indexOf(winner.card.rank);
            const tRank = RANKS.indexOf(t.card.rank);
            if (tRank > winnerRank) {
                winner = t;
            }
        }
    }
    
    // Update tricks won
    winner.player.tricksWon++;
    
    // Track all cards taken by the winner
    room.trick.forEach(t => {
        winner.player.cardsTaken.push(t.card);
    });
    
    // Calculate points from trick
    let trickPoints = 0;
    room.trick.forEach(t => {
        if (t.card.suit === 'hearts') trickPoints += 1;
        if (t.card.suit === 'spades' && t.card.rank === 'Q') trickPoints += 13;
    });
    
    // Set next player as trick winner
    const winnerIndex = room.players.findIndex(p => p.id === winner.player.id);
    room.currentPlayerIndex = winnerIndex;
    
    // Broadcast trick complete
    broadcastToRoom(room.id, {
        type: 'trickComplete',
        winner: winner.player.id,
        points: trickPoints,
        trick: room.trick.map(t => ({ playerId: t.player.id, card: t.card }))
    });
    
    // Clear trick
    room.trick = [];
    room.leadSuit = null;
    
    // Check if round complete (all hands empty)
    const roundComplete = room.players.every(p => p.hand.length === 0);
    
    if (roundComplete) {
        completeRound(room);
    } else {
        // Continue to next trick
        broadcastToRoom(room.id, {
            type: 'turnChanged',
            currentPlayer: room.players[room.currentPlayerIndex].id
        });
        
        setTimeout(() => {
            processAITurns(room);
        }, 1000);
    }
}

function completeRound(room) {
    // Calculate scores based on actual cards taken
    let shootingMoonPlayer = null;
    
    room.players.forEach(player => {
        let heartsTaken = 0;
        let queenOfSpades = 0;
        
        player.cardsTaken.forEach(card => {
            if (card.suit === 'hearts') {
                heartsTaken++;
            }
            if (card.suit === 'spades' && card.rank === 'Q') {
                queenOfSpades = 13;
            }
        });
        
        player.roundPoints = heartsTaken + queenOfSpades;
        
        // Check for shooting the moon
        if (heartsTaken === 13 && queenOfSpades === 13) {
            shootingMoonPlayer = player;
        }
    });
    
    // Handle shooting the moon: if one player got all 26 points, they get 0 and others get 26
    if (shootingMoonPlayer) {
        room.players.forEach(player => {
            if (player.id === shootingMoonPlayer.id) {
                player.roundPoints = 0;
            } else {
                player.roundPoints = 26;
            }
        });
    }
    
    // Apply round points to total scores
    room.players.forEach(player => {
        player.score += player.roundPoints || 0;
    });
    
    room.gameState = GAME_STATES.ROUND_END;
    
    broadcastToRoom(room.id, {
        type: 'roundComplete',
        scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, roundPoints: p.roundPoints })),
        roundNumber: room.roundNumber,
        shootingMoon: shootingMoonPlayer ? { id: shootingMoonPlayer.id, name: shootingMoonPlayer.name } : null
    });
    
    // Check for game end
    const gameOver = room.players.some(p => p.score >= room.maxScore);
    
    if (gameOver) {
        const winner = room.players.reduce((min, p) => 
            p.score < min.score ? p : min
        );
        
        room.gameState = GAME_STATES.GAME_END;
        
        broadcastToRoom(room.id, {
            type: 'gameComplete',
            winner: { id: winner.id, name: winner.name, score: winner.score },
            finalScores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
        });
    } else {
        // Start next round after delay
        setTimeout(() => {
            initializeGame(room);
        }, 3000);
    }
}

function processAITurns(room) {
    const currentPlayer = room.players[room.currentPlayerIndex];
    
    if (!currentPlayer.isAI) return;
    
    setTimeout(() => {
        if (room.gameState !== GAME_STATES.PLAYING) return;
        
        // AI plays a valid card
        const validCards = getValidCards(room, currentPlayer);
        if (validCards.length === 0) return;
        
        // Simple AI: play first valid card, or lowest heart if must play heart
        let cardToPlay = validCards[0];
        
        // Prefer not to play high cards early
        if (room.trick.length === 0) {
            // Leading: play lowest card
            cardToPlay = validCards.reduce((min, c) => 
                RANKS.indexOf(c.rank) < RANKS.indexOf(min.rank) ? c : min
            );
        } else {
            // Following: try to play low
            cardToPlay = validCards.reduce((min, c) => 
                RANKS.indexOf(c.rank) < RANKS.indexOf(min.rank) ? c : min
            );
        }
        
        // Simulate playing
        const cardIndex = currentPlayer.hand.findIndex(
            c => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank
        );
        
        if (cardIndex !== -1) {
            const card = currentPlayer.hand.splice(cardIndex, 1)[0];
            room.trick.push({ player: currentPlayer, card });
            
            if (card.suit === 'hearts') {
                room.heartsBroken = true;
            }
            
            if (room.trick.length === 1) {
                room.leadSuit = card.suit;
            }
            
            broadcastToRoom(room.id, {
                type: 'cardPlayed',
                playerId: currentPlayer.id,
                card: card,
                trick: room.trick.map(t => ({ playerId: t.player.id, card: t.card }))
            });
            
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
            
            if (room.trick.length === room.players.length) {
                completeTrick(room);
            } else {
                broadcastToRoom(room.id, {
                    type: 'turnChanged',
                    currentPlayer: room.players[room.currentPlayerIndex].id
                });
                processAITurns(room);
            }
        }
    }, 800);
}

function getValidCards(room, player) {
    const cards = [];
    
    player.hand.forEach(card => {
        const validation = validatePlay(room, player, card);
        if (validation.valid) {
            cards.push(card);
        }
    });
    
    // If no valid cards (shouldn't happen), return all
    if (cards.length === 0) {
        return [...player.hand];
    }
    
    return cards;
}

/**
 * Handle Big 2 pass (skip turn)
 */
function handleBig2Pass(ws, client) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.gameType !== 'big2' || room.gameState !== GAME_STATES.PLAYING) {
        return;
    }
    
    const currentPlayer = room.players[room.currentPlayerIndex];
    
    if (currentPlayer.id !== client.id) {
        sendToClient(ws, { type: 'error', message: 'Not your turn' });
        return;
    }
    
    // Can't pass if you're the last player to play (you have initiative)
    if (room.lastPlayerToPlay && room.lastPlayerToPlay.id === client.id) {
        sendToClient(ws, { type: 'error', message: 'You have initiative, you must play' });
        return;
    }
    
    // Can't pass if there's no current play (first play of round)
    if (room.currentPlay.length === 0 && room.lastPlayerToPlay === null) {
        sendToClient(ws, { type: 'error', message: 'Must play on first turn' });
        return;
    }
    
    // Broadcast pass
    broadcastToRoom(room.id, {
        type: 'playerPassed',
        playerId: client.id
    });
    
    // Next player
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    
    // Check if back to last player to play (everyone passed)
    if (room.players[room.currentPlayerIndex].id === room.lastPlayerToPlay?.id) {
        // Everyone passed, last player gets initiative
        broadcastToRoom(room.id, {
            type: 'initiativeGained',
            playerId: room.lastPlayerToPlay.id,
            message: 'Everyone passed! Play anything.'
        });
        room.currentPlay = [];
        
        broadcastToRoom(room.id, {
            type: 'turnChanged',
            currentPlayer: room.lastPlayerToPlay.id,
            currentPlay: [],
            canFollow: false
        });
        
        // If AI has initiative
        if (room.lastPlayerToPlay.isAI) {
            setTimeout(() => processBig2AITurns(room), 1000);
        }
        return;
    }
    
    broadcastToRoom(room.id, {
        type: 'turnChanged',
        currentPlayer: room.players[room.currentPlayerIndex].id,
        currentPlay: room.currentPlay,
        canFollow: true
    });
    
    processBig2AITurns(room);
}

/**
 * Process AI turns for Big 2
 */
function processBig2AITurns(room) {
    const currentPlayer = room.players[room.currentPlayerIndex];
    
    if (!currentPlayer || !currentPlayer.isAI) return;
    
    setTimeout(() => {
        if (room.gameState !== GAME_STATES.PLAYING) return;
        
        // AI decision: try to play a valid card/play
        const validPlays = getValidBig2Plays(room, currentPlayer);
        
        if (validPlays.length === 0) {
            // Must pass
            handleBig2Pass(null, { id: currentPlayer.id, roomId: room.id });
            return;
        }
        
        // AI strategy: play smallest valid play
        const play = validPlays[0];
        
        // Simulate play
        play.forEach(card => {
            const idx = currentPlayer.hand.findIndex(
                c => c.suit === card.suit && c.rank === card.rank
            );
            if (idx !== -1) currentPlayer.hand.splice(idx, 1);
        });
        
        room.currentPlay = play;
        room.lastPlayerToPlay = currentPlayer;
        
        const playType = isValidBig2Play(play);
        
        broadcastToRoom(room.id, {
            type: 'cardsPlayed',
            playerId: currentPlayer.id,
            cards: play,
            playType: playType.type,
            handSize: currentPlayer.hand.length
        });
        
        // Check win
        if (currentPlayer.hand.length === 0) {
            completeBig2Game(room, currentPlayer);
            return;
        }
        
        room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
        
        broadcastToRoom(room.id, {
            type: 'turnChanged',
            currentPlayer: room.players[room.currentPlayerIndex].id,
            currentPlay: room.currentPlay
        });
        
        processBig2AITurns(room);
    }, 800);
}

/**
 * Get valid Big 2 plays for AI
 */
function getValidBig2Plays(room, player) {
    const plays = [];
    
    // Try singles
    for (const card of player.hand) {
        if (canBeatBig2Play([card], room.currentPlay)) {
            plays.push([card]);
        }
    }
    
    // Try pairs
    const rankGroups = {};
    player.hand.forEach(c => {
        rankGroups[c.rank] = rankGroups[c.rank] || [];
        rankGroups[c.rank].push(c);
    });
    
    for (const rank in rankGroups) {
        if (rankGroups[rank].length >= 2) {
            const pair = rankGroups[rank].slice(0, 2);
            if (canBeatBig2Play(pair, room.currentPlay)) {
                plays.push(pair);
            }
        }
    }
    
    // Try 5-card hands (simplified: just try combinations)
    // For AI, we'll keep it simple and just return singles/pairs if valid
    // A full implementation would check all 5-card combinations
    
    return plays;
}

/**
 * Complete Big 2 game when someone wins
 */
function completeBig2Game(room, winner) {
    room.gameState = GAME_STATES.GAME_END;
    
    // Calculate rankings
    const rankings = room.players
        .map(p => ({ id: p.id, name: p.name, cardsLeft: p.hand.length }))
        .sort((a, b) => a.cardsLeft - b.cardsLeft);
    
    broadcastToRoom(room.id, {
        type: 'gameComplete',
        gameType: 'big2',
        winner: { id: winner.id, name: winner.name },
        rankings: rankings
    });
    
    console.log(`Big 2 game completed in room ${room.id}. Winner: ${winner.name}`);
}

/**
 * Handle New Game request - restart game with persistent scores
 */
function handleNewGame(ws, client) {
    const room = rooms.get(client.roomId);
    if (!room) return;
    
    // Mark this player as ready for new game
    const player = room.players.find(p => p.id === client.id);
    if (player) {
        player.readyForNewGame = true;
    }
    
    // Check if all human players are ready
    const humanPlayers = room.players.filter(p => !p.isAI);
    const allHumansReady = humanPlayers.every(p => p.readyForNewGame);
    
    if (allHumansReady) {
        // Reset ready flags
        room.players.forEach(p => p.readyForNewGame = false);
        
        // Reinitialize game (scores are preserved on player objects)
        initializeGame(room);
    } else {
        // Notify others how many are ready
        const readyCount = humanPlayers.filter(p => p.readyForNewGame).length;
        broadcastToRoom(room.id, {
            type: 'newGameRequested',
            readyCount: readyCount,
            totalHumans: humanPlayers.length
        });
    }
}

function leaveRoom(ws, client) {
    if (client.roomId) {
        handleDisconnect(ws);
    }
}

// ===== Snake Game Functions =====

/**
 * Initialize a Snake game room
 */
function initializeSnakeGame(room) {
    room.gameState = GAME_STATES.PLAYING;
    room.food = [];
    
    // Use world size (new) or fallback to board size (old)
    const worldW = room.worldWidth || room.boardWidth || 1000;
    const worldH = room.worldHeight || room.boardHeight || 1000;
    const margin = 5;
    
    room.players.forEach((player) => {
        // Respawn each player at random position (at least 5 from edges)
        const spawn = randomSpawnPosition(worldW, worldH, margin);
        const dir = ['up','down','left','right'][Math.floor(Math.random()*4)];
        player.snake = createInitialSnakeSegments(spawn.x, spawn.y, dir);
        player.direction = dir;
        player.nextDirection = dir;
        player.score = 0;
        player.alive = true;
        // Reset AI speed if AI
        if (player.isAI) player.aiSpeedMultiplier = 1.5;
        player.lastInputTime = Date.now(); // Reset inactivity timer
    });
    
    // Spawn initial food (more for bigger world) - 10x more apples
    const foodCount = Math.floor((worldW * worldH) / 1000); // ~1000 for 1000x1000
    for (let i = 0; i < foodCount; i++) spawnFood(room);
    
    // Broadcast game start with world size
    broadcastToRoom(room.id, {
        type: 'snakeGameStarted',
        worldWidth: worldW,
        worldHeight: worldH,
        viewportWidth: room.viewportWidth || 40,
        viewportHeight: room.viewportHeight || 30,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            snake: p.snake,
            score: p.score,
            alive: p.alive,
            isAI: p.isAI
        })),
        food: room.food
    });
    
    // Reset tick speed
    room.currentTickMs = room.initialTickRate || 1000;
    
    if (room.gameLoopTimeout) clearTimeout(room.gameLoopTimeout);
    scheduleNextSnakeTick(room);
    
    // Periodic apple spawning (every 2 seconds, spawn 5 apples)
    if (room.foodSpawner) clearInterval(room.foodSpawner);
    room.foodSpawner = setInterval(() => {
        if (room.gameState !== GAME_STATES.PLAYING) {
            clearInterval(room.foodSpawner);
            room.foodSpawner = null;
            return;
        }
        // Spawn 5 apples periodically
        for (let i = 0; i < 5; i++) spawnFood(room);
    }, 2000);
    
    // Live leaderboard: broadcast top 10 every second
    if (room.leaderboardInterval) clearInterval(room.leaderboardInterval);
    room.leaderboardInterval = setInterval(() => {
        if (room.gameState !== GAME_STATES.PLAYING) {
            clearInterval(room.leaderboardInterval);
            room.leaderboardInterval = null;
            return;
        }
        // Compute top 10 by snake length
        const leaderboard = [...room.players]
            .filter(p => p.alive)
            .sort((a, b) => (b.snake?.length || 0) - (a.snake?.length || 0))
            .slice(0, 10)
            .map(p => ({ id: p.id, name: p.name, length: p.snake?.length || 0, score: p.score, isAI: p.isAI }));
        
        broadcastToRoom(room.id, {
            type: 'snakeLeaderboard',
            leaderboard: leaderboard
        });
    }, 1000);
    
    console.log(`Snake game started in room ${room.id} with ${room.players.length} players`);
}

/**
 * Schedule the next snake game tick with current (possibly slowing) delay.
 * Speed increases gradually from initialTickRate to targetTickRate.
 */
function scheduleNextSnakeTick(room) {
    if (room.gameState !== GAME_STATES.PLAYING) {
        if (room.gameLoopTimeout) {
            clearTimeout(room.gameLoopTimeout);
            room.gameLoopTimeout = null;
        }
        return;
    }
    
    room.gameLoopTimeout = setTimeout(() => {
        snakeGameLoop(room);
        
        // Speed up: decrease tick time by 2ms each tick until we hit target
        if (room.currentTickMs > room.targetTickRate) {
            room.currentTickMs = Math.max(room.targetTickRate, room.currentTickMs - 2);
        }
        
        // Schedule next tick
        scheduleNextSnakeTick(room);
    }, room.currentTickMs);
}

/**
 * Generate non-overlapping start positions for snakes
 */
function generateSnakeStartPositions(count, boardWidth, boardHeight) {
    const positions = [];
    const margin = 5;
    const spacing = Math.floor((boardWidth - margin * 2) / Math.max(1, count));
    
    for (let i = 0; i < count; i++) {
        positions.push({
            x: margin + i * spacing + 3,
            y: Math.floor(boardHeight / 2)
        });
    }
    return positions;
}

/**
 * Spawn a food item at a random empty location
 */
function spawnFood(room) {
    // Collect all occupied cells
    const occupied = new Set();
    
    room.players.forEach(player => {
        if (player.alive) {
            player.snake.forEach(seg => {
                occupied.add(`${seg.x},${seg.y}`);
            });
        }
    });
    
    room.food.forEach(f => {
        occupied.add(`${f.x},${f.y}`);
    });
    
    // Determine world size
    const worldW = room.worldWidth || room.boardWidth || 1000;
    const worldH = room.worldHeight || room.boardHeight || 1000;
    
    // Various apple colors
    const appleColors = ['#ffeb3b', '#ff5722', '#e91e63', '#9c27b0', '#2196f3', '#4caf50', '#ff9800', '#00bcd4'];
    const color = appleColors[Math.floor(Math.random() * appleColors.length)];
    
    // Find empty cells (sample random points instead of scanning all 1M cells)
    let placed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
        const x = Math.floor(Math.random() * worldW);
        const y = Math.floor(Math.random() * worldH);
        if (!occupied.has(`${x},${y}`)) {
            room.food.push({ x, y, color });
            placed = true;
            break;
        }
    }
    // Fallback: if couldn't find in 100 tries (very full), just place somewhere
    if (!placed) {
        const x = Math.floor(Math.random() * worldW);
        const y = Math.floor(Math.random() * worldH);
        room.food.push({ x, y, color });
    }
}

/**
 * Main Snake game loop - runs every tick (handles per-player timing for speed by length)
 */
function snakeGameLoop(room) {
    if (room.gameState !== GAME_STATES.PLAYING) {
        if (room.gameLoopTimeout) {
            clearTimeout(room.gameLoopTimeout);
            room.gameLoopTimeout = null;
        }
        return;
    }
    
    const now = Date.now();
    const worldW = room.worldWidth || room.boardWidth || 1000;
    const worldH = room.worldHeight || room.boardHeight || 1000;
    let anyAlive = false;
    
    room.players.forEach(player => {
        if (!player.alive) return;
        
        // Inactivity kick: if human has no input for 30s, destroy and remove
        if (!player.isAI) {
            const inactiveTime = now - (player.lastInputTime || now);
            if (inactiveTime > 30000) {
                console.log(`Player ${player.name} kicked for inactivity (30s)`);
                player.alive = false;
                if (player.ws) {
                    sendToClient(player.ws, { type: 'snakeYouDied', roomId: room.id, reason: 'Inactivity' });
                }
                setTimeout(() => {
                    room.players = room.players.filter(p => p.id !== player.id);
                }, 500);
                return;
            }
        }
        
        anyAlive = true;
        
        // Per-player timing for speed based on length
        const snakeLen = player.snake.length;
        // Speed formula: BASE_SPEED * (1 + length / 10), capped at 4 * BASE_SPEED
        // Larger interval = slower. Short snakes are fast, long snakes are slow.
        const baseSpeed = room.currentTickMs || 500;
        const playerTick = Math.floor(Math.min(4 * baseSpeed, baseSpeed * (1 + snakeLen / 10)));
        
        if (!player.nextMoveTime) player.nextMoveTime = now;
        if (now < player.nextMoveTime) return; // Not time to move this player yet
        player.nextMoveTime = now + playerTick;
        
        // AI behavior
        if (player.isAI) {
            runAISnakeLogic(player, room, worldW, worldH);
        }
        
        // Apply direction change
        const current = player.direction;
        const next = player.nextDirection;
        if (!((current === 'left' && next === 'right') ||
              (current === 'right' && next === 'left') ||
              (current === 'up' && next === 'down') ||
              (current === 'down' && next === 'up'))) {
            player.direction = next;
        }
        
        // Move head
        const head = player.snake[0];
        let newHead = { x: head.x, y: head.y };
        switch (player.direction) {
            case 'up': newHead.y--; break;
            case 'down': newHead.y++; break;
            case 'left': newHead.x--; break;
            case 'right': newHead.x++; break;
        }
        
        // Wall collision (world bounds)
        if (newHead.x < 0 || newHead.x >= worldW || newHead.y < 0 || newHead.y >= worldH) {
            handleSnakeDeath(room, player);
            return;
        }
        
        // Self collision
        for (let i = 0; i < player.snake.length; i++) {
            if (player.snake[i].x === newHead.x && player.snake[i].y === newHead.y) {
                handleSnakeDeath(room, player);
                return;
            }
        }
        
        // Other player collision
        for (const other of room.players) {
            if (other.id === player.id || !other.alive) continue;
            for (const seg of other.snake) {
                if (seg.x === newHead.x && seg.y === newHead.y) {
                    handleSnakeDeath(room, player);
                    return;
                }
            }
        }
        
        // Move
        player.snake.unshift(newHead);
        
        // Eat food
        let ate = false;
        for (let i = 0; i < room.food.length; i++) {
            if (room.food[i].x === newHead.x && room.food[i].y === newHead.y) {
                room.food.splice(i, 1);
                player.score += 10;
                ate = true;
                spawnFood(room);
                break;
            }
        }
        if (!ate) player.snake.pop();
    });
    
    // Check game over (only for non-AI players: if all humans dead, end? Or keep going)
    // Per requirement: human death → lobby. Game continues with AI.
    // So we don't end game when humans die; only if ALL players (including AI) die.
    const alive = room.players.filter(p => p.alive);
    if (alive.length === 0) {
        endSnakeGame(room);
        return;
    }
    
    // Broadcast state (clients handle viewport)
    broadcastToRoom(room.id, {
        type: 'snakeState',
        worldWidth: worldW,
        worldHeight: worldH,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            snake: p.snake,
            score: p.score,
            alive: p.alive,
            direction: p.direction,
            isAI: p.isAI
        })),
        food: room.food
    });
}

function handleSnakeDeath(room, player) {
    player.alive = false;
    
    if (player.isAI) {
        // Respawn AI at low speed after short delay
        setTimeout(() => {
            if (room.gameState !== GAME_STATES.PLAYING) return;
            const spawn = randomSpawnPosition(room.worldWidth || 1000, room.worldHeight || 1000, 5);
            const dir = ['up','down','left','right'][Math.floor(Math.random()*4)];
            player.snake = createInitialSnakeSegments(spawn.x, spawn.y, dir);
            player.direction = dir;
            player.nextDirection = dir;
            player.score = 0;
            player.alive = true;
            player.nextMoveTime = Date.now() + 1000; // Slow start after respawn (2x base speed)
            player.aiSpeedMultiplier = 1.5;
            player.lastInputTime = Date.now();
        }, 1000);
    } else {
        // Human death: send them to lobby, remove from room
        if (player.ws) {
            sendToClient(player.ws, { type: 'snakeYouDied', roomId: room.id });
        }
        // Remove from room after a moment, and clear their roomId so they can start a new game
        setTimeout(() => {
            room.players = room.players.filter(p => p.id !== player.id);
            // Clear roomId on the client object so they can join a new game
            const clientObj = clients.get(player.ws);
            if (clientObj) clientObj.roomId = null;
            console.log(`Human ${player.name} died and removed from Snake game ${room.id}`);
        }, 500);
    }
}

function runAISnakeLogic(player, room, worldW, worldH) {
    // Simple AI: occasionally pick a direction toward nearest food or random
    const head = player.snake[0];
    
    // Find nearest food
    let target = null;
    let bestDist = Infinity;
    for (const f of room.food) {
        const d = Math.abs(f.x - head.x) + Math.abs(f.y - head.y);
        if (d < bestDist) { bestDist = d; target = f; }
    }
    
    // Pick direction
    let preferred = null;
    if (target) {
        const dx = target.x - head.x;
        const dy = target.y - head.y;
        if (Math.abs(dx) > Math.abs(dy)) {
            preferred = dx > 0 ? 'right' : 'left';
        } else {
            preferred = dy > 0 ? 'down' : 'up';
        }
    }
    
    // Avoid immediate wall/collision
    const safeDirs = [];
    const dirs = ['up','down','left','right'];
    for (const d of dirs) {
        let nx = head.x, ny = head.y;
        if (d === 'up') ny--; else if (d === 'down') ny++; else if (d === 'left') nx--; else nx++;
        if (nx < 0 || nx >= worldW || ny < 0 || ny >= worldH) continue;
        // Check self
        let selfHit = false;
        for (let i = 0; i < player.snake.length; i++) {
            if (player.snake[i].x === nx && player.snake[i].y === ny) { selfHit = true; break; }
        }
        if (selfHit) continue;
        // Check others
        let otherHit = false;
        for (const o of room.players) {
            if (o.id === player.id || !o.alive) continue;
            for (const s of o.snake) { if (s.x === nx && s.y === ny) { otherHit = true; break; } }
            if (otherHit) break;
        }
        if (!otherHit) safeDirs.push(d);
    }
    
    if (safeDirs.length === 0) return; // stuck, let it die
    
    // Prefer safe + toward food, else random safe
    let chosen = null;
    if (preferred && safeDirs.includes(preferred)) {
        chosen = preferred;
    } else {
        chosen = safeDirs[Math.floor(Math.random() * safeDirs.length)];
    }
    player.nextDirection = chosen;
}

/**
 * Handle snake input (direction change) from a client
 */
function handleSnakeInput(ws, client, direction) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.gameType !== 'snake' || room.gameState !== GAME_STATES.PLAYING) {
        return;
    }
    
    const player = room.players.find(p => p.id === client.id);
    if (!player || !player.alive) return;
    
    // Validate direction
    const validDirections = ['up', 'down', 'left', 'right'];
    if (!validDirections.includes(direction)) return;
    
    // Prevent 180-degree turns
    const current = player.direction;
    if ((current === 'left' && direction === 'right') ||
        (current === 'right' && direction === 'left') ||
        (current === 'up' && direction === 'down') ||
        (current === 'down' && direction === 'up')) {
        return;
    }
    
    player.nextDirection = direction;
    player.lastInputTime = Date.now(); // Track last input for inactivity kick
}

/**
 * End a Snake game
 */
function endSnakeGame(room) {
    room.gameState = GAME_STATES.GAME_END;
    
    if (room.gameLoopTimeout) {
        clearTimeout(room.gameLoopTimeout);
        room.gameLoopTimeout = null;
    }
    
    if (room.foodSpawner) {
        clearInterval(room.foodSpawner);
        room.foodSpawner = null;
    }
    
    if (room.leaderboardInterval) {
        clearInterval(room.leaderboardInterval);
        room.leaderboardInterval = null;
    }
    
    // Reset restart votes for all players
    room.players.forEach(p => {
        p.readyForRestart = false;
    });
    
    // Determine winner (highest score, or last alive)
    const winner = room.players.reduce((best, p) => {
        if (!best) return p;
        if (p.score > best.score) return p;
        if (p.score === best.score && p.alive && !best.alive) return p;
        return best;
    }, null);
    
    // Compute leaderboard: top 10 by snake length (segments count)
    const leaderboard = [...room.players]
        .sort((a, b) => (b.snake?.length || 0) - (a.snake?.length || 0))
        .slice(0, 10)
        .map(p => ({ id: p.id, name: p.name, length: p.snake?.length || 0, score: p.score, isAI: p.isAI }));
    
    broadcastToRoom(room.id, {
        type: 'snakeGameOver',
        winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            score: p.score,
            alive: p.alive,
            length: p.snake?.length || 0,
            isAI: p.isAI
        })),
        leaderboard: leaderboard // Top 10 longest snakes
    });
    
    console.log(`Snake game ended in room ${room.id}. Winner: ${winner?.name || 'none'}`);
}

/**
 * Handle snake restart vote from a player
 */
function handleSnakeRestart(ws, client) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.gameType !== 'snake' || room.gameState !== GAME_STATES.GAME_END) {
        return;
    }
    
    const player = room.players.find(p => p.id === client.id);
    if (!player) return;
    
    player.readyForRestart = true;
    
    // Count how many human players are ready
    const humanPlayers = room.players.filter(p => !p.isAI);
    const readyCount = humanPlayers.filter(p => p.readyForRestart).length;
    
    // Broadcast progress
    broadcastToRoom(room.id, {
        type: 'snakeRestartProgress',
        readyCount: readyCount,
        totalHumans: humanPlayers.length
    });
    
    // If all humans are ready, restart the game
    if (readyCount === humanPlayers.length && humanPlayers.length > 0) {
        // Reset ready flags
        room.players.forEach(p => p.readyForRestart = false);
        
        // Reinitialize the snake game
        initializeSnakeGame(room);
    }
}

/**
 * Broadcast current game counts to all connected clients
 */
function broadcastGameCounts() {
    const counts = { hearts: 0, big2: 0, snake: 0 };
    for (const room of rooms.values()) {
        if (room.gameType && counts.hasOwnProperty(room.gameType)) {
            counts[room.gameType]++;
        }
    }
    // Broadcast to all connected clients
    for (const [ws, client] of clients.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'gameCounts', counts }));
        }
    }
}

// Broadcast game counts every 5 seconds
setInterval(broadcastGameCounts, 5000);

// Start server
server.listen(PORT, () => {
    console.log(`Card Game Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
