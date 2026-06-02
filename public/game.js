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
  handOrder:    [],    // user-defined card order (array of cardKeys)
  intentionalDisconnect: false,
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
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3200);
}

// ── Card helpers ───────────────────────────────────────────────────────────────
const RED_SUITS = new Set(['♥', '♦']);
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = ['♦','♣','♥','♠'];
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, i) => [rank, i]));
const SUIT_VALUE = Object.fromEntries(SUITS.map((suit, i) => [suit, i]));

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
    // Use pointerup so we can distinguish tap from drag
    let _tapStartX = 0, _tapStartY = 0;
    el.addEventListener('pointerdown', e => { _tapStartX = e.clientX; _tapStartY = e.clientY; });
    el.addEventListener('pointerup',   e => {
      const dx = Math.abs(e.clientX - _tapStartX);
      const dy = Math.abs(e.clientY - _tapStartY);
      if (dx < 8 && dy < 8) toggleCard(card, el); // only select if it was a tap, not a drag
    });
  }
  return el;
}

function cardKey(card) { return `${card.rank}${card.suit}`; }
function cardSortValue(card) { return RANK_VALUE[card.rank] * 4 + SUIT_VALUE[card.suit]; }

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

  namEl.textContent = gPlayer.isBot ? `🤖 ${gPlayer.name}` : gPlayer.name;
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

  if (gPlayer.disconnected) {
    badgeEl.textContent = 'OFFLINE';
    badgeEl.className   = 'opp-badge passed';
  } else if (gPlayer.seatIndex === activeIdx) {
    badgeEl.textContent = gPlayer.isBot ? '🤖 Thinking…' : '▶ Their turn';
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

  const typeNames = {
    1: 'Single', 2: 'Pair', 3: 'Triple',
    4: 'Straight', 5: 'Flush', 6: 'Full House',
    7: 'Four of a Kind', 8: 'Straight Flush',
  };
  labelEl.textContent = typeNames[g.tableHand.type] || '';

  g.tableHand.cards.forEach(card => {
    cardsEl.appendChild(makeCardEl(card, { small: true }));
  });

  const player = g.players.find(p => p.seatIndex === g.tablePlayedBy);
  if (player) {
    playedByEl.textContent = `played by ${player.isBot ? '🤖 ' : ''}${player.name}`;
  }
}

function renderMyHand(myHand) {
  const handEl = document.getElementById('my-hand');
  handEl.innerHTML = '';

  const handKeys = new Set(myHand.map(cardKey));
  S.selectedCards = S.selectedCards.filter(c => handKeys.has(cardKey(c)));

  // Merge handOrder: keep existing order for cards still in hand, append new ones at end
  S.handOrder = S.handOrder.filter(k => handKeys.has(k));
  myHand.forEach(c => {
    if (!S.handOrder.includes(cardKey(c))) S.handOrder.push(cardKey(c));
  });

  // Build a lookup for fast access
  const cardMap = Object.fromEntries(myHand.map(c => [cardKey(c), c]));
  const selectedKeys = new Set(S.selectedCards.map(cardKey));

  S.handOrder.forEach((key, idx) => {
    const card = cardMap[key];
    if (!card) return;
    const el = makeCardEl(card, {
      selectable: true,
      selected:   selectedKeys.has(key),
    });
    el.dataset.cardKey = key;
    el.dataset.idx     = idx;
    addDragToReorder(el, handEl);
    handEl.appendChild(el);
  });
}

function applyHandOrder(cards) {
  S.handOrder = cards.map(cardKey);
  S.selectedCards = [];
  renderMyHand(S.gameState?.myHand || []);
  updateActionBar();
}

function sortHand(mode) {
  const hand = [...(S.gameState?.myHand || [])];
  if (hand.length === 0) return;

  const rankCounts = hand.reduce((counts, card) => {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
    return counts;
  }, {});

  if (mode === 'suit') {
    hand.sort((a, b) => SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit] || RANK_VALUE[a.rank] - RANK_VALUE[b.rank]);
  } else if (mode === 'pairs') {
    hand.sort((a, b) =>
      rankCounts[b.rank] - rankCounts[a.rank] ||
      RANK_VALUE[a.rank] - RANK_VALUE[b.rank] ||
      SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit]
    );
  } else if (mode === 'combos') {
    hand.sort((a, b) =>
      SUIT_VALUE[a.suit] - SUIT_VALUE[b.suit] ||
      RANK_VALUE[a.rank] - RANK_VALUE[b.rank] ||
      cardSortValue(a) - cardSortValue(b)
    );
  } else {
    hand.sort((a, b) => cardSortValue(a) - cardSortValue(b));
  }

  applyHandOrder(hand);
}

