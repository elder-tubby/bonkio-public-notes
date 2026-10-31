// server/adminManager.js
const { EVENTS } = require("./config");

// Read password from environment variables for security
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

class AdminManager {
  constructor(io, lobbyManager, gameManager) {
    this.io = io;
    this.lobbyManager = lobbyManager;
    this.gameManager = gameManager;
    this.lobbyPassword = null;
    this.loginAttempts = new Map();
    this.lobbyPasswordAttempts = new Map();

    if (!ADMIN_PASSWORD) {
      console.warn(
        "WARNING: ADMIN_PASSWORD environment variable not set. Admin features are disabled.",
      );
    }
  }

  getAdminState() {
    return {
      hasLobbyPassword: !!this.lobbyPassword,
      gameActive: this.gameManager.active,
    };
  }

  handleLogin(socket, password) {
    if (!ADMIN_PASSWORD) {
      return { success: false, message: "Admin features are disabled." };
    }

    const now = Date.now();
    const attempts = (this.loginAttempts.get(socket.id) || []).filter(
      (ts) => now - ts < 60000, // 1 minute window
    );

    if (attempts.length >= 5) {
      return {
        success: false,
        message: "Too many login attempts. Try again later.",
      };
    }

    if (password === ADMIN_PASSWORD) {
      socket.isAdmin = true;
      this.loginAttempts.delete(socket.id);
      return { success: true };
    } else {
      attempts.push(now);
      this.loginAttempts.set(socket.id, attempts);
      return { success: false, message: "Incorrect admin password." };
    }
  }

  kickPlayer(playerId) {
    const player = this.lobbyManager.players[playerId];
    if (player) {
      this.io
        .to(playerId)
        .emit(EVENTS.KICKED, { reason: "You have been removed by an admin." });
      const targetSocket = this.io.sockets.sockets.get(playerId);
      if (targetSocket) {
        // Disconnecting will trigger the 'disconnect' handler in index.js,
        // which correctly cleans up the player from the lobby and game.
        targetSocket.disconnect(true);
      }
    }
  }

  setLobbyPassword(newPassword) {
    // Treat empty string or null as removing the password
    this.lobbyPassword =
      typeof newPassword === "string" && newPassword.length > 0
        ? newPassword
        : null;

    console.log(
      this.lobbyPassword
        ? "Lobby password has been set."
        : "Lobby password has been removed.",
    );

    // Broadcast the new state to all clients so they know to show/hide the password field
    this.io.emit(EVENTS.ADMIN_STATE_UPDATE, this.getAdminState());
  }

  checkLobbyPassword(password, socketId) {
    // Add socketId parameter
    if (!this.lobbyPassword) {
      return { success: true }; // No password set, allow entry
    }

    const now = Date.now();
    // Use a 30-second window for attempts
    const attempts = (this.lobbyPasswordAttempts.get(socketId) || []).filter(
      (ts) => now - ts < 30000,
    );

    // Lock out after 4 failed attempts
    if (attempts.length >= 4) {
      return {
        success: false,
        message: "Too many password attempts. Please wait.",
      };
    }

    if (password === this.lobbyPassword) {
      this.lobbyPasswordAttempts.delete(socketId); // Clear attempts on success
      return { success: true };
    } else {
      attempts.push(now);
      this.lobbyPasswordAttempts.set(socketId, attempts);
      return { success: false, message: "Incorrect lobby password." };
    }
  }

  endGame() {
    if (this.gameManager.active) {
      this.gameManager.endGame("admin_forced");
    }
  }
}

module.exports = AdminManager;
