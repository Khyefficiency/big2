/**
 * Scoring system tests
 * Run with: node test-scoring.js
 */

const { cardMultiplier, calculateRoundScores } = require('./game-logic');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' | ' + detail : ''}`);
    failed++;
  }
}

function eq(a, b) { return a === b; }

// ─── Multipliers ──────────────────────────────────────────────────────────────
console.log('\n── Multipliers ──');
assert('1 card  → ×1', eq(cardMultiplier(1), 1));
assert('7 cards → ×1', eq(cardMultiplier(7), 1));
assert('8 cards → ×2', eq(cardMultiplier(8), 2));
assert('10 cards → ×2', eq(cardMultiplier(10), 2));
assert('11 cards → ×3', eq(cardMultiplier(11), 3));
assert('12 cards → ×3', eq(cardMultiplier(12), 3));
assert('13 cards → ×4', eq(cardMultiplier(13), 4));

// ─── Simple case: all losers in normal range ──────────────────────────────────
console.log('\n── Normal range (all losers 1-7 cards) ──');
// Winner=A. Losers: B=3 cards, C=5 cards, D=6 cards
const simple = calculateRoundScores('A', [
  { id: 'A', cardCount: 0 },
  { id: 'B', cardCount: 3 },
  { id: 'C', cardCount: 5 },
  { id: 'D', cardCount: 6 },
]);

// Winner payments: B→A = 5+3=8, C→A = 5+5=10, D→A = 5+6=11. Total A gains = 29
assert('A gains 29 from winner payments', eq(simple['A'], 29), `got ${simple['A']}`);

// B weighted=3, C weighted=5, D weighted=6
// B vs C: C pays B 2. B vs D: D pays B 3. C vs D: D pays C 1.
// B net contra: +2+3 = +5.  C net contra: -2+1 = -1.  D net contra: -3-1 = -4.
// B total: -8 +5 = -3.  C total: -10 -1 = -11.  D total: -11 -4 = -15.
assert('B total = -3',  eq(simple['B'], -3),  `got ${simple['B']}`);
assert('C total = -11', eq(simple['C'], -11), `got ${simple['C']}`);
assert('D total = -15', eq(simple['D'], -15), `got ${simple['D']}`);

// Sanity: all deltas sum to zero
const simpleSum = Object.values(simple).reduce((a, b) => a + b, 0);
assert('Deltas sum to 0 (simple)', eq(simpleSum, 0), `sum=${simpleSum}`);

// ─── Multiplier case ──────────────────────────────────────────────────────────
console.log('\n── With multipliers ──');
// Winner=A. B=5 (×1), C=9 (×2), D=13 (×4)
const multi = calculateRoundScores('A', [
  { id: 'A', cardCount: 0 },
  { id: 'B', cardCount: 5 },
  { id: 'C', cardCount: 9 },
  { id: 'D', cardCount: 13 },
]);

// Winner payments: B→A=5+5=10, C→A=5+18=23, D→A=5+52=57. Total A=90
assert('A gains 90', eq(multi['A'], 90), `got ${multi['A']}`);

// Contra weighted values: B=5, C=18, D=52
// B vs C: C(18) > B(5) → C pays B 13
// B vs D: D(52) > B(5) → D pays B 47
// C vs D: D(52) > C(18) → D pays C 34
// B net contra: +13+47 = +60.  C net contra: -13+34 = +21.  D net contra: -47-34 = -81.
// B total: -10+60 = 50.  C total: -23+21 = -2.  D total: -57-81 = -138.
assert('B total = 50',   eq(multi['B'],  50),  `got ${multi['B']}`);
assert('C total = -2',   eq(multi['C'],  -2),  `got ${multi['C']}`);
assert('D total = -138', eq(multi['D'], -138), `got ${multi['D']}`);

const multiSum = Object.values(multi).reduce((a, b) => a + b, 0);
assert('Deltas sum to 0 (multi)', eq(multiSum, 0), `sum=${multiSum}`);

// ─── Equal losers (no contra payment) ────────────────────────────────────────
console.log('\n── Equal losers (same card count) ──');
const equal = calculateRoundScores('A', [
  { id: 'A', cardCount: 0 },
  { id: 'B', cardCount: 4 },
  { id: 'C', cardCount: 4 },
  { id: 'D', cardCount: 4 },
]);
// Contra between equal losers = 0
// Each loser pays winner 5+4=9. A gains 27.
assert('A gains 27', eq(equal['A'], 27), `got ${equal['A']}`);
assert('B = -9', eq(equal['B'], -9), `got ${equal['B']}`);
assert('C = -9', eq(equal['C'], -9), `got ${equal['C']}`);
assert('D = -9', eq(equal['D'], -9), `got ${equal['D']}`);
const equalSum = Object.values(equal).reduce((a, b) => a + b, 0);
assert('Deltas sum to 0 (equal)', eq(equalSum, 0), `sum=${equalSum}`);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
