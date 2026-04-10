/* ═══════════════════════════════════════════════════════════════════
   SKETCHLY — CLIENT SCRIPT
   ═══════════════════════════════════════════════════════════════════ */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let myId        = null;
let myNickname  = "";
let roomCode    = "";
let isDrawer    = false;
let isEraser    = false;
let currentColor = "#1a1a2e";
let brushSize   = 6;
let drawing     = false;
let lastX = 0, lastY = 0;
let strokes     = []; // local undo stack

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const lobbyScreen    = document.getElementById("lobbyScreen");
const waitingScreen  = document.getElementById("waitingScreen");
const gameScreen     = document.getElementById("gameScreen");

const nicknameInput  = document.getElementById("nicknameInput");
const roomCodeInput  = document.getElementById("roomCodeInput");
const createRoomBtn  = document.getElementById("createRoomBtn");
const joinRoomBtn    = document.getElementById("joinRoomBtn");
const lobbyError     = document.getElementById("lobbyError");

const displayRoomCode   = document.getElementById("displayRoomCode");
const copyCodeBtn       = document.getElementById("copyCodeBtn");
const waitingPlayerList = document.getElementById("waitingPlayerList");
const startGameBtn      = document.getElementById("startGameBtn");

const roundDisplay      = document.getElementById("roundDisplay");
const drawerNameDisplay = document.getElementById("drawerNameDisplay");
const wordHintDisplay   = document.getElementById("wordHintDisplay");
const timerDisplay      = document.getElementById("timerDisplay");
const scoreboard        = document.getElementById("scoreboard");

const canvas            = document.getElementById("gameCanvas");
const ctx               = canvas.getContext("2d");
const canvasOverlay     = document.getElementById("canvasOverlay");
const overlayIcon       = document.getElementById("overlayIcon");
const overlayText       = document.getElementById("overlayText");
const drawingTools      = document.getElementById("drawingTools");

const colorPicker       = document.getElementById("colorPicker");
const brushSizeSlider   = document.getElementById("brushSize");
const brushSizeLabel    = document.getElementById("brushSizeLabel");
const eraserBtn         = document.getElementById("eraserBtn");
const undoBtn           = document.getElementById("undoBtn");
const clearBtn          = document.getElementById("clearBtn");

const chatMessages      = document.getElementById("chatMessages");
const chatInput         = document.getElementById("chatInput");
const sendGuessBtn      = document.getElementById("sendGuessBtn");

const wordChoiceModal   = document.getElementById("wordChoiceModal");
const wordChoices       = document.getElementById("wordChoices");
const roundEndModal     = document.getElementById("roundEndModal");
const revealedWord      = document.getElementById("revealedWord");
const roundScores       = document.getElementById("roundScores");

// ─── Screen Switcher ──────────────────────────────────────────────────────────
function showScreen(screenEl) {
  [lobbyScreen, waitingScreen, gameScreen].forEach(s => s.classList.remove("active"));
  screenEl.classList.add("active");
  screenEl.style.display = "flex";
  [lobbyScreen, waitingScreen, gameScreen].forEach(s => {
    if (s !== screenEl) s.style.display = "none";
  });
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
createRoomBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) return showError("Please enter a nickname.");
  myNickname = nickname;
  socket.emit("createRoom", { nickname }, (res) => {
    if (res.error) return showError(res.error);
    roomCode = res.roomCode;
    enterWaiting();
  });
});

joinRoomBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!nickname) return showError("Please enter a nickname.");
  if (!code) return showError("Please enter a room code.");
  myNickname = nickname;
  socket.emit("joinRoom", { nickname, roomCode: code }, (res) => {
    if (res.error) return showError(res.error);
    roomCode = res.roomCode;
    enterWaiting();
  });
});

nicknameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createRoomBtn.click(); });
roomCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoomBtn.click(); });
roomCodeInput.addEventListener("input", () => roomCodeInput.value = roomCodeInput.value.toUpperCase());

function showError(msg) {
  lobbyError.textContent = msg;
  setTimeout(() => lobbyError.textContent = "", 3000);
}

