# Turn-Based Card Game (Hearts)

A multiplayer turn-based card game similar to Hearts, built with Node.js server and Phaser.js frontend.

## Features

- 🎴 **Hearts-style card game** with standard 52-card deck
- 👥 **Multiplayer support** via WebSocket
- 🤖 **AI opponents** - play with 1-3 AI players
- 🎮 **Interactive Phaser frontend** - click to play cards
- 📊 **Scoring system** - avoid hearts (1 pt each) and Queen of Spades (13 pts)
- 🌙 **Shooting the Moon** - take all hearts + Q♠ to give opponents 26 points
- 🔄 **Turn-based gameplay** with proper Hearts rules

## How to Run

### 1. Install dependencies

```bash
cd card-game/server
npm install
```

### 2. Start the server

```bash
npm start
```

The server runs on port 8080 by default.

### 3. Open in browser

Navigate to `http://localhost:8080`

## How to Play

### Game Rules (Hearts)

1. **Dealing**: Each player gets 13 cards
2. **First Trick**: Must play the 2 of Clubs to start
3. **Following Suit**: You must follow the lead suit if possible
4. **Hearts**: Cannot lead hearts until "broken" (someone plays one first)
5. **Scoring**: 
   - Each heart = 1 point
   - Queen of Spades = 13 points
   - Lowest score wins!
6. **Shooting the Moon**: Take ALL hearts and the Q♠ to give opponents 26 points each

### Controls

- **Create Room**: Start a new game room
- **Join Room**: Enter a room code to join
- **Start Game**: Host can start (fills empty slots with AI)
- **Play Card**: Click on a card in your hand when it's your turn

### Game Interface

- **Green felt table** with card positions
- **Your hand** at the bottom (interactive)
- **Other players** around the table (AI shown with 🤖)
- **Trick pile** in the center
- **Score panel** showing all players' scores
- **Turn indicator** shows whose turn it is

## Architecture

```
card-game/
├── server/
│   ├── package.json
│   └── server.js       # Node.js WebSocket server + game logic
└── client/
    ├── index.html      # Game HTML + UI
    └── game.js         # Phaser game client
```

### Server Features

- WebSocket server on port 8080
- HTTP server serves static client files
- Room management (create/join)
- Game state management
- Hearts rule validation
- AI player logic
- Score tracking

### Client Features

- Phaser 3 game engine
- Programmatic card rendering (no image assets)
- Real-time WebSocket communication
- Responsive design
- Smooth card animations

## Game Rules Implemented

- ✅ Must play 2♣ on first trick
- ✅ Must follow suit if possible
- ✅ Can't lead hearts until broken
- ✅ Can't play hearts on first trick (if have other cards)
- ✅ Queen of Spades = 13 points
- ✅ Each heart = 1 point
- ✅ Shooting the moon
- ✅ First to 100 points loses

## Troubleshooting

**Server won't start:**
```bash
cd card-game/server
npm install
node server.js
```

**Can't connect from browser:**
- Make sure server is running on port 8080
- Check browser console for errors
- Try `http://127.0.0.1:8080`

**Cards not displaying:**
- Open browser DevTools → Console for errors
- Ensure Phaser CDN loaded (requires internet)

## Future Enhancements

- Card passing between players
- Full trick animation showing all 4 cards
- Sound effects
- Better AI strategy
- Mobile touch support
- Spectator mode
- Chat feature
