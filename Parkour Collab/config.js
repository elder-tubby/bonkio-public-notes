// config.js
module.exports = {
  MAX_LOBBY_PLAYERS: 8,
  EVENTS: {
    // Server -> Client
    CONNECT_WITH_ID: "connectWithId",
    LOBBY_FULL: "lobbyFull",
    LOBBY_NAME_TAKEN: "lobbyNameTaken",
    GAME_IN_PROGRESS: "gameInProgress",
    LOBBY_UPDATE: "lobbyUpdate",
    START_GAME: "startGame",
    GAME_SNAPSHOT: "gameSnapshot",
    END_GAME: "endGame",
    GAME_UPDATE: "gameUpdate",

    SPAWN_CIRCLE_UPDATED: "spawnCircleUpdated",
    CAP_ZONE_UPDATED: "capZoneUpdated",
    MAP_SIZE_UPDATED: "mapSizeUpdated",
    CLEAR_CHAT: "clearChat",
    CHAT_MESSAGE: "chatMessage",
    CHAT_ERROR: "chatError",
    OBJECT_CREATED: "objectCreated", // Replaces LINE_CREATED
    OBJECTS_CREATED_BATCH: "objectsCreatedBatch", // Replaces POLYGONS_CREATED_BATCH
    UPDATE_OBJECTS_BATCH: "updateObjectsBatch",
    OBJECT_UPDATED: "objectUpdated", // Replaces LINE_UPDATED, POLYGON_UPDATED
    OBJECT_DELETED: "objectDeleted", // Replaces LINE_DELETED, POLYGON_DELETED
    OBJECTS_REORDERED: "objectsReordered",
    COLORS_UPDATED: "colorsUpdated",

    // Client -> Server
    JOIN_LOBBY: "joinLobby",
    SET_READY: "setReady",
    VOTE_FINISH: "voteFinish",
    SEND_CHAT: "sendChat",
    CREATE_OBJECT: "createObject", // Replaces CREATE_LINE
    CREATE_OBJECTS_BATCH: "createObjectsBatch", // Replaces CREATE_POLYGONS_BATCH
    DELETE_OBJECT: "deleteObject", // Replaces DELETE_LINE, DELETE_POLYGON
    REORDER_OBJECTS: "reorderObject", // Replaces REORDER_LINE, REORDER_POLYGON
    UPDATE_OBJECT: "updateObject",
    SET_SPAWN_CIRCLE: "setSpawnCircle",
    SET_CAP_ZONE: "setCapZone",
    SET_MAP_SIZE: "setMapSize",
    PASTE_LINES: "pasteLines",

    ADMIN_LOGIN: "admin:login",
    ADMIN_LOGIN_SUCCESS: "admin:login_success",
    ADMIN_LOGIN_FAIL: "admin:login_fail",
    ADMIN_STATE_UPDATE: "admin:state_update",
    ADMIN_KICK_PLAYER: "admin:kick_player",
    ADMIN_SET_PASSWORD: "admin:set_password",
    ADMIN_END_GAME: "admin:end_game",
    KICKED: "kicked",
    LOBBY_JOIN_FAIL: "lobby:join_fail",
    CHANGE_COLORS: "changeColors",
    CHANGE_SPECIFIC_COLOR: "changeSpecificColor",
    TOGGLE_SHADES: "toggleShades",
  },
  PORT: 3000,
  CAP_ZONE_OPTIONS: [
    { x: 10, y: 10 },
    { x: 608, y: 10 },
  ],
  CAP_ZONE_SIZE: 30,
  MAX_PLAYERS: 8,
  // Add a set of symbols to choose from
  PLAYER_SYMBOLS: [
    "💃🏽",
    "👖",
    "💀",
    "🎶",
    "👀",
    "🦄",
    "🌷",
    "🙏",
    "🌈",
    "🌧",
    "☕️",
    "🎩",
    "🖕🏽",
    "✅",
    "🔥",
    "👩‍🍳",
  ],
  getSymbolFromName: (name) => {
    const normalizedName = name.toLowerCase();

    const symbolRules = {
      cook: "👩‍🍳",
      chef: "👩‍🍳",
      dance: "💃🏽",
      jeans: "👖",
      skull: "💀",
      music: "🎶",
      eye: "👀",
      unicorn: "🦄",
      tulip: "🌷",
      pray: "🙏",
      rainbow: "🌈",
      rain: "🌧",
      coffee: "☕️",
      hat: "🎩",
      fire: "🔥",
      ok: "✅",
      check: "✅",
      aa1134: "🦃",
      jumper: "🌈",
      salama: "⚡",
      otter: "🦦",
      duck: "🦆",
      tractor: "🆓",
      bear: "🧸",
      kiitscat: "🦦",
      lemon: "🍋",
      ez: "🐅",
    };

    for (const keyword in symbolRules) {
      if (normalizedName.includes(keyword)) {
        return symbolRules[keyword];
      }
    }
    // Return a random symbol from the main array if no keyword matches
    return module.exports.PLAYER_SYMBOLS[
      Math.floor(Math.random() * module.exports.PLAYER_SYMBOLS.length)
    ];
  },
};