function enterWaiting() {
  displayRoomCode.textContent = roomCode;
  showScreen(waitingScreen);
}

copyCodeBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(roomCode).then(() => {
    copyCodeBtn.textContent = "✅";
    setTimeout(() => copyCodeBtn.textContent = "📋", 1500);
  });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("startGame");
});

// ─── Socket: Connection ───────────────────────────────────────────────────────
socket.on("connect", () => { myId = socket.id; });

// ─── Players Update ───────────────────────────────────────────────────────────
socket.on("playersUpdate", ({ players, hostId, drawerIndex }) => {
  // Update waiting room player list
  waitingPlayerList.innerHTML = "";
  players.forEach(p => {
    const el = document.createElement("div");
    el.className = "waiting-player" + (p.id === hostId ? " host" : "");
    el.innerHTML = (p.id === hostId ? "👑 " : "🎨 ") + escHtml(p.nickname);
    waitingPlayerList.appendChild(el);
  });

  // Show/hide start button
  const amHost = socket.id === hostId;
  startGameBtn.style.display = (amHost && players.length >= 2) ? "block" : "none";

  // Update scoreboard in game
  renderScoreboard(players, drawerIndex);

  // Determine if I'm the drawer
  if (players[drawerIndex]) {
    isDrawer = players[drawerIndex].id === socket.id;
  }
});

function renderScoreboard(players, drawerIndex) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  scoreboard.innerHTML = "";
  sorted.forEach((p, i) => {
    const isCurrentDrawer = players[drawerIndex] && players[drawerIndex].id === p.id;
    const el = document.createElement("div");
    el.className = "score-entry" + (isCurrentDrawer ? " drawing" : "");
    el.innerHTML = `
      <span class="rank">${i === 0 ? "👑" : `#${i + 1}`}</span>
      <span class="name">${escHtml(p.nickname)}${isCurrentDrawer ? " 🖌️" : ""}</span>
      <span class="pts">${p.score}</span>
    `;
    scoreboard.appendChild(el);
  });
}

// ─── Game Started ─────────────────────────────────────────────────────────────
socket.on("gameStarted", () => {
  showScreen(gameScreen);
  clearCanvas();
  addSystemMessage("🎮 Game started! Good luck!");
});

// ─── Choose Word (Drawer Only) ────────────────────────────────────────────────
socket.on("chooseWord", ({ words, round }) => {
  roundDisplay.textContent = round;
  wordChoices.innerHTML = "";
  words.forEach(word => {
    const btn = document.createElement("button");
    btn.className = "word-choice-btn";
    btn.textContent = word;
    btn.addEventListener("click", () => {
      socket.emit("wordChosen", { word });
      wordChoiceModal.classList.remove("visible");
    });
    wordChoices.appendChild(btn);
  });
  wordChoiceModal.classList.add("visible");
});

// ─── Word Confirmed (Drawer sees their word) ──────────────────────────────────
socket.on("wordConfirmed", ({ word }) => {
  wordHintDisplay.textContent = word.toUpperCase();
  drawerNameDisplay.textContent = "You";
  canvasOverlay.classList.add("hidden");
  drawingTools.style.display = "flex";
  canvas.classList.remove("readonly");
  chatInput.disabled = true;
  sendGuessBtn.disabled = true;
  chatInput.placeholder = "You're drawing! No guessing 🎨";
  addSystemMessage(`🎯 You're drawing: "${word}"`);
});

// ─── Drawer is Choosing (Non-drawers) ────────────────────────────────────────
socket.on("drawerChoosing", ({ drawerName, round }) => {
  roundDisplay.textContent = round;
  drawerNameDisplay.textContent = drawerName;
  wordHintDisplay.textContent = "";
  overlayIcon.textContent = "⏳";
  overlayText.textContent = `${drawerName} is choosing a word...`;
  canvasOverlay.classList.remove("hidden");
  drawingTools.style.display = "none";
  canvas.classList.add("readonly");
  chatInput.disabled = false;
  sendGuessBtn.disabled = false;
  chatInput.placeholder = "Type your guess...";
});

