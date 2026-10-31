// network.js

import { EVENTS } from "./events.js";

const socket = window.io();

function record() {
  if (window.saveMapSnapshot) window.saveMapSnapshot();
}

// ---- EMITTERS (Client -> Server) ----

export function setReady(isReady) {
  socket.emit(EVENTS.SET_READY, isReady);
}

export function voteFinish(vote) {
  socket.emit(EVENTS.VOTE_FINISH, vote);
}

export function sendChat(message) {
  socket.emit(EVENTS.SEND_CHAT, message);
}

// Unified Objects
export function createObject(objectData) {
  record();
  socket.emit(EVENTS.CREATE_OBJECT, objectData);
}

export function createObjectsBatch(batchData) {
  record();
  socket.emit(EVENTS.CREATE_OBJECTS_BATCH, batchData);
}

export function updateObjectsBatch(payloads) {
  record();
  socket.emit(EVENTS.UPDATE_OBJECTS_BATCH, payloads); 
}

export function deleteObject(objectId) {
  record();
  socket.emit(EVENTS.DELETE_OBJECT, objectId);
}

export function reorderObjects({ ids, toBack }) {
  record();
  socket.emit(EVENTS.REORDER_OBJECTS, { ids, toBack });
}

export function updateObject(payload) {
  record();
  socket.emit(EVENTS.UPDATE_OBJECT, payload);
}

export function pasteLines(pasteData) {
  record();
  socket.emit(EVENTS.PASTE_LINES, pasteData);
}

// Map Objects
export function setSpawnCircle(data) {
  if (window.saveMapSnapshot) window.saveMapSnapshot();
  socket.emit(EVENTS.SET_SPAWN_CIRCLE, data);
}

export function setCapZone(data) {
  if (window.saveMapSnapshot) window.saveMapSnapshot();
  socket.emit(EVENTS.SET_CAP_ZONE, data);
}

export function setMapSize(size) {
  socket.emit(EVENTS.SET_MAP_SIZE, size);
}

// Admin Emitters
export function adminLogin(password) {
  socket.emit(EVENTS.ADMIN_LOGIN, password);
}

export function adminKickPlayer(playerId) {
  socket.emit(EVENTS.ADMIN_KICK_PLAYER, playerId);
}

export function adminSetPassword(newPassword) {
  socket.emit(EVENTS.ADMIN_SET_PASSWORD, newPassword);
}

export function adminEndGame() {
  socket.emit(EVENTS.ADMIN_END_GAME);
}

// Modified Emitters
export function joinLobby(name, password) {
  socket.emit(EVENTS.JOIN_LOBBY, { name, password });
}

export function changeColors() {
  socket.emit(EVENTS.CHANGE_COLORS);
}

// ---- LISTENERS (Server -> Client) ----

export function onConnectWithId(cb) {
  socket.on(EVENTS.CONNECT_WITH_ID, cb);
}

export function onLobbyFull(cb) {
  socket.on(EVENTS.LOBBY_FULL, cb);
}

export function onLobbyNameTaken(cb) {
  socket.on(EVENTS.LOBBY_NAME_TAKEN, cb);
}

export function onGameInProgress(cb) {
  socket.on(EVENTS.GAME_IN_PROGRESS, cb);
}

export function onLobbyUpdate(cb) {
  socket.on(EVENTS.LOBBY_UPDATE, cb);
}

export function onStartGame(cb) {
  socket.on(EVENTS.START_GAME, cb);
}

export function onGameSnapshot(cb) {
  socket.on(EVENTS.GAME_SNAPSHOT, cb);
}

export function onEndGame(cb) {
  socket.on(EVENTS.END_GAME, cb);
}

export function onGameUpdate(cb) {
  socket.on(EVENTS.GAME_UPDATE, cb);
}

// Unified Objects
export function onObjectCreated(cb) {
  socket.on(EVENTS.OBJECT_CREATED, cb);
}

export function onObjectsCreatedBatch(cb) {
  socket.on(EVENTS.OBJECTS_CREATED_BATCH, cb);
}

export function onObjectUpdated(cb) {
  socket.on(EVENTS.OBJECT_UPDATED, cb);
}

export function onObjectDeleted(cb) {
  socket.on(EVENTS.OBJECT_DELETED, cb);
}

export function onObjectsReordered(cb) {
  socket.on(EVENTS.OBJECTS_REORDERED, cb);
}

// Map Objects
export function onSpawnCircleUpdate(cb) {
  socket.on(EVENTS.SPAWN_CIRCLE_UPDATED, cb);
}

export function onCapZoneUpdate(cb) {
  socket.on(EVENTS.CAP_ZONE_UPDATED, cb);
}

export function onMapSizeUpdate(cb) {
  socket.on(EVENTS.MAP_SIZE_UPDATED, cb);
}

// Chat
export function onChatMessage(cb) {
  socket.on(EVENTS.CHAT_MESSAGE, cb);
}

export function onChatError(cb) {
  socket.on(EVENTS.CHAT_ERROR, cb);
}

export function onClearChat(cb) {
  socket.on(EVENTS.CLEAR_CHAT, cb);
}

// Admin Listeners
export function onKicked(cb) {
  socket.on(EVENTS.KICKED, cb);
}

export function onLobbyJoinFail(cb) {
  socket.on(EVENTS.LOBBY_JOIN_FAIL, cb);
}

export function onAdminStateUpdate(cb) {
  socket.on(EVENTS.ADMIN_STATE_UPDATE, cb);
}

export function onAdminLoginSuccess(cb) {
  socket.on(EVENTS.ADMIN_LOGIN_SUCCESS, cb);
}

export function onAdminLoginFail(cb) {
  socket.on(EVENTS.ADMIN_LOGIN_FAIL, cb);
}
export function onColorsUpdated(cb) {
  socket.on(EVENTS.COLORS_UPDATED, cb);
}
export function changeSpecificColor(type) {
  socket.emit(EVENTS.CHANGE_SPECIFIC_COLOR, type);
}
export function toggleShades(useShades) {
  socket.emit(EVENTS.TOGGLE_SHADES, useShades);
}

export { socket };
