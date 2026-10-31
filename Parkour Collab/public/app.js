/**
 * app.js - Client-Side Orchestrator
 */
import UI from "./ui.js";
import State from "./state.js";
import Canvas from "./canvas.js";
import * as Network from "./network.js";
import AdminUI from "./admin.js";
import { bindUIEvents } from "./handlers.js";
import { showToast, getSpawnDiameter, MapHistory } from "./utils-client.js";

window.State = State;
window.Network = Network;

// Version Tracking Hooks
MapHistory.init(State, Network);
window.saveMapSnapshot = () => MapHistory.debouncedSave();
window.undoMap = () => MapHistory.undo();
window.redoMap = () => MapHistory.redo();

function main() {
  UI.init();
  AdminUI.init(); // Add this
  bindUIEvents();
  bindNetworkEvents();
  watchStateChanges();
  Canvas.draw();
}

// Single source of truth: if this is not null, a notification session is active.
let notificationInterval = null;
const originalTitle = document.title;
const notificationTitle = "💬 New Message!";

const notificationSound = new Audio("/sounds/chat.wav");
notificationSound.preload = "auto";
notificationSound.volume = 0.5;

/**
 * Play a short join sound if any NEW player (other than this client) appears
 * in `newPlayers` that wasn't in `prevPlayers`.
 */
function playJoinSoundIfNew(prevPlayers = [], newPlayers = []) {
  try {
    if (!State.get("isNotificationSoundOn")) {
      return;
    }
    const prevIds = new Set((prevPlayers || []).map((p) => p.id));
    const myId = State.get("socketId");
    const newJoin = (newPlayers || []).some(
      (p) => p?.id && !prevIds.has(p.id) && p.id !== myId,
    );
    if (!newJoin) return;
    notificationSound.currentTime = 0;
    notificationSound.play().catch(() => {
      /* ignore play failures (auto-play policy, etc.) */
    });
  } catch (e) {
    console.error("playJoinSoundIfNew error:", e);
  }
}