// ─── Round Started (Non-drawers) ─────────────────────────────────────────────
socket.on("roundStarted", ({ drawerName, wordHint, wordLength, round }) => {
  roundDisplay.textContent = round;
  drawerNameDisplay.textContent = drawerName;
  wordHintDisplay.textContent = wordHint.split("").join(" ");
  overlayIcon.textContent = "🖌️";
  overlayText.textContent = `${drawerName} is drawing...`;
  canvasOverlay.classList.remove("hidden");
  // keep overlay for non-drawers so they can't interact, but make it semi-transparent
  canvasOverlay.style.background = "rgba(0,0,0,0)";
  canvasOverlay.style.pointerEvents = "none";
  addSystemMessage(`🖌️ ${drawerName} is drawing! Guess now!`);
});

// ─── Timer ────────────────────────────────────────────────────────────────────
socket.on("timerUpdate", ({ timeLeft }) => {
  timerDisplay.textContent = timeLeft;
  timerDisplay.className = "timer" + (timeLeft <= 10 ? " urgent" : "");
});

// ─── Draw Events ──────────────────────────────────────────────────────────────
socket.on("draw", (data) => {
  if (isDrawer) return; // don't redraw own strokes
  renderDrawData(data);
});

socket.on("drawHistory", (history) => {
  clearCanvas(false);
  history.forEach(d => renderDrawData(d));
});

socket.on("clearCanvas", () => {
  clearCanvas(false);
  strokes = [];
});

function renderDrawData(data) {
  if (data.type === "clear") {
    clearCanvas(false);
    return;
  }
  if (data.type === "undo") {
    // Replayed on receiver side via history
    return;
  }
  ctx.strokeStyle = data.color;
  ctx.lineWidth   = data.size;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  if (data.type === "start") {
    ctx.beginPath();
    ctx.moveTo(data.x, data.y);
  } else if (data.type === "move") {
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
  }
}

// ─── Chat & Guesses ───────────────────────────────────────────────────────────
socket.on("chatMessage", ({ type, nickname, message }) => {
  if (type === "system") {
    addSystemMessage(message);
  } else {
    addChatMessage(nickname, message);
  }
});

socket.on("correctGuess", ({ nickname, players }) => {
  addCorrectGuessMessage(nickname);
  renderScoreboard(players, getCurrentDrawerIndex(players));
});

function getCurrentDrawerIndex(players) {
  // Best effort — we don't have drawerIndex here, just show scores
  return -1;
}

function sendGuess() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("guess", { message: msg });
  chatInput.value = "";
}

sendGuessBtn.addEventListener("click", sendGuess);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendGuess();
});

// ─── Round End ────────────────────────────────────────────────────────────────
socket.on("roundEnd", ({ word, players }) => {
  // Close any open modals
  wordChoiceModal.classList.remove("visible");

  revealedWord.textContent = word;
  roundScores.innerHTML = "";

  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "round-score-entry";
    el.innerHTML = `
      <span class="score-name">${i === 0 ? "👑 " : ""}${escHtml(p.nickname)}</span>
      <span class="score-pts">${p.score} pts</span>
    `;
    roundScores.appendChild(el);
  });

  roundEndModal.classList.add("visible");

  // Reset UI for next round
  isDrawer = false;
  drawingTools.style.display = "none";
  chatInput.disabled = false;
  sendGuessBtn.disabled = false;
  chatInput.placeholder = "Type your guess...";

  setTimeout(() => {
    roundEndModal.classList.remove("visible");
    canvasOverlay.classList.remove("hidden");
    canvasOverlay.style.background = "rgba(15,14,23,0.85)";
    canvasOverlay.style.pointerEvents = "";
    overlayIcon.textContent = "⏳";
    overlayText.textContent = "Next round starting...";
  }, 3800);
});

socket.on("gamePaused", ({ message }) => {
  addSystemMessage("⚠️ " + message);
  canvasOverlay.classList.remove("hidden");
  canvasOverlay.style.background = "rgba(15,14,23,0.85)";
  canvasOverlay.style.pointerEvents = "";
  overlayIcon.textContent = "⏸️";
  overlayText.textContent = message;
});

