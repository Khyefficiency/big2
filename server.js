'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const { createGame, applyMove, calculateRoundScores } = require('./game-logic');

// ─── Setup ────────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ─── Room Store ───────────────────────────────────────────────────────────────

/**
 * rooms: Map<roomCode, Room>
 *
 * Room shape:
 * {
 *   code: string,
 *   players: [{ id: socketId, name: string, seatIndex: number }],
 *   game: GameState | null,
 *   status: 'waiting' | 'playing' | 'finished',
 *   scores: { [socketId]: number },   // running point tally across rounds
 * }
 */
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Send each player only their own hand; everyone gets public state. */
function broadcastGameState(room) {
  const { game, players, code } = room;
  if (!game) return;

  // Public state — no private hands
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
    })),
  };

  // Send each connected player their private hand
  for (let i = 0; i < players.length; i++) {
    const seated = players[i];
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
    players: room.players.map(p => ({ name: p.name, seatIndex: p.seatIndex })),
    scores: room.scores,
  };
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // ── Create Room ──────────────────────────────────────────────────────────
  socket.on('room:create', ({ name }, callback) => {
    if (!name || typeof name !== 'string') {
      return callback({ error: 'Name is required.' });
    }
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
    if (room.status !== 'waiting') return callback({ error: 'Game already in progress.' });
    if (room.players.length >= 4) return callback({ error: 'Room is full.' });

    const trimmed = name.trim().slice(0, 20);
    const seatIndex = room.players.length;
    room.players.push({ id: socket.id, name: trimmed, seatIndex });
    room.scores[socket.id] = 0;

    socket.join(code);
    console.log(`[room] ${trimmed} joined room ${code} (seat ${seatIndex})`);
    callback({ code, seatIndex });
    io.to(code).emit('room:update', roomLobbyState(room));
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
    callback?.({ success: true });
  });

  // ── Play Cards ───────────────────────────────────────────────────────────
  socket.on('game:play', ({ cards }, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.game) return callback?.({ error: 'No active game.' });

    const result = applyMove(room.game, socket.id, cards);
    if (!result.success) {
      return callback?.({ error: result.reason });
    }

    broadcastGameState(room);

    if (result.finished) {
      // Calculate round settlement using the points system
      const allPlayers = room.game.players.map((gp, i) => ({
        id: gp.id,
        cardCount: gp.cardCount,
        name: room.players[i]?.name ?? gp.id,
      }));
      const deltas = calculateRoundScores(socket.id, allPlayers);

      // Apply deltas to running scores
      for (const [id, delta] of Object.entries(deltas)) {
        room.scores[id] = (room.scores[id] || 0) + delta;
      }

      // Build detailed breakdown for the end-of-round screen
      const breakdown = allPlayers.map(p => ({
        name: p.name,
        id: p.id,
        cardCount: p.cardCount,
        roundDelta: deltas[p.id],
        totalScore: room.scores[p.id],
        isWinner: p.id === socket.id,
      }));

      room.status = 'finished';
      io.to(room.code).emit('game:over', {
        winner: room.players.find(p => p.id === socket.id)?.name,
        breakdown,
        scores: buildScoreBoard(room),
      });
    }

    callback?.({ success: true });
  });

  // ── Pass ─────────────────────────────────────────────────────────────────
  socket.on('game:pass', (_, callback) => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.game) return callback?.({ error: 'No active game.' });

    const result = applyMove(room.game, socket.id, null);
    if (!result.success) {
      return callback?.({ error: result.reason });
    }

    broadcastGameState(room);
    callback?.({ success: true });
  });

  // ── Play Again ───────────────────────────────────────────────────────────
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
    callback?.({ success: true });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      // Empty room — clean up
      rooms.delete(room.code);
      console.log(`[room] Room ${room.code} deleted (empty)`);
    } else {
      // Notify remaining players
      io.to(room.code).emit('room:player_left', { roomState: roomLobbyState(room) });

      // If a game was in progress, abort it
      if (room.status === 'playing') {
        room.status  = 'waiting';
        room.game    = null;
        io.to(room.code).emit('game:aborted', { reason: 'A player disconnected. Return to lobby.' });
      }
    }
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildScoreBoard(room) {
  return room.players.map(p => ({
    name: p.name,
    score: room.scores[p.id] ?? 0,
  })).sort((a, b) => a.score - b.score);
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🃏  Big 2 server running on http://localhost:${PORT}\n`);
});
