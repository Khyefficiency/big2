/**
 * Big 2 (Chor Dai Di) — Game Logic Engine
 *
 * Rules:
 * - 4 players, 13 cards each
 * - Card rank (low→high): 3 4 5 6 7 8 9 10 J Q K A 2
 * - Suit rank (low→high): ♦ ♣ ♥ ♠
 * - 3♦ always starts the first round
 * - Valid play types: single, pair, triple, straight, flush, full house, quad, straight flush
 * - A higher play of the SAME type beats the last played hand
 * - Pass = out for this round (cannot re-enter until next round)
 * - Game ends when a player empties their hand
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = ['♦','♣','♥','♠']; // low → high

const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_VALUE = Object.fromEntries(SUITS.map((s, i) => [s, i]));

// Hand type priority (for 5-card hands — higher wins over lower type)
const HAND_TYPE = {
  SINGLE:         1,
  PAIR:           2,
  TRIPLE:         3,
  STRAIGHT:       4,
  FLUSH:          5,
  FULL_HOUSE:     6,
  QUAD:           7,   // four-of-a-kind + kicker
  STRAIGHT_FLUSH: 8,
};

// ─── Card Utilities ────────────────────────────────────────────────────────────

/**
 * Create a card object.
 * @param {string} rank  e.g. '3', '10', 'A', '2'
 * @param {string} suit  e.g. '♦', '♠'
 */
function makeCard(rank, suit) {
  return { rank, suit };
}

/** Numeric value of a card for comparison. Higher = stronger. */
function cardValue(card) {
  return RANK_VALUE[card.rank] * 4 + SUIT_VALUE[card.suit];
}

/** Compare two cards. Returns positive if a > b. */
function compareCards(a, b) {
  return cardValue(a) - cardValue(b);
}

/** Sort cards ascending (weakest first). Mutates array. */
function sortCards(cards) {
  return cards.sort(compareCards);
}

/** Build and shuffle a full 52-card deck. */
function buildDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(makeCard(rank, suit));
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Deal deck into 4 hands of 13 cards each. */
function dealCards(deck) {
  const hands = [[], [], [], []];
  deck.forEach((card, i) => hands[i % 4].push(card));
  hands.forEach(sortCards);
  return hands;
}

/** Find which hand index holds 3♦ (starting player). */
function findStartingPlayer(hands) {
  for (let i = 0; i < hands.length; i++) {
    if (hands[i].some(c => c.rank === '3' && c.suit === '♦')) return i;
  }
  return 0;
}

// ─── Hand Classification ───────────────────────────────────────────────────────

/**
 * Classify an array of cards into a hand descriptor.
 * Returns null if the combination is not a legal play.
 *
 * Descriptor shape:
 * {
 *   type: HAND_TYPE.*,
 *   primaryCard: Card,   // the card that determines rank within the type
 *   cards: Card[],       // original cards (sorted)
 * }
 */
function classifyHand(cards) {
  if (!cards || cards.length === 0) return null;
  const sorted = sortCards([...cards]);

  if (cards.length === 1) return classSingle(sorted);
  if (cards.length === 2) return classPair(sorted);
  if (cards.length === 3) return classTriple(sorted);
  if (cards.length === 5) return classFiveCard(sorted);
  return null; // 4-card plays are illegal in standard Big 2
}

function classSingle(sorted) {
  return { type: HAND_TYPE.SINGLE, primaryCard: sorted[0], cards: sorted };
}

function classPair(sorted) {
  if (sorted[0].rank !== sorted[1].rank) return null;
  // Primary card = the higher card (higher suit)
  return { type: HAND_TYPE.PAIR, primaryCard: sorted[1], cards: sorted };
}

function classTriple(sorted) {
  if (sorted[0].rank !== sorted[1].rank || sorted[1].rank !== sorted[2].rank) return null;
  return { type: HAND_TYPE.TRIPLE, primaryCard: sorted[2], cards: sorted };
}

