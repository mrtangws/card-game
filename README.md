# Multiplayer Game Server

A multiplayer game server supporting turn-based card games (Hearts, Big 2) and real-time arcade games (Snake), built with Node.js server and Phaser.js frontend.

## Features

### Card Games
- 🎴 **Hearts** - Classic trick-taking card game
- 🃏 **Big 2** - Popular Asian card game with poker hands
- 🤖 **AI opponents** - play with AI players
- 🎮 **Interactive Phaser frontend** - click to play cards

### Arcade Games
- 🐍 **Snake** - Real-time multiplayer Snake (up to 10 players!)
- ⚡ **Real-time gameplay** - 10 ticks per second
- 🎯 **Competitive** - Last snake alive wins
- 🍎 **Food collection** - Grow and score points

### General
- 👥 **Multiplayer support** via WebSocket
- 🏠 **Room system** - Create/join game rooms
- 📊 **Score tracking** - Leaderboards and rankings

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

### Game Rules

#### Hearts

1. **Dealing**: Each player gets 13 cards
2. **First Trick**: Must play the 2 of Clubs to start
3. **Following Suit**: You must follow the lead suit if possible
4. **Hearts**: Cannot lead hearts until "broken" (someone plays one first)
5. **Scoring**: 
   - Each heart = 1 point
   - Queen of Spades = 13 points
   - Lowest score wins!
6. **Shooting the Moon**: Take ALL hearts and the Q♠ to give opponents 26 points each

#### Big 2

1. **Dealing**: Each player gets 13 cards
2. **First Play**: Must include the 3 of Diamonds
3. **Valid Plays**: Single, pair, or 5-card poker hands
4. **No Triples**: Three of a kind not allowed
5. **Hierarchy**: Higher card combinations beat lower ones
6. **Winning**: First to empty hand wins!

#### Snake (Multiplayer)

1. **World Size**: 200x200 world
2. **Viewport**: Each player sees a 40x30 viewport centered on their snake
3. **Spawning**: Snakes spawn randomly, at least 5 units from world edges
4. **Starting Length**: All snakes start with length 3 (head + 2 segments)
5. **Movement**: Use Arrow Keys or WASD to control your snake
6. **Speed**: Snakes get faster as they grow (capped at maximum speed)
7. **Food**: 200+ colorful apples to eat - grow longer with each one!
8. **Score**: Your score equals your snake's length
9. **Apple Spawning**: New apples spawn periodically every 0.5 seconds
10. **Collisions**: Avoid walls, other snakes, and yourself
11. **AI Opponents**: 10 AI snakes hunt food and avoid obstacles
12. **Live Leaderboard**: Top 10 longest snakes updated every second
13. **Death**: Human players return to lobby when they die
14. **Supports**: Up to 10 human players per game!

### Controls

- **Create Room**: Start a new game room (Hearts/Big 2)
- **Join Room**: Enter a room code to join (Hearts/Big 2)
- **Start Game**: Host can start (fills empty slots with AI for card games)
- **Play Card**: Click on a card in your hand when it's your turn (card games)
- **Snake Start**: Auto-joins existing game or creates new one with 10 AI snakes
- **Snake Movement**: Arrow Keys or WASD

### Snake Game Lobby

When you select Snake and click "Start Game":
- If there's an existing game with < 10 players, you'll join it
- Otherwise, a new game starts with 10 AI snakes
- The lobby shows real-time counts of active games for each type

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
- Room management (create/join) with configurable max players
- Game state management for multiple game types
- Real-time lobby with active game counts
- **Hearts**: Turn-based trick-taking with AI opponents
- **Big 2**: Multi-card play with poker hand validation
- **Snake**: 
  - 200x200 world with per-player viewport
  - All snakes start with length 3 (head + 2 segments)
  - Real-time 10Hz game loop supporting up to 10 human players
  - Auto-join or create game with 10 AI snakes
  - AI pathfinding (food seeking, obstacle avoidance)
  - Variable speed based on snake length
  - Collision detection and food spawning
- Score tracking and leaderboards

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

### Card Games
- Card passing between players
- Full trick animation showing all 4 cards
- Better AI strategy

### Snake
- Power-ups (speed boost, invincibility)
- Obstacles and maze modes
- Teams mode
- Spectator mode after dying

### General
- Sound effects
- Mobile touch support
- Chat feature
- User accounts and persistent stats