// ─── Canvas Drawing ───────────────────────────────────────────────────────────
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
canvas.addEventListener("mouseup", stopDraw);
canvas.addEventListener("mouseleave", stopDraw);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener("touchmove", (e) => { e.preventDefault(); moveDraw(e); }, { passive: false });
canvas.addEventListener("touchend", stopDraw);

function startDraw(e) {
  if (!isDrawer) return;
  drawing = true;
  const { x, y } = getPos(e);
  lastX = x; lastY = y;

  const color = isEraser ? "#ffffff" : currentColor;
  ctx.strokeStyle = color;
  ctx.lineWidth = brushSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);

  const data = { type: "start", x, y, color, size: brushSize };
  strokes.push([data]);
  socket.emit("draw", data);
}

function moveDraw(e) {
  if (!isDrawer || !drawing) return;
  const { x, y } = getPos(e);
  const color = isEraser ? "#ffffff" : currentColor;

  ctx.strokeStyle = color;
  ctx.lineWidth = brushSize;
  ctx.lineTo(x, y);
  ctx.stroke();
  lastX = x; lastY = y;

  const data = { type: "move", x, y, color, size: brushSize };
  if (strokes.length) strokes[strokes.length - 1].push(data);
  socket.emit("draw", data);
}

function stopDraw() {
  drawing = false;
}

// ─── Drawing Tools ────────────────────────────────────────────────────────────
document.querySelectorAll(".swatch").forEach(sw => {
  sw.addEventListener("click", () => {
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("active"));
    sw.classList.add("active");
    currentColor = sw.dataset.color;
    colorPicker.value = currentColor;
    setEraser(false);
  });
});

colorPicker.addEventListener("input", () => {
  currentColor = colorPicker.value;
  document.querySelectorAll(".swatch").forEach(s => s.classList.remove("active"));
  setEraser(false);
});

brushSizeSlider.addEventListener("input", () => {
  brushSize = parseInt(brushSizeSlider.value);
  brushSizeLabel.textContent = brushSize;
});

eraserBtn.addEventListener("click", () => setEraser(!isEraser));

function setEraser(val) {
  isEraser = val;
  eraserBtn.classList.toggle("active", val);
}

undoBtn.addEventListener("click", () => {
  if (!isDrawer) return;
  strokes.pop();
  redrawAll();
  socket.emit("draw", { type: "undo" });
});

clearBtn.addEventListener("click", () => {
  if (!isDrawer) return;
  clearCanvas(true);
  socket.emit("draw", { type: "clear" });
});

function clearCanvas(emit = false) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  strokes = [];
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  strokes.forEach(stroke => {
    stroke.forEach(data => {
      ctx.strokeStyle = data.color;
      ctx.lineWidth = data.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (data.type === "start") {
        ctx.beginPath();
        ctx.moveTo(data.x, data.y);
      } else if (data.type === "move") {
        ctx.lineTo(data.x, data.y);
        ctx.stroke();
      }
    });
  });

  // Re-sync server draw history by re-emitting
  socket.emit("draw", { type: "clear" });
  strokes.forEach(stroke => {
    stroke.forEach(data => socket.emit("draw", data));
  });
}

// ─── Chat Helpers ─────────────────────────────────────────────────────────────
function addChatMessage(nickname, message) {
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `<span class="author">${escHtml(nickname)}:</span> ${escHtml(message)}`;
  appendChat(el);
}

function addSystemMessage(message) {
  const el = document.createElement("div");
  el.className = "chat-msg system";
  el.textContent = message;
  appendChat(el);
}

function addCorrectGuessMessage(nickname) {
  const el = document.createElement("div");
  el.className = "chat-msg correct-guess";
  el.textContent = `🎉 ${nickname} guessed the word!`;
  appendChat(el);
}

function appendChat(el) {
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Init canvas ──────────────────────────────────────────────────────────────
clearCanvas();