function bindNetworkEvents() {
  Network.onConnectWithId((id) => State.set("socketId", id));

  Network.onLobbyFull(() => showToast("Sorry, the lobby is full.", true));
  Network.onLobbyNameTaken(() => showToast("Name already taken!", true));

  Network.onLobbyUpdate(({ players, gameActive }) => {
    const prevPlayers = State.get("players") || [];
    playJoinSoundIfNew(prevPlayers, players || []);

    State.set("players", players || []);
    UI.updateLobby(players || []);
    const me = (players || []).find((p) => p.id === State.get("socketId"));
    if (UI.elems.readyCheckbox) UI.elems.readyCheckbox.disabled = !me;
    State.set("gameActive", !!gameActive);
  });

  Network.onGameInProgress(() =>
    UI.showLobbyMessage("Game in progress. Set 'Ready' to join."),
  );
  Network.onStartGame(initializeGameView);
  Network.onGameSnapshot(initializeGameView);
  Network.onGameUpdate(({ players, votes, totalParticipants }) => {
    const prevPlayers = State.get("players") || [];
    playJoinSoundIfNew(prevPlayers, players || []);

    UI.updatePlayers(players || []);
    UI.setVote(votes ?? 0, totalParticipants ?? 0);
  });
  Network.onEndGame(({ reason }) => {
    State.set("gameActive", false);
    if (UI.elems && UI.elems.readyCheckbox) {
      UI.elems.readyCheckbox.checked = false;
    }
    UI.hide("canvasWrap");
    UI.show("home");
    UI.setEndReason(
      reason === "voted" ? "All players voted to end." : "All players left.",
    );
    UI.show("gameEndPopup");
    UI.showLobbyMessage("Drawing will start when 2 players are ready.");
  });
  Network.onObjectCreated((newObject) => {
    MapHistory.handleNewObjects([newObject]);
    State.set("objects", [...State.get("objects"), newObject]);
    if (newObject.playerId === State.get("socketId")) {
      State.set("selectedObjectIds", [newObject.id]);
    }
  });

  Network.onObjectsCreatedBatch((newObjects) => {
    MapHistory.handleNewObjects(newObjects);
    if (Array.isArray(newObjects) && newObjects.length > 0) {
      State.set("objects", [...State.get("objects"), ...newObjects]);

      const myId = State.get("socketId");
      const myNewObjectIds = newObjects
        .filter((o) => o.playerId === myId)
        .map((o) => o.id);

      if (myNewObjectIds.length > 0) {
        State.set("selectedObjectIds", myNewObjectIds);
      }
    }
  });

  // ---------- app.js (notification block) ----------

  function startTitleFlashing() {
    // This function is now simpler because the guard is in the caller.
    let showOriginal = false;
    notificationInterval = setInterval(() => {
      document.title = showOriginal ? originalTitle : notificationTitle;
      showOriginal = !showOriginal;
    }, 1000);
  }

  function stopTitleFlashingAndRestoreTitle() {
    if (notificationInterval) {
      clearInterval(notificationInterval);
      notificationInterval = null;
    }
    document.title = originalTitle;
  }

  function startNotificationIfHidden() {
    // 1. Only run if the tab is hidden AND a notification is not already active.
    //    This check now prevents all race conditions and duplicate sounds.
    if (!document.hidden || notificationInterval) {
      return;
    }

    // 2. Start the notification session. This immediately sets `notificationInterval`,
    //    preventing this function from running again until the user returns.
    startTitleFlashing();

    // 3. Check if sound is enabled. With simpler logic, this check now works reliably.
    if (!State.get("isNotificationSoundOn")) {
      return;
    }

    // 4. Play the sound.
    try {
      notificationSound.currentTime = 0; // Rewind the sound to the beginning
      notificationSound.play().catch((err) => {
        console.error("Notification audio play failed:", err);
      });
    } catch (e) {
      console.error("Error trying to play notification sound:", e);
    }
  }

  // This handler remains unchanged but will now behave correctly.
  Network.onChatMessage((msg) => {
    UI.appendChat(msg);
    startNotificationIfHidden();
  });

  function resetNotificationsForNextSession() {
    // When the user returns, stop the flashing and sound to reset the state.
    stopTitleFlashingAndRestoreTitle();
    try {
      notificationSound.pause();
      notificationSound.currentTime = 0;
    } catch (e) {
      // Ignore errors, e.g., if the sound was never played.
    }
  }

  // These event listeners also remain unchanged.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      resetNotificationsForNextSession();
    }
  });
  window.addEventListener("focus", resetNotificationsForNextSession);

  Network.onObjectUpdated((updatedObject) => {
    const objects = State.get("objects").map((o) =>
      o.id === updatedObject.id ? updatedObject : o,
    );
    State.set("objects", objects);
    // Only update editor if this is the *only* selected object
    const selectedIds = State.get("selectedObjectIds");
    if (selectedIds.length === 1 && selectedIds[0] === updatedObject.id) {
      if (updatedObject.type === "line")
        UI.updateLineEditorValues(updatedObject);
      if (updatedObject.type === "poly")
        UI.updatePolygonEditorValues(updatedObject);
      if (updatedObject.type === "circle")
        UI.updateCircleEditorValues(updatedObject);
    }
  });

  Network.onObjectDeleted(({ id }) => {
    State.set(
      "objects",
      State.get("objects").filter((o) => o.id !== id),
    );
    State.removeSelectedObjectId(id);
  });

  Network.onObjectsReordered((reorderedObjects) => {
    if (Array.isArray(reorderedObjects)) {
      reorderedObjects.forEach((obj) => {
        if (obj.type === "poly") {
          console.log("Poly object:", obj, "scale:", obj.scale);
        } else {
          console.log("Object:", obj);
        }
      });
    }
    State.set("objects", reorderedObjects || []);
  });

  Network.onSpawnCircleUpdate((spawnCircle) =>
    State.set("spawnCircle", spawnCircle),
  );
  Network.onCapZoneUpdate((capZone) => State.set("capZone", capZone));
  Network.onMapSizeUpdate((mapSize) => {
    State.set("mapSize", mapSize);
    if (UI.elems.spawnSizeSlider) UI.elems.spawnSizeSlider.value = mapSize;
    if (UI.elems.spawnSizeValue) UI.elems.spawnSizeValue.innerText = mapSize;
  });
  Network.onChatError((errorMsg) => showToast(errorMsg, true));
  Network.onClearChat(() => UI.clearChat());

  Network.onKicked(({ reason }) => {
    alert(`${reason}`);
    window.location.reload();
  });

  Network.onLobbyJoinFail(({ message }) => {
    showToast(message, true);
  });

  Network.onAdminStateUpdate((state) => {
    UI.toggleLobbyPasswordInput(state.hasLobbyPassword);
    AdminUI.handleStateUpdate(state);
  });

  Network.onAdminLoginSuccess((state) => {
    showToast("Admin login successful.");
    AdminUI.handleLoginSuccess(state);
  });

  Network.onAdminLoginFail(({ message }) => {
    showToast(message, true);
  });

  // MODIFY onEndGame to include admin reason
  Network.onEndGame(({ reason }) => {
    State.set("gameActive", false);
    if (UI.elems && UI.elems.readyCheckbox) {
      UI.elems.readyCheckbox.checked = false;
    }
    UI.hide("canvasWrap");
    UI.show("home");
    let endReasonText = "All players left.";
    if (reason === "voted") endReasonText = "All players voted to end.";
    if (reason === "admin_forced")
      endReasonText = "Drawing was ended by an admin.";
    UI.setEndReason(endReasonText);
    UI.show("gameEndPopup");
    UI.showLobbyMessage("Drawing will start when 2 players are ready.");
  });

  Network.onColorsUpdated((colors) => {
    State.set("colors", colors);
  });
}

