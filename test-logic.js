/**
 * Quick sanity tests for game-logic.js
 * Run with: node test-logic.js
 */

const {
  makeCard, classifyHand, compareHands, validatePlay,
  createGame, applyMove, HAND_TYPE, findStartingPlayer, buildDeck, dealCards,
} = require('./game-logic');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

// ─── Card classification ───────────────────────────────────────────────────────
console.log('\n── Hand classification ──');
assert('Single 3♦', classifyHand([makeCard('3','♦')]).type === HAND_TYPE.SINGLE);
assert('Pair AA',   classifyHand([makeCard('A','♦'), makeCard('A','♠')]).type === HAND_TYPE.PAIR);
assert('Invalid pair (diff ranks)', classifyHand([makeCard('3','♦'), makeCard('4','♦')]) === null);
assert('Triple 5s', classifyHand([makeCard('5','♦'), makeCard('5','♣'), makeCard('5','♥')]).type === HAND_TYPE.TRIPLE);

const straight = [makeCard('3','♦'), makeCard('4','♣'), makeCard('5','♥'), makeCard('6','♠'), makeCard('7','♦')];
assert('Straight 3-7', classifyHand(straight).type === HAND_TYPE.STRAIGHT);

const flush = [makeCard('3','♠'), makeCard('6','♠'), makeCard('9','♠'), makeCard('J','♠'), makeCard('K','♠')];
assert('Flush', classifyHand(flush).type === HAND_TYPE.FLUSH);

const fullHouse = [makeCard('5','♦'), makeCard('5','♣'), makeCard('5','♥'), makeCard('K','♦'), makeCard('K','♠')];
assert('Full house', classifyHand(fullHouse).type === HAND_TYPE.FULL_HOUSE);

const quad = [makeCard('A','♦'), makeCard('A','♣'), makeCard('A','♥'), makeCard('A','♠'), makeCard('3','♦')];
assert('Quad aces', classifyHand(quad).type === HAND_TYPE.QUAD);

const sf = [makeCard('8','♠'), makeCard('9','♠'), makeCard('10','♠'), makeCard('J','♠'), makeCard('Q','♠')];
assert('Straight flush', classifyHand(sf).type === HAND_TYPE.STRAIGHT_FLUSH);

assert('4-card hand = null', classifyHand([makeCard('3','♦'), makeCard('4','♦'), makeCard('5','♦'), makeCard('6','♦')]) === null);

// ─── Hand comparison ──────────────────────────────────────────────────────────
console.log('\n── Hand comparison ──');

const single3D = classifyHand([makeCard('3','♦')]);
const single3C = classifyHand([makeCard('3','♣')]);
const single4D = classifyHand([makeCard('4','♦')]);
assert('3♣ beats 3♦ (suit)', compareHands(single3D, single3C) > 0);
assert('4♦ beats 3♦ (rank)', compareHands(single3D, single4D) > 0);
assert('3♦ does NOT beat 4♦', compareHands(single4D, single3D) < 0);

const pair3s = classifyHand([makeCard('3','♣'), makeCard('3','♥')]);
const pair4s = classifyHand([makeCard('4','♦'), makeCard('4','♣')]);
assert('Pair 4s beats pair 3s', compareHands(pair3s, pair4s) > 0);
assert('Single vs pair = null (incompatible)', compareHands(single3D, pair3s) === null);

// 5-card: flush beats straight
const straightHand  = classifyHand(straight);
const flushHand     = classifyHand(flush);
assert('Flush beats straight', compareHands(straightHand, flushHand) > 0);

// ─── validatePlay ─────────────────────────────────────────────────────────────
console.log('\n── validatePlay ──');

assert('First play must include 3♦ (valid)',
  validatePlay([makeCard('3','♦')], null, true).valid === true);
assert('First play without 3♦ (invalid)',
  validatePlay([makeCard('4','♣')], null, true).valid === false);
assert('Single beat single (valid)',
  validatePlay([makeCard('4','♦')], single3D, false).valid === true);
assert('Weaker single rejected',
  validatePlay([makeCard('3','♦')], single4D, false).valid === false);
assert('Mismatched count rejected',
  validatePlay([makeCard('3','♦'), makeCard('3','♣')], single4D, false).valid === false);
assert('Lead any valid hand when table empty',
  validatePlay([makeCard('K','♠')], null, false).valid === true);

// ─── Game lifecycle ───────────────────────────────────────────────────────────
console.log('\n── Game lifecycle ──');

const playerIds = ['alice', 'bob', 'charlie', 'diana'];
const game = createGame(playerIds);

assert('4 players created', game.players.length === 4);
assert('Each player has 13 cards', game.players.every(p => p.hand.length === 13));
assert('Starting player holds 3♦',
  game.players[game.currentPlayerIndex].hand.some(c => c.rank === '3' && c.suit === '♦'));
assert('Game status = playing', game.status === 'playing');
assert('isFirstPlay = true', game.isFirstPlay === true);

// Starting player plays 3♦
const startPlayer = game.players[game.currentPlayerIndex];
const result1 = applyMove(game, startPlayer.id, [makeCard('3','♦')]);
assert('First move (3♦) accepted', result1.success === true);
assert('isFirstPlay cleared', game.isFirstPlay === false);
assert('Table has 1 card', game.tableHand.cards.length === 1);

// Wrong player tries to play
const wrongPlayer = game.players[(game.currentPlayerIndex + 1) % 4];
const result2 = applyMove(game, wrongPlayer.id, [makeCard('4','♦')]);
assert('Out-of-turn play rejected', result2.success === false);

// Correct next player passes
const nextPlayer = game.players[game.currentPlayerIndex];
const passResult = applyMove(game, nextPlayer.id, null);
assert('Pass accepted', passResult.success === true);
assert('Player marked as passed', nextPlayer.passed === true);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
