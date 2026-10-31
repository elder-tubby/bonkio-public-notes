// server/index.js
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const LobbyManager = require("./lobbyManager");
const { GameManager } = require("./gameManager");
const { EVENTS } = require("./config");
const AdminManager = require("./adminManager"); // Add this

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Secret testing configurations
const ACCESS_PASSWORD = "mySecretPassword123";

// 2. Main Authentication Gatekeeper
app.use((req, res, next) => {
  // Check if they are trying to authenticate via the URL query
  if (req.query.pw === ACCESS_PASSWORD) {
    // Set a custom cookie that expires in 24 hours so it remembers this browser
    res.cookie("auth_token", "passed_testing_lock", {
      maxAge: 86400000,
      httpOnly: true,
    });
    return next();
  }

  // Check if they already have the authorization cookie in their browser headers
  const cookies = req.headers.cookie || "";
  if (cookies.includes("auth_token=passed_testing_lock")) {
    return next();
  }

  // If they have neither the query param nor the cookie, block them
  res.status(403).send(`
    <html>
      <head><title>Access Denied</title></head>
      <body style="background:#111; color:#fff; font-family:sans-serif; text-align:center; padding-top:100px;">
        <h2>⚠️ This app is locked for private testing.</h2>
        <p>Please use the authorized testing link containing the access token.</p>
      </body>
    </html>
  `);
});

// 3. Static assets can now safely serve because the browser validates via cookie header
app.use(express.static("public"));

const lobby = new LobbyManager(io, () => game.active);
const game = new GameManager(io, lobby);
const chatLimiter = new Map();
const admin = new AdminManager(io, lobby, game); // Add this

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  socket.emit(EVENTS.CONNECT_WITH_ID, socket.id);

  // Send initial admin state for UI setup (e.g., show/hide lobby password field)
  socket.emit(EVENTS.ADMIN_STATE_UPDATE, admin.getAdminState());

  socket.emit(EVENTS.LOBBY_UPDATE, {
    players: lobby.getLobbyPayload().players,
    gameActive: game.active,
  });
  if (game.active) {
    socket.emit(EVENTS.GAME_SNAPSHOT, game.getSnapshotFor(socket.id));
  }

  socket.on(EVENTS.JOIN_LOBBY, (data) => {
    const { name, password } = data;
    const passwordResult = admin.checkLobbyPassword(password, socket.id);
    if (!passwordResult.success) {
      return socket.emit(EVENTS.LOBBY_JOIN_FAIL, {
        message: passwordResult.message,
      });
    }

    const result = lobby.addPlayer(socket.id, name);
    if (result.error === "lobbyFull") {
      return socket.emit(EVENTS.LOBBY_FULL);
    } else if (result.error === "duplicateName") {
      return socket.emit(EVENTS.LOBBY_NAME_TAKEN);
    }

    lobby.broadcastLobby();
    if (game.active) {
      socket.emit(EVENTS.GAME_IN_PROGRESS);
    }
  });

  socket.on(EVENTS.SET_READY, (isReady) => {
    if (!lobby.players[socket.id]) return;

    lobby.setReady(socket.id, isReady);

    if (game.active && isReady) {
      game.addParticipant(socket.id);
    } else if (!game.active && lobby.canGameStart()) {
      game.start();
    }
  });

  // Game Actions
  socket.on(EVENTS.CREATE_OBJECT, (objectData) =>
    game.handleObjectCreation(socket.id, objectData),
  );
  socket.on(EVENTS.CREATE_OBJECTS_BATCH, (batchData) =>
    game.handleObjectsCreationBatch(socket.id, batchData),
  );
  socket.on(EVENTS.UPDATE_OBJECT, (updateData) =>
    game.handleObjectUpdate(socket.id, updateData),
  );
  socket.on(EVENTS.UPDATE_OBJECTS_BATCH, (updateData) =>
    game.handleObjectsUpdateBatch(socket.id, updateData),
  );
  socket.on(EVENTS.DELETE_OBJECT, (objectId) =>
    game.handleObjectDeletion(socket.id, objectId),
  );
  socket.on(EVENTS.REORDER_OBJECTS, (data) =>
    game.handleObjectsReorder(socket.id, data),
  );

  socket.on(EVENTS.PASTE_LINES, (pasteData) =>
    game.handlePasteLines(socket.id, pasteData),
  );

  // Map Object Actions
  socket.on(EVENTS.SET_SPAWN_CIRCLE, (pos) =>
    game.setSpawnCircle(socket.id, pos),
  );
  socket.on(EVENTS.SET_CAP_ZONE, (pos) => game.setCapZone(socket.id, pos));
  socket.on(EVENTS.SET_MAP_SIZE, (size) => game.setMapSize(socket.id, size));

  // Voting
  socket.on(EVENTS.VOTE_FINISH, (vote) => {
    if (lobby.players[socket.id]) {
      game.voteFinish(socket.id, vote);
    }
  });

  // Chat
  socket.on(EVENTS.SEND_CHAT, (message) => {
    const player = lobby.players[socket.id];
    if (!player) return;

    if (typeof message !== "string" || message.trim().length === 0) return;
    if (message.length > 1000) {
      return socket.emit(EVENTS.CHAT_ERROR, "Message is too long (max 1000).");
    }

    const now = Date.now();
    const userHistory = chatLimiter.get(socket.id) || [];
    const recentHistory = userHistory.filter((ts) => now - ts < 10000);

    if (recentHistory.length >= 5) {
      return socket.emit(
        EVENTS.CHAT_ERROR,
        "You are sending messages too quickly.",
      );
    }

    recentHistory.push(now);
    chatLimiter.set(socket.id, recentHistory);

    io.emit(EVENTS.CHAT_MESSAGE, { name: player.name, message });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
    chatLimiter.delete(socket.id);
    game.handleDisconnect(socket.id);
    lobby.removePlayer(socket.id);
  });

  socket.on(EVENTS.ADMIN_LOGIN, (password) => {
    const result = admin.handleLogin(socket, password);
    if (result.success) {
      socket.emit(EVENTS.ADMIN_LOGIN_SUCCESS, {
        ...admin.getAdminState(),
        players: lobby.getLobbyPayload().players,
      });
    } else {
      socket.emit(EVENTS.ADMIN_LOGIN_FAIL, { message: result.message });
    }
  });

  socket.on(EVENTS.ADMIN_KICK_PLAYER, (playerId) => {
    if (!socket.isAdmin) return;
    admin.kickPlayer(playerId);
  });

  socket.on(EVENTS.ADMIN_SET_PASSWORD, (newPassword) => {
    if (!socket.isAdmin) return;
    admin.setLobbyPassword(newPassword);
  });

  socket.on(EVENTS.ADMIN_END_GAME, () => {
    if (!socket.isAdmin) return;
    admin.endGame();
  });

  socket.on(EVENTS.CHANGE_COLORS, () => game.handleChangeColors(socket.id));
  socket.on(EVENTS.CHANGE_SPECIFIC_COLOR, (type) => {
    game.handleChangeSpecificColor(socket.id, type);
  });

  socket.on(EVENTS.TOGGLE_SHADES, (useShades) => {
    game.handleToggleShades(socket.id, useShades);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