function watchStateChanges() {
  let drawPending = false;
  const scheduleDraw = () => {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => {
      Canvas.draw();
      drawPending = false;
    });
  };

  State.onChange((key) => {
    const visualKeys = [
      "objects",
      "drawingShape",
      "draggingPreview",
      "capZone",
      "spawnCircle",
      "selectedObjectIds",
      "hideUsernames",
      "selectionBox",
      "colors",
      "simulationPreview", // <-- ADD THIS
      "generatedPath", // <--- CRITICAL: Adds real-time path drawing support
      "isDrawingPath",
      "zoneIndicator", // <--- Adds support for cursor changes during drawing
      "cameraMode", // <-- ADD THIS
      "cameraOffset", // <-- ADD THIS
      "cameraZoom",
    ];
    if (visualKeys.includes(key)) scheduleDraw();

    switch (key) {
      case "selectedObjectIds":
        const selectedIds = State.get(key);
        const selectedObjects = State.get("objects").filter((o) =>
          selectedIds.includes(o.id),
        );
        UI.setObjectEditorVisible(selectedObjects);
        break;
      case "mapSize":
        const spawn = State.get("spawnCircle");
        if (spawn)
          State.set("spawnCircle", {
            ...spawn,
            diameter: getSpawnDiameter(State.get(key)),
          });
        break;
      case "colors":
        UI.updateColorIndicators(State.get(key));
        break;
    }
  });
}

function initializeGameView(payload = {}) {
  const myId = State.get("socketId");
  const isParticipant = (payload.players || []).some((p) => p.id === myId);

  if (Array.isArray(payload.players) && !isParticipant) {
    return;
  }

  UI.clearChat();
  State.set("hideUsernames", false);
  if (UI.elems.hideUsernamesCheckbox)
    UI.elems.hideUsernamesCheckbox.checked = false;
  if (UI.elems.voteCheckbox) UI.elems.voteCheckbox.checked = false;

  State.set("gameActive", true);
  State.set("objects", payload.objects || []);
  State.set("players", payload.players || []);
  State.set("capZone", payload.capZone);
  State.set("spawnCircle", payload.spawnCircle);
  State.set("mapSize", payload.mapSize ?? 9);
  State.set("colors", payload.colors);

  State.set("useShades", !!payload.useShades);
  if (UI.elems.cbUseShades) {
    UI.elems.cbUseShades.checked = !!payload.useShades;
  }

  UI.hide("home");
  UI.show("canvasWrap");
  UI.updatePlayers(payload.players || []);
}

document.addEventListener("DOMContentLoaded", main);
