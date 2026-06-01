'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const { createGame, applyMove, calculateRoundScores, pickBotMove } = require('./game-logic');

// ─── Setup ────────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout:  60000,   // 60s — tolerate slow/flaky connections
  pingInterval: 25000,   // ping every 25s
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── Room Store ───────────────────────────────────────────────────────────────

const rooms = new Map();

// Grace-period timers: old socketId → setTimeout handle
const reconnectTimers = new Map();

// Bot turn timers: roomCode → setTimeout handle
const botTimers = new Map();

let botCounter = 0;
function generateBotId() {
  return `__bot_${++botCounter}_${Date.now()}`;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastGameState(room) {
  const { game, players, code } = room;
  if (!game) return;

  const publicState = {
    currentPlayerIndex: game.currentPlayerIndex,
    tableHand: game.tableHand,
    tablePlayedBy: game.tablePlayedBy,
    isFirstPlay: game.isFirstPlay,
    status: game.status,
    winner: game.winner,
    players: game.players.map((gp, i) => ({
      id: gp.id,
      name: players[i]?.name ?? gp.id,
      cardCount: gp.cardCount,
      passed: gp.passed,
      seatIndex: i,
      isBot: players[i]?.isBot ?? false,
    })),
  };

  for (let i = 0; i < players.length; i++) {
    const seated = players[i];
    if (seated.isBot) continue; // bots have no socket
    const socket = io.sockets.sockets.get(seated.id);
    if (!socket) continue;

    socket.emit('game:state', {
      ...publicState,
      myHand: game.players[i].hand,
      mySeatIndex: i,
    });
  }
}

function getRoomForSocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

function roomLobbyState(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => ({ name: p.name, seatIndex: p.seatIndex, isBot: p.isBot ?? false })),
    scores: room.scores,
  };
}

function buildScoreBoard(room) {
  return room.players.map(p => ({
    name: p.name,
    score: room.scores[p.id] ?? 0,
    isBot: p.isBot ?? false,
  })).sort((a, b) => b.score - a.score);
}

// ─── Bot Auto-play ────────────────────────────────────────────────────────────

function scheduleNextBotTurn(room) {
  if (!room.game || room.game.status === 'finished') return;

  const currentIdx    = room.game.currentPlayerIndex;
  const currentPlayer = room.players[currentIdx];
  if (!currentPlayer?.isBot) return; // not a bot's turn

  // Cancel any existing timer for this room
  if (botTimers.has(room.code)) {
    clearTimeout(botTimers.get(room.code));
  }

  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    if (!room.game || room.game.status === 'finished') return;

    const botId = currentPlayer.id;
    const cards = pickBotMove(room.game, botId);
    const result = applyMove(room.game, botId, cards);

    if (!result.success) {
      // Shouldn't happen — try passing as fallback
      applyMove(room.game, botId, null);
    }

    broadcastGameState(room);

    if (result.finished) {
      handleGameOver(room, botId);
      return;
    }

    // Schedule the next bot turn if needed
    scheduleNextBotTurn(room);
  }, 1200); // 1.2s delay so it feels natural

  botTimers.set(room.code, timer);
}

