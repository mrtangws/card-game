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
            
        case 'leaveRoom':
            leaveRoom(ws, client);
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
                rooms.delete(client.roomId);
            } else {
                broadcastToRoom(client.roomId, {
                    type: 'playerLeft',
                    playerId: client.id,
                    playerName: client.name
                });
                
                // If game was in progress, end it
                if (room.gameState !== GAME_STATES.WAITING) {
                    broadcastToRoom(client.roomId, {
                        type: 'gameEnded',
                        reason: 'Player disconnected'
                    });
                    room.gameState = GAME_STATES.WAITING;
                }
            }
        }
    }
    
    clients.delete(ws);
}

function createRoom(ws, client, gameType = 'hearts') {
    const roomId = generateId().slice(0, 6).toUpperCase();
    
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

function joinRoom(ws, client, roomId) {
    const room = rooms.get(roomId);
    
    if (!room) {
        sendToClient(ws, { type: 'error', message: 'Room not found' });
        return;
    }
    
    if (room.players.length >= 4) {
        sendToClient(ws, { type: 'error', message: 'Room is full' });
        return;
    }
    
    if (room.gameState !== GAME_STATES.WAITING) {
        sendToClient(ws, { type: 'error', message: 'Game already in progress' });
        return;
    }
    
    room.players.push({
        id: client.id,
        name: client.name,
        ws: ws,
        hand: [],
        score: 0,
        tricksWon: 0,
        isAI: false
    });
    
    client.roomId = roomId;
    
    // Broadcast to all in room
    broadcastToRoom(roomId, {
        type: 'playerJoined',
        player: { id: client.id, name: client.name },
        players: room.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI }))
    });
    
    sendToClient(ws, {
        type: 'roomJoined',
        roomId: roomId,
        players: room.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI }))
    });
    
    console.log(`${client.name} joined room ${roomId}`);
}

function startGame(ws, client) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.players[0].id !== client.id) {
        sendToClient(ws, { type: 'error', message: 'Only host can start the game' });
        return;
    }
    
    if (room.players.length < 2) {
        sendToClient(ws, { type: 'error', message: 'Need at least 2 players' });
        return;
    }
    
    // Fill with AI if needed
    while (room.players.length < 4) {
        const aiIndex = room.players.filter(p => p.isAI).length;
        room.players.push({
            id: `ai_${generateId()}`,
            name: `AI ${aiIndex + 1}`,
            ws: null,
            hand: [],
            score: 0,
            tricksWon: 0,
            isAI: true
        });
    }
    
    initializeGame(room);
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
 */
function canBeatBig2Play(playA, playB) {
    if (!playB || playB.length === 0) return true; // First play, anything valid works
    if (playA.length !== playB.length) return false; // Must match count
    
    const typeA = isValidBig2Play(playA);
    const typeB = isValidBig2Play(playB);
    
    if (!typeA.valid || !typeB.valid) return false;
    if (typeA.type !== typeB.type) return false; // Must be same type
    
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

function leaveRoom(ws, client) {
    if (client.roomId) {
        handleDisconnect(ws);
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`Card Game Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
