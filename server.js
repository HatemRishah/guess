const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

// ─── Word Bank ────────────────────────────────────────────────────────────────
const wordBank = [
  "cat","dog","house","car","tree","sun","moon","star","flower","bird",
  "rainbow","mountain","river","cloud","apple","banana","fish","butterfly",
  "spider","ghost","robot","crown","castle","dragon","unicorn","pizza","burger",
  "ice cream","cake","balloon","gift","clock","book","hat","glasses","shoe",
  "telephone","television","airplane","train","bicycle","beach","forest","desert",
  "snowman","pumpkin","heart","starfish","octopus","candle","umbrella","camera",
  "guitar","piano","diamond","rocket","lighthouse","anchor","compass","volcano",
  "tornado","igloo","cactus","parrot","penguin","flamingo","elephant","giraffe",
  "kangaroo","shark","dolphin","turtle","hedgehog","mushroom","trophy","sword",
  "shield","wizard","fairy","mermaid","spaceship","planet","comet","sandcastle"
];

// ─── Rooms Store ──────────────────────────────────────────────────────────────
// rooms[roomCode] = {
//   players: [{ id, nickname, score }],
//   hostId, started, drawerIndex,
//   currentWord, roundNumber, totalRounds,
//   timer, drawHistory, phase ('lobby'|'choosing'|'drawing'|'roundEnd')
// }
const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getThreeWords() {
  const shuffled = [...wordBank].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function getRoomSafe(roomCode) {
  return rooms[roomCode];
}

function broadcastPlayers(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("playersUpdate", {
    players: room.players.map(p => ({ id: p.id, nickname: p.nickname, score: p.score })),
    hostId: room.hostId,
    drawerIndex: room.drawerIndex,
  });
}

function startTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  clearInterval(room.timer);
  let timeLeft = 60;

  io.to(roomCode).emit("timerUpdate", { timeLeft });

  room.timer = setInterval(() => {
    timeLeft--;
    io.to(roomCode).emit("timerUpdate", { timeLeft });
    if (timeLeft <= 0) {
      clearInterval(room.timer);
      endRound(roomCode);
    }
  }, 1000);
}

function endRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.phase = "roundEnd";

  io.to(roomCode).emit("roundEnd", {
    word: room.currentWord,
    players: room.players.map(p => ({ id: p.id, nickname: p.nickname, score: p.score })),
  });

  // Wait 4 seconds then advance
  setTimeout(() => {
    advanceTurn(roomCode);
  }, 4000);
}

function advanceTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  room.roundNumber++;
  room.currentWord = null;
  room.guessedPlayers = [];
  room.drawHistory = [];
  room.phase = "choosing";

  // Notify everyone canvas clears
  io.to(roomCode).emit("clearCanvas");

  const drawer = room.players[room.drawerIndex];
  if (!drawer) return;

  const words = getThreeWords();
  room.pendingWords = words;

  // Send word choices only to drawer
  io.to(drawer.id).emit("chooseWord", { words, round: room.roundNumber });

  // Tell everyone else who's drawing
  io.to(roomCode).except(drawer.id).emit("drawerChoosing", {
    drawerName: drawer.nickname,
    round: room.roundNumber,
  });

  broadcastPlayers(roomCode);
}