function handleGameOver(room, winnerId) {
  const allPlayers = room.game.players.map((gp, i) => ({
    id: gp.id,
    cardCount: gp.cardCount,
    name: room.players[i]?.name ?? gp.id,
  }));
  const deltas = calculateRoundScores(winnerId, allPlayers);

  for (const [id, delta] of Object.entries(deltas)) {
    room.scores[id] = (room.scores[id] || 0) + delta;
  }

  const breakdown = allPlayers.map(p => ({
    name: p.name,
    id: p.id,
    cardCount: p.cardCount,
    roundDelta: deltas[p.id],
    totalScore: room.scores[p.id],
    isWinner: p.id === winnerId,
  }));

  const winnerName = room.players.find(p => p.id === winnerId)?.name;
  room.status = 'finished';

  io.to(room.code).emit('game:over', {
    winner: winnerName,
    breakdown,
    scores: buildScoreBoard(room),
  });
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // ── Create Room ──────────────────────────────────────────────────────────
  socket.on('room:create', ({ name }, callback) => {
    if (!name || typeof name !== 'string') return callback({ error: 'Name is required.' });
    const trimmed = name.trim().slice(0, 20);
    const code = generateRoomCode();

    const room = {
      code,
      players: [{ id: socket.id, name: trimmed, seatIndex: 0 }],
      game: null,
      status: 'waiting',
      scores: { [socket.id]: 0 },
    };
    rooms.set(code, room);
    socket.join(code);

    console.log(`[room] ${trimmed} created room ${code}`);
    callback({ code, seatIndex: 0 });
    io.to(code).emit('room:update', roomLobbyState(room));
  });

  // ── Join Room ────────────────────────────────────────────────────────────
  socket.on('room:join', ({ code, name }, callback) => {
    if (!name || !code) return callback({ error: 'Name and room code required.' });

    const room = rooms.get(code.toUpperCase().trim());
    if (!room) return callback({ error: 'Room not found.' });

    const trimmed = name.trim().slice(0, 20);

    if (room.status !== 'waiting') {
      const existing = room.players.find(p => p.name === trimmed && !p.isBot);
      if (existing) {
        const oldId = existing.id;
        if (reconnectTimers.has(oldId)) {
          clearTimeout(reconnectTimers.get(oldId));
          reconnectTimers.delete(oldId);
        }
        existing.id = socket.id;
        if (room.game) {
          const gp = room.game.players.find(p => p.id === oldId);
          if (gp) gp.id = socket.id;
        }
        if (room.scores[oldId] !== undefined) {
          room.scores[socket.id] = room.scores[oldId];
          delete room.scores[oldId];
        }
        socket.join(code);
        console.log(`[room] ${trimmed} rejoined room ${code} via join (page refresh)`);
        callback({ code, seatIndex: existing.seatIndex, rejoined: true });
        if (room.status === 'playing' && room.game) broadcastGameState(room);
        else io.to(code).emit('room:update', roomLobbyState(room));
        io.to(code).emit('room:player_reconnected', { name: trimmed });
        return;
      }
      return callback({ error: 'Game already in progress.' });
    }

    if (room.players.length >= 4) return callback({ error: 'Room is full.' });

    if (room.players.some(p => p.name === trimmed)) {
      return callback({ error: `Name "${trimmed}" is already taken in this room.` });
    }

    const seatIndex = room.players.length;
    room.players.push({ id: socket.id, name: trimmed, seatIndex });
    room.scores[socket.id] = 0;

    socket.join(code);
    console.log(`[room] ${trimmed} joined room ${code} (seat ${seatIndex})`);
    callback({ code, seatIndex });
    io.to(code).emit('room:update', roomLobbyState(room));
  });

  // ── Add Bot ──────────────────────────────────────────────────────────────
  socket.on('room:add_bot', (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return callback?.({ error: 'Not in a room.' });
    if (room.players[0].id !== socket.id) return callback?.({ error: 'Only the host can add bots.' });
    if (room.status !== 'waiting') return callback?.({ error: 'Cannot add bots after game starts.' });
    if (room.players.length >= 4) return callback?.({ error: 'Room is full.' });

    const botNum   = room.players.filter(p => p.isBot).length + 1;
    const botId    = generateBotId();
    const botName  = `Bot ${botNum}`;
    const seatIndex = room.players.length;

    room.players.push({ id: botId, name: botName, seatIndex, isBot: true });
    room.scores[botId] = 0;

    console.log(`[room] Added ${botName} to room ${room.code}`);
    callback?.({ success: true });
    io.to(room.code).emit('room:update', roomLobbyState(room));
  });

  // ── Remove Bot ───────────────────────────────────────────────────────────
  socket.on('room:remove_bot', (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return callback?.({ error: 'Not in a room.' });
    if (room.players[0].id !== socket.id) return callback?.({ error: 'Only the host can remove bots.' });
    if (room.status !== 'waiting') return callback?.({ error: 'Cannot remove bots after game starts.' });

    // Remove the last bot added
    const lastBotIdx = room.players.map((p, i) => p.isBot ? i : -1).filter(i => i >= 0).pop();
    if (lastBotIdx === undefined) return callback?.({ error: 'No bots to remove.' });

    const bot = room.players[lastBotIdx];
    delete room.scores[bot.id];
    room.players.splice(lastBotIdx, 1);
    // Re-index seat numbers
    room.players.forEach((p, i) => { p.seatIndex = i; });

    console.log(`[room] Removed ${bot.name} from room ${room.code}`);
    callback?.({ success: true });
    io.to(room.code).emit('room:update', roomLobbyState(room));
  });

  // ── Reconnect (after a drop) ─────────────────────────────────────────────
  socket.on('room:reconnect', ({ code, name }, callback) => {
    const room = rooms.get(code?.toUpperCase().trim());
    if (!room) return callback?.({ error: 'Room not found.' });

    const playerIndex = room.players.findIndex(p => p.name === name && !p.isBot);
    if (playerIndex === -1) return callback?.({ error: 'Player not found in room.' });

    const player = room.players[playerIndex];
    const oldId  = player.id;

    if (reconnectTimers.has(oldId)) {
      clearTimeout(reconnectTimers.get(oldId));
      reconnectTimers.delete(oldId);
    }

    player.id = socket.id;
    if (room.game) {
      const gp = room.game.players.find(p => p.id === oldId);
      if (gp) gp.id = socket.id;
    }
    if (room.scores[oldId] !== undefined) {
      room.scores[socket.id] = room.scores[oldId];
      delete room.scores[oldId];
    }

    socket.join(code);
    console.log(`[room] ${name} reconnected to room ${code}`);

    callback?.({
      success:    true,
      seatIndex:  player.seatIndex,
      isHost:     playerIndex === 0,
      roomStatus: room.status,
    });

    if (room.status === 'playing' && room.game) {
      broadcastGameState(room);
      scheduleNextBotTurn(room); // resume bot play if it's a bot's turn
    } else {
      io.to(code).emit('room:update', roomLobbyState(room));
    }

    io.to(code).emit('room:player_reconnected', { name });
  });

  // ── Start Game ───────────────────────────────────────────────────────────
  socket.on('game:start', (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return callback?.({ error: 'Not in a room.' });
    if (room.players[0].id !== socket.id) return callback?.({ error: 'Only the host can start.' });
    if (room.players.length !== 4) return callback?.({ error: 'Need exactly 4 players to start.' });

    const playerIds = room.players.map(p => p.id);
    room.game   = createGame(playerIds);
    room.status = 'playing';

    console.log(`[game] Room ${room.code} started`);
    io.to(room.code).emit('game:started');
    broadcastGameState(room);
    scheduleNextBotTurn(room);
    callback?.({ success: true });
  });

  // ── Play Cards ───────────────────────────────────────────────────────────
  socket.on('game:play', ({ cards }, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.game) return callback?.({ error: 'No active game.' });

    const result = applyMove(room.game, socket.id, cards);
    if (!result.success) return callback?.({ error: result.reason });

    broadcastGameState(room);

    if (result.finished) {
      handleGameOver(room, socket.id);
      callback?.({ success: true });
      return;
    }

    scheduleNextBotTurn(room);
    callback?.({ success: true });
  });

  // ── Pass ─────────────────────────────────────────────────────────────────
  socket.on('game:pass', (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.game) return callback?.({ error: 'No active game.' });

    const result = applyMove(room.game, socket.id, null);
    if (!result.success) return callback?.({ error: result.reason });

    broadcastGameState(room);
    scheduleNextBotTurn(room);
    callback?.({ success: true });
  });

  // ── Rematch ───────────────────────────────────────────────────────────────
  socket.on('game:rematch', (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return callback?.({ error: 'Not in a room.' });
    if (room.players[0].id !== socket.id) return callback?.({ error: 'Only the host can start a rematch.' });
    if (room.players.length !== 4) return callback?.({ error: 'Need 4 players.' });

    const playerIds = room.players.map(p => p.id);
    room.game   = createGame(playerIds);
    room.status = 'playing';

    io.to(room.code).emit('game:started');
    broadcastGameState(room);
    scheduleNextBotTurn(room);
    callback?.({ success: true });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    console.log(`[room] ${player.name} dropped — waiting 30s for reconnect`);
    io.to(room.code).emit('room:player_dropped', { name: player.name });

    const timer = setTimeout(() => {
      reconnectTimers.delete(socket.id);

      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        rooms.delete(room.code);
        console.log(`[room] Room ${room.code} deleted (empty)`);
        return;
      }

      io.to(room.code).emit('room:player_left', { roomState: roomLobbyState(room) });

      if (room.status === 'playing') {
        if (botTimers.has(room.code)) {
          clearTimeout(botTimers.get(room.code));
          botTimers.delete(room.code);
        }
        room.status = 'waiting';
        room.game   = null;
        io.to(room.code).emit('game:aborted', {
          reason: `${player.name} disconnected. Game ended.`,
        });
      }
    }, 30000);

    reconnectTimers.set(socket.id, timer);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🃏  Big 2 server running on http://localhost:${PORT}\n`);
});
