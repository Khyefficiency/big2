'use strict';

function ensurePausedSet(room) {
  if (!(room.pausedBy instanceof Set)) room.pausedBy = new Set(room.pausedBy || []);
  return room.pausedBy;
}

function pauseRoomForDisconnect(room, socketId) {
  const player = room.players.find(p => p.id === socketId);
  if (!player) return null;

  player.disconnected = true;

  if ((room.status === 'playing' || room.status === 'paused') && room.game) {
    room.status = 'paused';
    ensurePausedSet(room).add(socketId);
  }

  return { player };
}

function restoreRoomAfterReconnect(room, oldId, newId) {
  const player = room.players.find(p => p.id === oldId);
  if (!player) return null;

  const pausedBy = ensurePausedSet(room);
  pausedBy.delete(oldId);

  player.id = newId;
  player.disconnected = false;

  if (room.game) {
    const gamePlayer = room.game.players.find(p => p.id === oldId);
    if (gamePlayer) gamePlayer.id = newId;
  }

  if (room.scores[oldId] !== undefined) {
    room.scores[newId] = room.scores[oldId];
    delete room.scores[oldId];
  }

  if (room.status === 'paused' && pausedBy.size === 0) {
    room.status = 'playing';
  }

  return { player };
}

function cancelPausedGame(room) {
  room.status = 'waiting';
  room.game = null;
  ensurePausedSet(room).clear();
  room.players.forEach(player => {
    player.disconnected = false;
  });
}

function markLobbyDisconnect(room, socketId) {
  const player = room.players.find(p => p.id === socketId);
  if (!player) return null;
  player.disconnected = true;
  return { player };
}

function removePlayerFromRoom(room, socketId) {
  const idx = room.players.findIndex(p => p.id === socketId);
  if (idx === -1) return null;

  const [player] = room.players.splice(idx, 1);
  delete room.scores[socketId];
  room.players.forEach((p, i) => { p.seatIndex = i; });

  return { player };
}

module.exports = {
  pauseRoomForDisconnect,
  restoreRoomAfterReconnect,
  cancelPausedGame,
  markLobbyDisconnect,
  removePlayerFromRoom,
};