// ── Drag-to-reorder (mouse + touch) ────────────────────────────────────────────
function addDragToReorder(el, container) {
  let dragKey   = null;
  let startX    = 0;
  let origIdx   = 0;
  let isDragging = false;
  let clone      = null;
  let startScrollLeft = 0;

  function onStart(clientX) {
    dragKey  = el.dataset.cardKey;
    origIdx  = S.handOrder.indexOf(dragKey);
    startX   = clientX;
    isDragging = false;
    startScrollLeft = container.scrollLeft || 0;
  }

  function onMove(clientX) {
    const dx = Math.abs(clientX - startX);
    if (!isDragging && dx < 6) return; // ignore tiny taps

    if (!isDragging) {
      isDragging = true;
      el.classList.add('dragging');
    }

    // Figure out which position the drag is over
    const cards    = Array.from(container.querySelectorAll('.card[data-card-key]'));
    const rect     = container.getBoundingClientRect();
    const relX     = clientX - rect.left + (container.scrollLeft || 0);
    let   newIdx   = origIdx;

    for (let i = 0; i < cards.length; i++) {
      const r  = cards[i].getBoundingClientRect();
      const cx = r.left + r.width / 2 - rect.left + (container.scrollLeft || 0);
      if (relX > cx) newIdx = i;
    }

    if (newIdx !== S.handOrder.indexOf(dragKey)) {
      const cur = S.handOrder.indexOf(dragKey);
      S.handOrder.splice(cur, 1);
      S.handOrder.splice(newIdx, 0, dragKey);
      renderMyHand(S.gameState?.myHand || []);
    }
  }

  function onEnd() {
    if (isDragging) {
      el.classList.remove('dragging');
      isDragging = false;
    }
  }

  // Mouse
  el.addEventListener('mousedown', e => {
    if (!isMyTurn() && S.gameState) return; // allow reorder any time actually
    onStart(e.clientX);
    const mm = e2 => onMove(e2.clientX);
    const mu = () => { onEnd(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  });

  // Touch
  el.addEventListener('touchstart', e => {
    onStart(e.touches[0].clientX);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    onMove(e.touches[0].clientX);
    if (isDragging) e.preventDefault(); // prevent page scroll while dragging card
  }, { passive: false });

  el.addEventListener('touchend', () => onEnd());
}

function renderScoreBar() {
  const el = document.getElementById('score-bar');
  el.innerHTML = '';
  if (!S.gameState) return;
  S.gameState.players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'score-item';
    const score = S.totalScores[p.name];
    const scoreStr = score === undefined ? '—' : (score >= 0 ? '+' : '') + score;
    item.innerHTML = `<span class="score-name">${p.isBot ? '🤖 ' : ''}${p.name}</span><span class="score-val">${scoreStr}</span>`;
    el.appendChild(item);
  });
}

