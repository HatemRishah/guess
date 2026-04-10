# 🎨 Sketchly — Draw & Guess

A real-time multiplayer drawing and guessing game (Skribbl.io-style).

## Setup & Run

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
```

Or for development with auto-restart:
```bash
npm run dev
```

### 3. Open your browser
Go to: **http://localhost:3000**

## How to Play

1. Enter your nickname
2. **Create a room** → share the room code with friends
3. Friends enter the code and click **Join**
4. The **host** (room creator) clicks **Start Game** (min 2 players)
5. Each round, the drawer picks a word from 3 options and draws it
6. Other players type guesses in the chat
7. Correct guess = **+10 pts** for guesser, **+5 pts** for drawer
8. Timer runs 60 seconds per round
9. Players rotate as drawer each round

## Features
- ✅ Real-time drawing sync via Socket.io
- ✅ Word selection from 80+ word bank
- ✅ 60-second timer per round
- ✅ Live scoreboard
- ✅ Color picker + custom colors
- ✅ Brush size control
- ✅ Undo & Clear canvas
- ✅ Eraser tool
- ✅ Chat with guess detection
- ✅ Room codes for private games
- ✅ Up to 8 players per room
- ✅ Dark, modern UI