// ─── Socket Events ────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Create Room
  socket.on("createRoom", ({ nickname }, cb) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: [{ id: socket.id, nickname, score: 0 }],
      hostId: socket.id,
      started: false,
      drawerIndex: 0,
      currentWord: null,
      pendingWords: [],
      guessedPlayers: [],
      roundNumber: 1,
      drawHistory: [],
      phase: "lobby",
      timer: null,
    };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    cb({ roomCode });
    broadcastPlayers(roomCode);
  });

  // Join Room
  socket.on("joinRoom", ({ nickname, roomCode }, cb) => {
    const room = rooms[roomCode];
    if (!room) return cb({ error: "Room not found." });
    if (room.started) return cb({ error: "Game already started." });
    if (room.players.length >= 8) return cb({ error: "Room is full." });

    room.players.push({ id: socket.id, nickname, score: 0 });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    cb({ roomCode });
    broadcastPlayers(roomCode);

    // Send draw history to new player
    if (room.drawHistory && room.drawHistory.length > 0) {
      socket.emit("drawHistory", room.drawHistory);
    }
  });

  // Start Game
  socket.on("startGame", () => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return;

    room.started = true;
    room.drawerIndex = 0;
    room.roundNumber = 1;
    room.phase = "choosing";
    room.guessedPlayers = [];

    io.to(roomCode).emit("gameStarted");

    const drawer = room.players[0];
    const words = getThreeWords();
    room.pendingWords = words;

    io.to(drawer.id).emit("chooseWord", { words, round: 1 });
    io.to(roomCode).except(drawer.id).emit("drawerChoosing", {
      drawerName: drawer.nickname,
      round: 1,
    });

    broadcastPlayers(roomCode);
  });

  // Word Chosen
  socket.on("wordChosen", ({ word }) => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room) return;

    const drawer = room.players[room.drawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    room.currentWord = word;
    room.phase = "drawing";
    room.drawHistory = [];

    // Tell drawer their word confirmed
    socket.emit("wordConfirmed", { word });

    // Tell everyone else how many letters
    const hint = word.replace(/[a-zA-Z]/g, "_");
    io.to(roomCode).except(socket.id).emit("roundStarted", {
      drawerName: drawer.nickname,
      wordHint: hint,
      wordLength: word.length,
      round: room.roundNumber,
    });

    startTimer(roomCode);
  });

  // Draw Event
  socket.on("draw", (data) => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room) return;

    const drawer = room.players[room.drawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    // Save to history (except mousemove for storage efficiency, only save path data)
    if (data.type === "clear") {
      room.drawHistory = [];
    } else if (data.type === "undo") {
      // Remove last stroke group from history
      const lastStrokeStart = room.drawHistory.map((d, i) => d.type === "start" ? i : -1).filter(i => i !== -1).pop();
      if (lastStrokeStart !== undefined) {
        room.drawHistory = room.drawHistory.slice(0, lastStrokeStart);
      }
    } else {
      room.drawHistory.push(data);
    }

    socket.to(roomCode).emit("draw", data);
  });

  // Guess
  socket.on("guess", ({ message }) => {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.phase !== "drawing") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const drawer = room.players[room.drawerIndex];
    if (drawer && drawer.id === socket.id) return; // drawer can't guess

    if (room.guessedPlayers.includes(socket.id)) {
      // Already guessed correctly, just show chat
      io.to(roomCode).emit("chatMessage", {
        type: "guess",
        nickname: player.nickname,
        message: "***", // hide message after correct guess
      });
      return;
    }

    const isCorrect = message.trim().toLowerCase() === room.currentWord.toLowerCase();

    if (isCorrect) {
      room.guessedPlayers.push(socket.id);
      player.score += 10;
      if (drawer) drawer.score += 5;

      io.to(roomCode).emit("correctGuess", {
        nickname: player.nickname,
        players: room.players.map(p => ({ id: p.id, nickname: p.nickname, score: p.score })),
      });

      broadcastPlayers(roomCode);

      // If everyone guessed, end round
      const nonDrawerCount = room.players.length - 1;
      if (room.guessedPlayers.length >= nonDrawerCount) {
        clearInterval(room.timer);
        endRound(roomCode);
      }
    } else {
      io.to(roomCode).emit("chatMessage", {
        type: "guess",
        nickname: player.nickname,
        message,
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms[roomCode]) return;

    const room = rooms[roomCode];
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;

    const wasDrawer = room.drawerIndex === idx;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      clearInterval(room.timer);
      delete rooms[roomCode];
      return;
    }

    // Reassign host if needed
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }

    // Fix drawer index
    if (room.drawerIndex >= room.players.length) {
      room.drawerIndex = 0;
    }

    broadcastPlayers(roomCode);

    if (room.started && wasDrawer) {
      clearInterval(room.timer);
      io.to(roomCode).emit("chatMessage", {
        type: "system",
        message: "The drawer left. Next round starting...",
      });
      setTimeout(() => advanceTurn(roomCode), 2000);
    }

    if (room.players.length < 2 && room.started) {
      clearInterval(room.timer);
      io.to(roomCode).emit("gamePaused", { message: "Not enough players. Waiting..." });
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 Draw & Guess running on http://localhost:${PORT}`);
});
