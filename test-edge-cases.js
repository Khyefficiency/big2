'use strict';
/**
 * Edge case tests — round advancement, pass logic, win detection
 * Run with: node test-edge-cases.js
 */

const { createGame, applyMove, validatePlay, classifyHand, makeCard, HAND_TYPE } = require('./game-logic');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' | ' + detail : ''}`); failed++; }
}

// ─── Round advancement ────────────────────────────────────────────────────────
console.log('\n── Round advancement ──');

{
  const ids = ['A','B','C','D'];
  const g = createGame(ids);
  const start = g.currentPlayerIndex;
  const startPlayer = g.players[start];

  // First play: 3♦ single
  applyMove(g, startPlayer.id, [makeCard('3','♦')]);
  const afterFirst = g.currentPlayerIndex;
  assert('Turn advances after first play', afterFirst !== start);

  // The next 3 players all pass
  let current = g.players[g.currentPlayerIndex];
  applyMove(g, current.id, null); // pass
  current = g.players[g.currentPlayerIndex];
  applyMove(g, current.id, null); // pass
  current = g.players[g.currentPlayerIndex];
  applyMove(g, current.id, null); // pass

  // Now it should be a new round led by the original player
  assert('After 3 passes, original player leads new round', g.currentPlayerIndex === start);
  assert('Table is cleared for new round', g.tableHand === null);
  assert('All passed flags reset', g.players.every(p => !p.passed));
}

// ─── Cannot pass when leading ─────────────────────────────────────────────────
console.log('\n── Pass rules ──');

{
  const ids = ['A','B','C','D'];
  const g = createGame(ids);
  const startPlayer = g.players[g.currentPlayerIndex];

  // Try to pass as leader (table is empty)
  const r = applyMove(g, startPlayer.id, null);
  assert('Cannot pass when leading (empty table)', !r.success);

  // Play 3♦
  applyMove(g, startPlayer.id, [makeCard('3','♦')]);

  // Next player CAN pass
  const next = g.players[g.currentPlayerIndex];
  const r2 = applyMove(g, next.id, null);
  assert('Can pass when not leading', r2.success);

  // After winning a round, leader cannot pass
  const ids2 = ['A','B','C','D'];
  const g2 = createGame(ids2);
  const sp2 = g2.players[g2.currentPlayerIndex];
  applyMove(g2, sp2.id, [makeCard('3','♦')]);
  // Others pass
  applyMove(g2, g2.players[g2.currentPlayerIndex].id, null);
  applyMove(g2, g2.players[g2.currentPlayerIndex].id, null);
  applyMove(g2, g2.players[g2.currentPlayerIndex].id, null);
  // Now sp2 leads again — should not be able to pass
  const r3 = applyMove(g2, sp2.id, null);
  assert('Round winner cannot pass when leading new round', !r3.success);
}

// ─── Out of turn ──────────────────────────────────────────────────────────────
console.log('\n── Out of turn ──');

{
  const ids = ['A','B','C','D'];
  const g = createGame(ids);
  const start = g.currentPlayerIndex;
  const wrongIdx = (start + 2) % 4;
  const wrongPlayer = g.players[wrongIdx];

  const r = applyMove(g, wrongPlayer.id, [makeCard('3','♦')]);
  assert('Out-of-turn play rejected', !r.success);
}

// ─── Invalid hand types ───────────────────────────────────────────────────────
console.log('\n── Invalid combinations ──');

assert('4-card hand rejected',
  validatePlay([makeCard('3','♦'),makeCard('4','♦'),makeCard('5','♦'),makeCard('6','♦')], null, false).valid === false);

assert('3 cards of different ranks rejected',
  validatePlay([makeCard('3','♦'),makeCard('4','♣'),makeCard('5','♥')], null, false).valid === false);

assert('5-card non-combination rejected',
  validatePlay([
    makeCard('3','♦'),makeCard('5','♣'),makeCard('8','♥'),makeCard('J','♠'),makeCard('2','♦')
  ], null, false).valid === false);

// ─── 5-card hand hierarchy ────────────────────────────────────────────────────
console.log('\n── 5-card hand hierarchy ──');

const { compareHands, classifyHand: ch } = require('./game-logic');

const straight   = ch([makeCard('3','♦'),makeCard('4','♣'),makeCard('5','♥'),makeCard('6','♠'),makeCard('7','♦')]);
const flush      = ch([makeCard('3','♠'),makeCard('6','♠'),makeCard('9','♠'),makeCard('J','♠'),makeCard('K','♠')]);
const fullHouse  = ch([makeCard('5','♦'),makeCard('5','♣'),makeCard('5','♥'),makeCard('K','♦'),makeCard('K','♠')]);
const quad       = ch([makeCard('A','♦'),makeCard('A','♣'),makeCard('A','♥'),makeCard('A','♠'),makeCard('3','♦')]);
const sf         = ch([makeCard('8','♠'),makeCard('9','♠'),makeCard('10','♠'),makeCard('J','♠'),makeCard('Q','♠')]);

assert('Flush > Straight',          compareHands(straight,  flush)     > 0);
assert('Full house > Flush',        compareHands(flush,     fullHouse)  > 0);
assert('Quad > Full house',         compareHands(fullHouse, quad)       > 0);
assert('Straight flush > Quad',     compareHands(quad,      sf)         > 0);

// Higher flush beats lower flush (compare by highest card)
const flushLow  = ch([makeCard('3','♠'),makeCard('5','♠'),makeCard('7','♠'),makeCard('9','♠'),makeCard('J','♠')]);
const flushHigh = ch([makeCard('4','♠'),makeCard('6','♠'),makeCard('8','♠'),makeCard('10','♠'),makeCard('Q','♠')]);
assert('Higher flush beats lower flush', compareHands(flushLow, flushHigh) > 0);

// ─── Win detection ────────────────────────────────────────────────────────────
console.log('\n── Win detection ──');

{
  // Manually create a near-win state: one player has only 1 card left
  const ids = ['A','B','C','D'];
  const g = createGame(ids);

  // Give player 0 only one card (3♦, which they already hold as the starting player)
  const p0 = g.players[g.currentPlayerIndex];
  const the3D = p0.hand.find(c => c.rank === '3' && c.suit === '♦');
  p0.hand = [the3D];  // strip hand down to 1 card
  p0.cardCount = 1;

  const result = applyMove(g, p0.id, [the3D]);
  assert('Playing last card triggers win', result.finished === true);
  assert('Winner ID set correctly', g.winner === p0.id);
  assert('Game status = finished', g.status === 'finished');
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
