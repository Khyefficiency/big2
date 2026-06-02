/**
 * Disconnect policy tests
 * Run with: node test-disconnect-policy.js
 */

const {
  pauseRoomForDisconnect,
  restoreRoomAfterReconnect,
  cancelPausedGame,
  markLobbyDisconnect,
  removePlayerFromRoom,
} = require('./room-policy');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  OK ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}${detail ? ' | ' + detail : ''}`);
    failed++;
  }
}

function makeRoom() {
  return {
    code: 'TEST',
    status: 'playing',
    game: {
      status: 'playing',
      currentPlayerIndex: 1,
      players: [
        { id: 'p1', hand: [{ rank: '3', suit: 'D' }], cardCount: 1 },
        { id: 'p2', hand: [{ rank: '4', suit: 'D' }], cardCount: 1 },
        { id: 'p3', hand: [{ rank: '5', suit: 'D' }], cardCount: 1 },
        { id: 'p4', hand: [{ rank: '6', suit: 'D' }], cardCount: 1 },
      ],
    },
    players: [
      { id: 'p1', name: 'A', seatIndex: 0 },
      { id: 'p2', name: 'B', seatIndex: 1 },
      { id: 'p3', name: 'C', seatIndex: 2 },
      { id: 'p4', name: 'D', seatIndex: 3 },
    ],
    scores: { p1: 10, p2: -5, p3: -5, p4: 0 },
  };
}

function makeWaitingRoom() {
  const room = makeRoom();
  room.status = 'waiting';
  room.game = null;
  return room;
}

console.log('\n-- Disconnect pauses game indefinitely --');
const paused = makeRoom();
const pauseResult = pauseRoomForDisconnect(paused, 'p2');

assert('disconnecting player is marked offline', pauseResult.player.name === 'B');
assert('room status becomes paused', paused.status === 'paused', `status=${paused.status}`);
assert('game object is preserved', paused.game && paused.game.currentPlayerIndex === 1);
assert('all players remain seated', paused.players.length === 4);
assert('score object is unchanged', paused.scores.p1 === 10 && paused.scores.p2 === -5);
assert('offline player id is tracked', paused.pausedBy.has('p2'));

console.log('\n-- Reconnect resumes paused game --');
restoreRoomAfterReconnect(paused, 'p2', 'p2-new');

assert('room resumes playing when all humans are online', paused.status === 'playing', `status=${paused.status}`);
assert('seat socket id is remapped', paused.players[1].id === 'p2-new');
assert('game player id is remapped', paused.game.players[1].id === 'p2-new');
assert('score id is remapped', paused.scores['p2-new'] === -5 && paused.scores.p2 === undefined);
assert('paused set is clear', paused.pausedBy.size === 0);

console.log('\n-- Players can explicitly cancel paused game --');
const cancelled = makeRoom();
pauseRoomForDisconnect(cancelled, 'p3');
cancelPausedGame(cancelled);

assert('cancel returns room to waiting', cancelled.status === 'waiting', `status=${cancelled.status}`);
assert('cancel clears active game', cancelled.game === null);
assert('cancel preserves all seats', cancelled.players.length === 4);
assert('cancel preserves total scores', cancelled.scores.p1 === 10 && cancelled.scores.p2 === -5);
assert('cancel clears paused set', cancelled.pausedBy.size === 0);

console.log('\n-- Lobby disconnect preserves room for reconnect --');
const waiting = makeWaitingRoom();
markLobbyDisconnect(waiting, 'p1');

assert('waiting room stays waiting', waiting.status === 'waiting', `status=${waiting.status}`);
assert('host seat is preserved', waiting.players.length === 4 && waiting.players[0].name === 'A');
assert('host is marked offline', waiting.players[0].disconnected === true);
assert('scores are preserved while offline', waiting.scores.p1 === 10);

restoreRoomAfterReconnect(waiting, 'p1', 'p1-new');

assert('host reconnects into same seat', waiting.players[0].id === 'p1-new');
assert('host offline marker clears', waiting.players[0].disconnected === false);
assert('host score id is remapped after reconnect', waiting.scores['p1-new'] === 10 && waiting.scores.p1 === undefined);

console.log('\n-- Explicit leave removes player from lobby --');
const left = makeWaitingRoom();
removePlayerFromRoom(left, 'p2');

assert('leaving player is removed', left.players.length === 3 && !left.players.some(p => p.id === 'p2'));
assert('scores for leaving player are removed', left.scores.p2 === undefined);
assert('remaining seats are re-indexed', left.players.every((p, i) => p.seatIndex === i));

console.log(`\n-- Results: ${passed} passed, ${failed} failed --\n`);
if (failed > 0) process.exit(1);
