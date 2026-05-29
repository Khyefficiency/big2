'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
const S = {
  socket:       null,
  name:         '',
  roomCode:     '',
  seatIndex:    -1,
  isHost:       false,
  selectedCards: [],   // [{rank, suit}]
  gameState:    null,  // latest from server
  totalScores:  {},    // { name: number } updated after each round
};

// ── Screens ────────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 2600);
}

// ── Card helpers ───────────────────────────────────────────────────────────────
const RED_SUITS = new Set(['♥', '♦']);

function makeCardEl(card, opts = {}) {
  const { selectable = false, selected = false, small = false } = opts;
  const isRed = RED_SUITS.has(card.suit);

  const el = document.createElement('div');
  el.className = ['card', isRed ? 'red' : 'black', selectable ? 'selectable' : '', selected ? 'selected' : ''].filter(Boolean).join(' ');
  if (small) el.style.cssText = '--card-w:44px;--card-h:62px;--card-rad:5px;';

  el.innerHTML = `
    <div class="corner top-left">
      <span class="rank">${card.rank}</span>
      <span class="suit">${card.suit}</span>
    </div>
    <span class="center-suit">${card.suit}</span>
    <div class="corner bot">
      <span class="rank">${card.rank}</span>
      <span class="suit">${card.suit}</span>
    </div>`;

  if (selectable) {
    el.addEventListener('click', () => toggleCard(card, el));
  }
  return el;
}

function cardKey(card) { return `${card.rank}${card.suit}`; }

function toggleCard(card, el) {
  if (!isMyTurn()) return;
  const key = cardKey(card);
  const idx = S.selectedCards.findIndex(c => cardKey(c) === key);
  if (idx === -1) {
    S.selectedCards.push(card);
    el.classList.add('selected');
  } else {
    S.selectedCards.splice(idx, 1);
    el.classList.remove('selected');
  }
  updateActionBar();
}

function isMyTurn() {
  const g = S.gameState;
  return g && g.status === 'playing' && g.currentPlayerIndex === S.seatIndex;
}

function isLeading() {
  const g = S.gameState;
  return g && (!g.tableHand || g.tablePlayedBy === S.seatIndex);
}

// ── Render helpers ─────────────────────────────────────────────────────────────

/** Returns [relRight, relTop, relLeft] seat indices for the 3 opponents. */
function opponentLayout(mySeat) {
  return [
    (mySeat + 1) % 4,   // right
    (mySeat + 2) % 4,   // top
    (mySeat + 3) % 4,   // left
  ];
}

function renderOpponent(gPlayer, position, activeIdx) {
  const namEl   = document.getElementById(`opp-${position}-name`);
  const cardsEl = document.getElementById(`opp-${position}-cards`);
  const badgeEl = document.getElementById(`opp-${position}-badge`);
  const inner   = document.getElementById(`opp-${position}`).querySelector('.opp-inner');

  if (!gPlayer) {
    namEl.textContent   = '—';
    cardsEl.innerHTML   = '';
    badgeEl.textContent = '';
    inner.classList.remove('active-turn');
    return;
  }

  namEl.textContent = gPlayer.name;
  inner.classList.toggle('active-turn', gPlayer.seatIndex === activeIdx);

  // Card backs
  cardsEl.innerHTML = '';
  const count = gPlayer.cardCount;
  const show  = Math.min(count, 10);
  for (let i = 0; i < show; i++) {
    const b = document.createElement('div');
    b.className = 'card-back';
    cardsEl.appendChild(b);
  }
  if (count > show) {
    const more = document.createElement('span');
    more.style.cssText = 'font-size:.75rem;color:var(--muted);align-self:center;';
    more.textContent = `+${count - show}`;
    cardsEl.appendChild(more);
  }

  if (gPlayer.seatIndex === activeIdx) {
    badgeEl.textContent = '▶ Their turn';
    badgeEl.className   = 'opp-badge active';
  } else if (gPlayer.passed) {
    badgeEl.textContent = 'PASSED';
    badgeEl.className   = 'opp-badge passed';
  } else {
    badgeEl.textContent = `${count} card${count !== 1 ? 's' : ''}`;
    badgeEl.className   = 'opp-badge';
  }
}