function updateActionBar() {
  const btnPlay  = document.getElementById('btn-play');
  const btnPass  = document.getElementById('btn-pass');
  const btnCancel = document.getElementById('btn-cancel-paused');
  const countEl  = document.getElementById('play-count');
  const msgEl    = document.getElementById('turn-msg');
  const myTurn   = isMyTurn();
  const isPaused = S.gameState?.status === 'paused';

  countEl.textContent = S.selectedCards.length;
  btnPlay.disabled = isPaused || !myTurn || S.selectedCards.length === 0;
  btnPass.disabled = isPaused || !myTurn || isLeading();
  btnCancel.classList.toggle('hidden', !isPaused);

  if (!S.gameState || S.gameState.status !== 'playing') {
    msgEl.textContent = isPaused ? 'Game paused — waiting for reconnect' : '';
    msgEl.className   = isPaused ? 'turn-msg others-turn' : 'turn-msg';
    return;
  }

  if (myTurn) {
    const leading = isLeading();
    msgEl.textContent = leading ? '🟢 Your turn — lead the round' : '🟢 Your turn';
    msgEl.className   = 'turn-msg your-turn';
  } else {
    const curr = S.gameState.players[S.gameState.currentPlayerIndex];
    const currName = curr ? (curr.isBot ? `🤖 ${curr.name}` : curr.name) : '';
    msgEl.textContent = currName ? `Waiting for ${currName}…` : 'Waiting…';
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

function leaveRoom() {
  S.socket.emit('room:leave', {}, (res) => {
    if (res?.error) return toast(res.error, 'error');
    S.gameState   = null;
    S.totalScores = {};
    S.isHost      = false;
    S.roomCode    = '';
    S.name        = '';
    S.seatIndex   = -1;
    S.handOrder   = [];
    S.selectedCards = [];
    clearSession();
    showScreen('screen-landing');
    S.intentionalDisconnect = true;
    S.socket.disconnect();
    connect();
  });
}

// ── Game Over Screen ───────────────────────────────────────────────────────────
function showGameOver(data) {
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
    if (player) {
      const isBot = player.isBot;
      const isOffline = player.disconnected;
      row.innerHTML = `
        <div class="seat-num">${i + 1}</div>
        <div class="seat-name">${isBot ? '🤖 ' : ''}${player.name}</div>
        ${isOffline ? '<div class="bot-tag">OFFLINE</div>' : (i === 0 ? '<div class="host-tag">HOST</div>' : (isBot ? '<div class="bot-tag">BOT</div>' : ''))}`;
    } else {
      row.innerHTML = `
        <div class="seat-num">${i + 1}</div>
        <div class="seat-name" style="color:var(--muted)">Waiting…</div>`;
    }
    container.appendChild(row);
  }

  const count = state.players.length;
  document.getElementById('lobby-status').textContent =
    count === 4 ? 'All players ready!' : `Waiting for players… (${count}/4)`;

  const btnStart    = document.getElementById('btn-start');
  const hostHint    = document.getElementById('lobby-host-hint');
  const botControls = document.getElementById('lobby-bot-controls');
  const btnAddBot   = document.getElementById('btn-add-bot');
  const btnRemBot   = document.getElementById('btn-remove-bot');

  btnStart.disabled = count < 4 || !S.isHost;
  hostHint.classList.toggle('hidden', S.isHost || count >= 4);

  // Bot controls — only visible to host when there's room
  if (S.isHost) {
    botControls.classList.remove('hidden');
    btnAddBot.classList.toggle('hidden', count >= 4);
    const hasBots = state.players.some(p => p.isBot);
    btnRemBot.classList.toggle('hidden', !hasBots);
  } else {
    botControls.classList.add('hidden');
  }
}

// ── Socket setup ───────────────────────────────────────────────────────────────
function saveSession() {
  if (S.roomCode && S.name) {
    sessionStorage.setItem('big2_room', S.roomCode);
    sessionStorage.setItem('big2_name', S.name);
    sessionStorage.setItem('big2_seat', S.seatIndex);
    sessionStorage.setItem('big2_host', S.isHost ? '1' : '0');
  }
}

function loadSession() {
  S.roomCode  = sessionStorage.getItem('big2_room') || '';
  S.name      = sessionStorage.getItem('big2_name') || '';
  S.seatIndex = parseInt(sessionStorage.getItem('big2_seat') ?? '-1', 10);
  S.isHost    = sessionStorage.getItem('big2_host') === '1';
}

function clearSession() {
  sessionStorage.removeItem('big2_room');
  sessionStorage.removeItem('big2_name');
  sessionStorage.removeItem('big2_seat');
  sessionStorage.removeItem('big2_host');
}

function connect() {
  S.socket = io({
    reconnectionDelay:    500,
    reconnectionDelayMax: 3000,
    reconnectionAttempts: Infinity,  // keep trying indefinitely
    timeout:              10000,
  });

  S.socket.on('connect', () => {
    S.intentionalDisconnect = false;
    console.log('socket connected:', S.socket.id);

    // Try to restore from memory first, then fall back to sessionStorage
    if (!S.roomCode || !S.name) loadSession();

    if (S.roomCode && S.name) {
      toast('Reconnecting…', 'info');
      S.socket.emit('room:reconnect', { code: S.roomCode, name: S.name }, (res) => {
        if (res?.error) {
          // Room may have expired — go back to landing but keep name pre-filled
          clearSession();
          document.getElementById('input-name').value = S.name;
          showScreen('screen-landing');
          toast('Session expired. Please rejoin.', 'error');
        } else {
          S.seatIndex = res.seatIndex;
          S.isHost    = res.isHost;
          saveSession();
          toast('Reconnected!', 'success');
          if (res.roomStatus === 'playing' || res.roomStatus === 'paused') showScreen('screen-game');
          else showScreen('screen-lobby');
        }
      });
    }
  });

  S.socket.on('disconnect', () => {
    if (S.intentionalDisconnect) return;
    toast('Connection lost — reconnecting…', 'error');
  });

  S.socket.on('room:update', (state) => {
    renderLobby(state);
  });

  S.socket.on('room:player_left', ({ roomState }) => {
    renderLobby(roomState);
    toast('A player left the room.', 'error');
  });

  S.socket.on('room:player_dropped', ({ name }) => {
    toast(`${name} dropped — game paused.`, 'error');
  });

  S.socket.on('room:player_reconnected', ({ name }) => {
    toast(`${name} reconnected.`, 'success');
  });

  S.socket.on('game:started', () => {
    S.selectedCards = [];
    S.handOrder     = [];
    showScreen('screen-game');
  });

  S.socket.on('game:state', (state) => {
    S.gameState = state;
    S.seatIndex = state.mySeatIndex;
    renderGame();
  });

  S.socket.on('round:won', ({ winnerName, winnerSeat }) => {
    const isMe = winnerSeat === S.seatIndex;
    toast(isMe ? '🏅 You won the round — you lead next!' : `${winnerName} won the round`, isMe ? 'success' : 'info');
  });

  S.socket.on('game:over', (data) => {
    showGameOver(data);
  });

  S.socket.on('game:paused', ({ name }) => {
    toast(`${name} disconnected. Game paused.`, 'error');
  });

  S.socket.on('game:cancelled', ({ reason }) => {
    toast(reason, 'error');
    S.gameState = null;
    S.selectedCards = [];
    S.handOrder = [];
    showScreen('screen-lobby');
  });

  S.socket.on('game:aborted', ({ reason }) => {
    toast(reason, 'error');
    S.gameState = null;
    showScreen('screen-lobby');
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
      saveSession();
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
      saveSession();
      if (res.rejoined) showScreen('screen-game');
      else showScreen('screen-lobby');
    });
  });

  // Enter key shortcuts
  document.getElementById('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
  document.getElementById('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });

  // Start game
  document.getElementById('btn-start').addEventListener('click', () => {
    S.socket.emit('game:start', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Add bot
  document.getElementById('btn-add-bot').addEventListener('click', () => {
    S.socket.emit('room:add_bot', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Remove bot
  document.getElementById('btn-remove-bot').addEventListener('click', () => {
    S.socket.emit('room:remove_bot', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Leave lobby
  document.getElementById('btn-lobby-leave').addEventListener('click', leaveRoom);

  document.getElementById('sort-rank').addEventListener('click', () => sortHand('rank'));
  document.getElementById('sort-suit').addEventListener('click', () => sortHand('suit'));
  document.getElementById('sort-pairs').addEventListener('click', () => sortHand('pairs'));
  document.getElementById('sort-combos').addEventListener('click', () => sortHand('combos'));

  // Play
  document.getElementById('btn-play').addEventListener('click', playCards);

  // Pass
  document.getElementById('btn-pass').addEventListener('click', passRound);

  // Cancel a paused game without awarding points
  document.getElementById('btn-cancel-paused').addEventListener('click', () => {
    S.socket.emit('game:cancel_paused', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Rematch
  document.getElementById('btn-rematch').addEventListener('click', () => {
    S.socket.emit('game:rematch', {}, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
  });

  // Leave
  document.getElementById('btn-leave').addEventListener('click', leaveRoom);
}

document.addEventListener('DOMContentLoaded', init);
