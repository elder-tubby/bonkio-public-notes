/**
 * lobbyManager.js
 * Tracks everyone in the lobby, their "ready" state, and assigns unique symbols.
 */

const {
  MAX_LOBBY_PLAYERS,
  getSymbolFromName,
  EVENTS,
  PLAYER_SYMBOLS,
} = require("./config");

class LobbyManager {
  constructor(io, getGameActive = () => false) {
    this.io = io;
    this.players = {};
    this.getGameActive = getGameActive;
  }

  getUsedSymbols() {
    return new Set(Object.values(this.players).map((p) => p.symbol));
  }

  addPlayer(socketId, name) {
    if (typeof name !== "string") {
      console.log("Invalid name type:", name);
      throw new TypeError("Expected a string for name");
    }
    const lowerName = name.trim().toLowerCase();
    if (Object.keys(this.players).length >= MAX_LOBBY_PLAYERS) {
      return { error: "lobbyFull" };
    }

    const isDuplicateName = Object.values(this.players).some(
      (p) => p.name.trim().toLowerCase() === lowerName,
    );
    if (isDuplicateName) {
      return { error: "duplicateName" };
    }

    const usedSymbols = this.getUsedSymbols();
    let symbol = getSymbolFromName(name);

    // If chosen symbol already taken, pick an unused one from PLAYER_SYMBOLS
    if (usedSymbols.has(symbol)) {
      const available = PLAYER_SYMBOLS.filter((s) => !usedSymbols.has(s));
      if (available.length > 0) {
        symbol = available[Math.floor(Math.random() * available.length)];
      } else {
        // fallback when all symbols are used
        symbol = `P${Object.keys(this.players).length + 1}`;
      }
    }

    this.players[socketId] = {
      id: socketId,
      name: name.trim(),
      ready: false,
      symbol,
      inGame: false,
    };

    return { success: true };
  }

  removePlayer(socketId) {
    delete this.players[socketId];
    this.broadcastLobby();
  }

  setReady(socketId, ready) {
    const player = this.players[socketId];
    if (player) {
      player.ready = !!ready;
      this.broadcastLobby();
    }
  }

  getReadyPlayers() {
    return Object.values(this.players).filter((p) => p.ready && !p.inGame);
  }

  canGameStart() {
    const readyPlayers = this.getReadyPlayers();
    return readyPlayers.length >= 1;
  }

  resetReady() {
    Object.values(this.players).forEach((p) => {
      p.ready = false;
    });
  }

  getLobbyPayload() {
    return {
      players: Object.values(this.players).map((p) => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        symbol: p.symbol,
        inGame: !!p.inGame,
      })),
    };
  }
  // server/lobbyManager.js (snippet)

  // In the broadcastLobby method, add an admin state broadcast
  broadcastLobby() {
    const payload = this.getLobbyPayload();
    this.io.emit(EVENTS.LOBBY_UPDATE, {
      ...payload,
      gameActive: !!this.getGameActive(),
    });
    // This ensures admin panels with player lists stay in sync
    this.io.emit(EVENTS.ADMIN_STATE_UPDATE, {
      players: payload.players,
      gameActive: !!this.getGameActive(),
    });
  }
}

module.exports = LobbyManager;