function renderTable(g) {
  const labelEl    = document.getElementById('table-label');
  const cardsEl    = document.getElementById('table-cards');
  const playedByEl = document.getElementById('table-played-by');

  cardsEl.innerHTML = '';

  if (!g.tableHand) {
    labelEl.textContent    = g.isFirstPlay ? 'Play 3♦ to start' : 'Lead the round';
    playedByEl.textContent = '';
    return;
  }

  // Hand type label
  const typeNames = {
    1: 'Single', 2: 'Pair', 3: 'Triple',
    4: 'Straight', 5: 'Flush', 6: 'Full House',
    7: 'Four of a Kind', 8: 'Straight Flush',
  };
  labelEl.textContent = typeNames[g.tableHand.type] || '';

  // Cards
  g.tableHand.cards.forEach(card => {
    cardsEl.appendChild(makeCardEl(card, { small: true }));
  });

  const player = g.players.find(p => p.seatIndex === g.tablePlayedBy);
  if (player) {
    playedByEl.textContent = `played by ${player.name}`;
  }
}

function renderMyHand(myHand) {
  const handEl = document.getElementById('my-hand');
  handEl.innerHTML = '';

  // Keep prior selections that still exist in hand
  const handKeys = new Set(myHand.map(cardKey));
  S.selectedCards = S.selectedCards.filter(c => handKeys.has(cardKey(c)));
  const selectedKeys = new Set(S.selectedCards.map(cardKey));

  myHand.forEach(card => {
    const el = makeCardEl(card, {
      selectable: true,
      selected:   selectedKeys.has(cardKey(card)),
    });
    handEl.appendChild(el);
  });
}

function renderScoreBar() {
  const el = document.getElementById('score-bar');
  el.innerHTML = '';
  if (!S.gameState) return;
  S.gameState.players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'score-item';
    const score = S.totalScores[p.name] ?? 0;
    item.innerHTML = `<span class="score-name">${p.name}</span><span class="score-val">${score >= 0 ? '+' : ''}${score}</span>`;
    el.appendChild(item);
  });
}

function updateActionBar() {
  const btnPlay  = document.getElementById('btn-play');
  const btnPass  = document.getElementById('btn-pass');
  const countEl  = document.getElementById('play-count');
  const msgEl    = document.getElementById('turn-msg');
  const myTurn   = isMyTurn();

  countEl.textContent = S.selectedCards.length;
  btnPlay.disabled = !myTurn || S.selectedCards.length === 0;
  btnPass.disabled = !myTurn || isLeading();

  if (!S.gameState || S.gameState.status !== 'playing') {
    msgEl.textContent = '';
    msgEl.className   = 'turn-msg';
    return;
  }

  if (myTurn) {
    const leading = isLeading();
    msgEl.textContent = leading ? '🟢 Your turn — lead the round' : '🟢 Your turn';
    msgEl.className   = 'turn-msg your-turn';
  } else {
    const curr = S.gameState.players[S.gameState.currentPlayerIndex];
    msgEl.textContent = curr ? `Waiting for ${curr.name}…` : 'Waiting…';
    msgEl.className   = 'turn-msg others-turn';
  }
}

function renderGame() {
  const g = S.gameState;
  if (!g) return;

  const [rightSeat, topSeat, leftSeat] = opponentLayout(S.seatIndex);

  const findPlayer = seat => g.players.find(p => p.seatIndex === seat) ?? null;

  renderOpponent(findPlayer(rightSeat), 'right', g.currentPlayerIndex);
  renderOpponent(findPlayer(topSeat),   'top',   g.currentPlayerIndex);
  renderOpponent(findPlayer(leftSeat),  'left',  g.currentPlayerIndex);
  renderTable(g);
  renderMyHand(g.myHand);
  updateActionBar();
  renderScoreBar();
}

// ── Actions ────────────────────────────────────────────────────────────────────
function playCards() {
  if (!isMyTurn() || S.selectedCards.length === 0) return;
  S.socket.emit('game:play', { cards: S.selectedCards }, (res) => {
    if (res?.error) toast(res.error, 'error');
    else S.selectedCards = [];
  });
}

function passRound() {
  if (!isMyTurn()) return;
  S.socket.emit('game:pass', {}, (res) => {
    if (res?.error) toast(res.error, 'error');
  });
}

// ── Game Over Screen ───────────────────────────────────────────────────────────
function showGameOver(data) {
  // Update running totals from breakdown
  if (data.breakdown) {
    data.breakdown.forEach(row => {
      S.totalScores[row.name] = row.totalScore;
    });
  }

  const banner = document.getElementById('winner-banner');
  banner.textContent = `🏆 ${data.winner} wins!`;

  const tbody = document.getElementById('score-tbody');
  tbody.innerHTML = '';

  (data.breakdown || []).forEach(row => {
    const tr = document.createElement('tr');
    if (row.isWinner) tr.className = 'winner-row';
    const deltaClass = row.roundDelta >= 0 ? 'delta-pos' : 'delta-neg';
    tr.innerHTML = `
      <td>${row.isWinner ? '🏆 ' : ''}${row.name}</td>
      <td>${row.isWinner ? '—' : row.cardCount}</td>
      <td class="${deltaClass}">${row.roundDelta >= 0 ? '+' : ''}${row.roundDelta}</td>
      <td>${row.totalScore >= 0 ? '+' : ''}${row.totalScore}</td>`;
    tbody.appendChild(tr);
  });

  // Show rematch only to host
  const btnRematch = document.getElementById('btn-rematch');
  btnRematch.classList.toggle('hidden', !S.isHost);

  showScreen('screen-gameover');
}