function classFiveCard(sorted) {
  const isFlush = sorted.every(c => c.suit === sorted[0].suit);
  const isStraight = checkStraight(sorted);

  if (isFlush && isStraight) {
    return { type: HAND_TYPE.STRAIGHT_FLUSH, primaryCard: sorted[4], cards: sorted };
  }
  if (isFlush) {
    return { type: HAND_TYPE.FLUSH, primaryCard: sorted[4], cards: sorted };
  }
  if (isStraight) {
    return { type: HAND_TYPE.STRAIGHT, primaryCard: sorted[4], cards: sorted };
  }

  // Count frequencies
  const freq = {};
  sorted.forEach(c => { freq[c.rank] = (freq[c.rank] || 0) + 1; });
  const counts = Object.values(freq).sort((a, b) => b - a);

  if (counts[0] === 4) {
    // Quad: primaryCard = the 4-of-a-kind card (highest of the 4)
    const quadRank = Object.keys(freq).find(r => freq[r] === 4);
    const quadCards = sorted.filter(c => c.rank === quadRank);
    return { type: HAND_TYPE.QUAD, primaryCard: quadCards[3], cards: sorted };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    // Full house: primaryCard = the triple card (highest of the 3)
    const tripleRank = Object.keys(freq).find(r => freq[r] === 3);
    const tripleCards = sorted.filter(c => c.rank === tripleRank);
    return { type: HAND_TYPE.FULL_HOUSE, primaryCard: tripleCards[2], cards: sorted };
  }

  return null;
}

/**
 * Check if 5 sorted cards form a straight.
 * In Big 2, straights can wrap (A-2-3-4-5 is valid, also J-Q-K-A-2).
 * The highest straight is 10-J-Q-K-A.  2-3-4-5-6 is the lowest.
 * A-2-3-4-5 and similar wraps are NOT valid in standard rules.
 */
function checkStraight(sorted) {
  // Check consecutive rank values
  for (let i = 1; i < sorted.length; i++) {
    if (RANK_VALUE[sorted[i].rank] !== RANK_VALUE[sorted[i-1].rank] + 1) {
      return false;
    }
  }
  return true;
}

// ─── Hand Comparison ──────────────────────────────────────────────────────────

/**
 * Compare two classified hands.
 * Returns positive if `challenger` beats `current`, negative if not.
 * Returns null if they are incompatible types (illegal challenge).
 *
 * Rules:
 * - Must be the same card count.
 * - For single/pair/triple: challenger must be strictly higher.
 * - For 5-card hands: challenger type must be >= current type.
 *   If same type, compare by primaryCard.
 */
function compareHands(current, challenger) {
  if (!current || !challenger) return null;
  if (current.cards.length !== challenger.cards.length) return null;

  // Singles, pairs, triples: must match type
  if (current.cards.length < 5) {
    if (current.type !== challenger.type) return null;
    return compareCards(challenger.primaryCard, current.primaryCard);
  }

  // 5-card hands: higher type wins outright
  if (challenger.type !== current.type) {
    return challenger.type - current.type;
  }
  // Same type: compare primary card
  return compareCards(challenger.primaryCard, current.primaryCard);
}

/**
 * Check whether a play is legal given the current table state.
 *
 * @param {Card[]}       playedCards   Cards the player wants to play
 * @param {object|null}  tableHand     Current hand on the table (null = empty table / player leads)
 * @param {boolean}      mustInclude3D On the very first play of the game, must include 3♦
 * @returns {{ valid: boolean, reason?: string, hand?: object }}
 */
function validatePlay(playedCards, tableHand, mustInclude3D = false) {
  if (!playedCards || playedCards.length === 0) {
    return { valid: false, reason: 'No cards selected.' };
  }

  const hand = classifyHand(playedCards);
  if (!hand) {
    return { valid: false, reason: 'Not a valid hand combination.' };
  }

  // First play of the whole game must include 3♦
  if (mustInclude3D) {
    const has3D = playedCards.some(c => c.rank === '3' && c.suit === '♦');
    if (!has3D) {
      return { valid: false, reason: 'First play must include the 3♦.' };
    }
  }

  // If table is empty (player leads the round), any valid hand is fine
  if (!tableHand) {
    return { valid: true, hand };
  }

  // Must play same number of cards as on the table
  if (playedCards.length !== tableHand.cards.length) {
    return {
      valid: false,
      reason: `Must play ${tableHand.cards.length} card(s) to match the table.`,
    };
  }

  const result = compareHands(tableHand, hand);
  if (result === null) {
    return { valid: false, reason: 'Your hand type does not beat the current play.' };
  }
  if (result <= 0) {
    return { valid: false, reason: 'Your hand is not strong enough to beat the current play.' };
  }

  return { valid: true, hand };
}

