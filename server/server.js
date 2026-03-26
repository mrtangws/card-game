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
            createRoom(ws, client);
            break;
            
        case 'joinRoom':
            joinRoom(ws, client, data.roomId);
            break;
            
        case 'startGame':
            startGame(ws, client);
            break;
            
        case 'playCard':
            playCard(ws, client, data.card);
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

function createRoom(ws, client) {
    const roomId = generateId().slice(0, 6).toUpperCase();
    
    const room = {
        id: roomId,
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
        heartsBroken: false
    };
    
    rooms.set(roomId, room);
    client.roomId = roomId;
    
    sendToClient(ws, {
        type: 'roomCreated',
        roomId: roomId,
        players: room.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI }))
    });
    
    console.log(`Room ${roomId} created by ${client.name}`);
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

function playCard(ws, client, cardData) {
    const room = rooms.get(client.roomId);
    
    if (!room || room.gameState !== GAME_STATES.PLAYING) {
        return;
    }
    
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