// ── Lobby renderer ─────────────────────────────────────────────────────────────
function renderLobby(state) {
  document.getElementById('lobby-code').textContent = state.code;
  const container = document.getElementById('lobby-players');
  container.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'lobby-player-row';
    const player = state.players.find(p => p.seatIndex === i);
    row.innerHTML = player
      ? `<div class="seat-num">${i + 1}</div>
         <div class="seat-name">${player.name}</div>
         ${i === 0 ? '<div class="host-tag">HOST</div>' : ''}`
      : `<div class="seat-num">${i + 1}</div>
         <div class="seat-name" style="color:var(--muted)">Waiting…</div>`;
    container.appendChild(row);
  }

  const count = state.players.length;
  document.getElementById('lobby-status').textContent = `Waiting for players… (${count}/4)`;

  const btnStart  = document.getElementById('btn-start');
  const hostHint  = document.getElementById('lobby-host-hint');
  btnStart.disabled = count < 4 || !S.isHost;
  hostHint.classList.toggle('hidden', S.isHost || count >= 4);
}

// ── Socket setup ───────────────────────────────────────────────────────────────
function connect() {
  S.socket = io();

  S.socket.on('connect', () => console.log('socket connected'));

  S.socket.on('room:update', (state) => {
    renderLobby(state);
    if (S.isHost) renderLobby(state); // re-render for host too
  });

  S.socket.on('room:player_left', ({ roomState }) => {
    renderLobby(roomState);
    toast('A player left the room.', 'error');
  });

  S.socket.on('game:started', () => {
    S.selectedCards = [];
    showScreen('screen-game');
  });

  S.socket.on('game:state', (state) => {
    S.gameState = state;
    S.seatIndex = state.mySeatIndex;
    renderGame();
  });

  S.socket.on('game:over', (data) => {
    showGameOver(data);
  });

  S.socket.on('game:aborted', ({ reason }) => {
    toast(reason, 'error');
    S.gameState = null;
    showScreen('screen-lobby');
  });

  S.socket.on('disconnect', () => {
    toast('Disconnected from server.', 'error');
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
function init() {
  connect();

  // Create room
  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return toast('Enter your name first.', 'error');
    S.name = name;
    S.socket.emit('room:create', { name }, (res) => {
      if (res.error) return toast(res.error, 'error');
      S.roomCode  = res.code;
      S.seatIndex = res.seatIndex;
      S.isHost    = true;
      showScreen('screen-lobby');
    });
  });

  // Join room
  document.getElementById('btn-join').addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    const code = document.getElementById('input-code').value.trim().toUpperCase();
    if (!name) return toast('Enter your name first.', 'error');
    if (code.length !== 4) return toast('Enter a 4-character room code.', 'error');
    S.name = name;
    S.socket.emit('room:join', { name, code }, (res) => {
      if (res.error) return toast(res.error, 'error');
      S.roomCode  = res.code;
      S.seatIndex = res.seatIndex;
      S.isHost    = false;
      showScreen('screen-lobby');
    });
  });

  // Allow Enter key on code input
  document.getElementById('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
  document.getElementById('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });

  // Start game (host)
  document.getElementById('btn-start').addEventListener('click', () => {
    S.socket.emit('game:start', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Play
  document.getElementById('btn-play').addEventListener('click', playCards);

  // Pass
  document.getElementById('btn-pass').addEventListener('click', passRound);

  // Rematch
  document.getElementById('btn-rematch').addEventListener('click', () => {
    S.socket.emit('game:rematch', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Leave
  document.getElementById('btn-leave').addEventListener('click', () => {
    S.gameState   = null;
    S.totalScores = {};
    S.isHost      = false;
    S.roomCode    = '';
    S.seatIndex   = -1;
    showScreen('screen-landing');
    // Reconnect so the old socket drops and a clean one connects on next action
    S.socket.disconnect();
    connect();
  });
}

document.addEventListener('DOMContentLoaded', init);