// ─── Game State ────────────────────────────────────────────────────────────────

/**
 * Create the initial game state for a 4-player game.
 * @param {string[]} playerIds  Array of 4 player IDs
 */
function createGame(playerIds) {
  if (playerIds.length !== 4) throw new Error('Big 2 requires exactly 4 players.');

  const deck  = buildDeck();
  const hands = dealCards(deck);
  const startingPlayer = findStartingPlayer(hands);

  return {
    players: playerIds.map((id, i) => ({
      id,
      hand: hands[i],
      passed: false,
      cardCount: hands[i].length,
    })),
    currentPlayerIndex: startingPlayer,
    tableHand: null,          // last played hand on the table
    tablePlayedBy: null,      // index of the player who played it
    roundLeader: startingPlayer,
    isFirstPlay: true,        // 3♦ rule applies
    status: 'playing',        // 'playing' | 'finished'
    winner: null,
  };
}

/**
 * Apply a player's move to the game state.
 * Returns { success, reason, state } — state is only mutated on success.
 *
 * @param {object}   state        Game state (will be mutated on success)
 * @param {string}   playerId     ID of the player making the move
 * @param {Card[]|null} cards     Cards to play, or null to pass
 */
function applyMove(state, playerId, cards) {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return { success: false, reason: 'Player not found.' };
  if (playerIndex !== state.currentPlayerIndex) return { success: false, reason: 'Not your turn.' };

  const player = state.players[playerIndex];
  if (player.passed) return { success: false, reason: 'You have already passed this round.' };

  // ── Pass ──
  if (!cards || cards.length === 0) {
    // Cannot pass if you are leading (table is empty)
    if (!state.tableHand || state.tablePlayedBy === playerIndex) {
      return { success: false, reason: 'You cannot pass when leading the round.' };
    }
    player.passed = true;
    advanceTurn(state);
    return { success: true, action: 'pass' };
  }

  // ── Play cards ──
  // Verify player actually holds these cards
  const cardsToPlay = matchCardsInHand(cards, player.hand);
  if (!cardsToPlay) {
    return { success: false, reason: 'You do not hold all of those cards.' };
  }

  const validation = validatePlay(cardsToPlay, state.tableHand, state.isFirstPlay);
  if (!validation.valid) {
    return { success: false, reason: validation.reason };
  }

  // Remove cards from hand
  player.hand = removeCards(player.hand, cardsToPlay);
  player.cardCount = player.hand.length;

  // Update table
  state.tableHand     = validation.hand;
  state.tablePlayedBy = playerIndex;
  state.isFirstPlay   = false;

  // Check win condition
  if (player.hand.length === 0) {
    state.status = 'finished';
    state.winner = playerId;
    return { success: true, action: 'play', hand: validation.hand, finished: true };
  }

  advanceTurn(state);
  return { success: true, action: 'play', hand: validation.hand };
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Advance the turn to the next non-passed player.
 * If all others have passed, the last player who played leads the next round.
 */
function advanceTurn(state) {
  const n = state.players.length;

  // Check if everyone else has passed (i.e., last player to play leads next)
  const activePlayers = state.players.filter(p => !p.passed);

  // If only the table player is left un-passed, they win the round and lead next
  if (activePlayers.length === 1 && !activePlayers[0].passed) {
    startNewRound(state, state.tablePlayedBy);
    return;
  }

  // Edge: all others passed — the person who played leads fresh
  const nonPassedCount = state.players.filter(p => !p.passed).length;
  if (nonPassedCount === 1) {
    startNewRound(state, state.tablePlayedBy);
    return;
  }

  // Move to next player who hasn't passed
  let next = (state.currentPlayerIndex + 1) % n;
  while (state.players[next].passed) {
    next = (next + 1) % n;
  }
  state.currentPlayerIndex = next;
}

function startNewRound(state, leaderIndex) {
  state.tableHand    = null;
  state.tablePlayedBy = null;
  state.players.forEach(p => { p.passed = false; });
  state.currentPlayerIndex = leaderIndex;
  state.roundLeader        = leaderIndex;
}

/**
 * Match selected cards (by rank+suit) against a player's actual hand.
 * Returns the matched card objects from the hand, or null if any card is missing.
 */
function matchCardsInHand(selected, hand) {
  const handCopy = [...hand];
  const matched  = [];

  for (const sel of selected) {
    const idx = handCopy.findIndex(c => c.rank === sel.rank && c.suit === sel.suit);
    if (idx === -1) return null;
    matched.push(handCopy.splice(idx, 1)[0]);
  }
  return matched;
}

/** Return a new array with `toRemove` cards removed. */
function removeCards(hand, toRemove) {
  const copy = [...hand];
  for (const card of toRemove) {
    const idx = copy.findIndex(c => c.rank === card.rank && c.suit === card.suit);
    if (idx !== -1) copy.splice(idx, 1);
  }
  return copy;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Return the multiplier for a given number of leftover cards.
 *  1–7  → ×1 (normal)
 *  8–10 → ×2 (double)
 * 11–12 → ×3 (triple)
 *    13 → ×4 (quadruple)
 */
function cardMultiplier(cardCount) {
  if (cardCount >= 13) return 4;
  if (cardCount >= 11) return 3;
  if (cardCount >= 8)  return 2;
  return 1;
}

/**
 * Calculate the round settlement for all four players.
 *
 * Rules:
 *  - Winner pays / receives from each loser: 5 + (cards × multiplier)
 *    The winner's delta is the SUM of all three losers' payments (positive = gain).
 *  - Contra among losers: each loser's "weighted value" = cards × multiplier.
 *    For every pair of losers, the higher-value loser pays the lower-value loser
 *    the DIFFERENCE of their weighted values.
 *
 * @param {string}   winnerId
 * @param {{ id: string, cardCount: number }[]} players  All 4 players post-game.
 * @returns {{ [playerId]: number }}  Net point delta per player (positive = gained).
 */
function calculateRoundScores(winnerId, players) {
  const deltas = {};
  players.forEach(p => { deltas[p.id] = 0; });

  const losers  = players.filter(p => p.id !== winnerId);
  const winner  = players.find(p => p.id === winnerId);

  // ── Winner payment ──
  for (const loser of losers) {
    const mult    = cardMultiplier(loser.cardCount);
    const payment = 5 + loser.cardCount * mult;
    deltas[loser.id]  -= payment;
    deltas[winner.id] += payment;
  }

  // ── Contra: pairwise settlement between the 3 losers ──
  for (let i = 0; i < losers.length; i++) {
    for (let j = i + 1; j < losers.length; j++) {
      const a = losers[i];
      const b = losers[j];
      const aValue = a.cardCount * cardMultiplier(a.cardCount);
      const bValue = b.cardCount * cardMultiplier(b.cardCount);
      const diff   = aValue - bValue;

      if (diff > 0) {
        // A has higher weighted value → A pays B
        deltas[a.id] -= diff;
        deltas[b.id] += diff;
      } else if (diff < 0) {
        // B has higher weighted value → B pays A
        deltas[b.id] -= Math.abs(diff);
        deltas[a.id] += Math.abs(diff);
      }
      // diff === 0 → no payment between this pair
    }
  }

  return deltas;
}

// ─── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  // Card utilities
  makeCard,
  cardValue,
  compareCards,
  sortCards,
  buildDeck,
  dealCards,
  findStartingPlayer,

  // Hand logic
  classifyHand,
  compareHands,
  validatePlay,

  // Game lifecycle
  createGame,
  applyMove,

  // Scoring
  cardMultiplier,
  calculateRoundScores,

  // Constants (useful for client-side display)
  RANKS,
  SUITS,
  HAND_TYPE,
};
