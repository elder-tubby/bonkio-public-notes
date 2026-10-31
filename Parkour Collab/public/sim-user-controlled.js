// public/sim-user-controlled.js
// Runs an interactive, user-controlled physics simulation
// based on real-time objects in the State.

import UI from "./ui.js";
import State from "./state.js";
import * as Network from "./network.js";
import {
  PhysicsPlayer,
  PhysicsMap,
  parseStateObjects,
  PHYSICS_SETTINGS,
} from "./sim-utils.js";

window.PHYSICS_SETTINGS = PHYSICS_SETTINGS;

import { showToast, showToastWithButtons } from "./utils-client.js";

// Store options locally when game starts
let currentSimOptions = {};

// --- Game State ---
let isActive = false;
let player = null;
let map = null;
let keysDown = { w: false, a: false, s: false, d: false };
let animFrameId = null;
let lastTime = 0;
let accumulator = 0;
let playerPath = [];
let touchedObjectIds = new Set();

/**
 * The main game loop, driven by requestAnimationFrame.
 */
function gameLoop(currentTime) {
  if (!isActive) return;

  const { TIME_STEP } = PHYSICS_SETTINGS;
  const deltaTime = (currentTime - lastTime) / 1000; // in seconds
  lastTime = currentTime;
  accumulator += deltaTime;

  // Use fixed time-step updates for stable physics
  while (accumulator >= TIME_STEP) {
    // --- REAL-TIME MAP UPDATE ---
    const stateObjects = State.get("objects") || [];
    map.objects = parseStateObjects(stateObjects);
    const spawnCircle = State.get("spawnCircle");
    map.spawn.x = spawnCircle.x;
    map.spawn.y = spawnCircle.y;
    player.radius = spawnCircle.diameter / 2;
    // --- END OF MAP UPDATE ---

    const inputs = {
      up: keysDown.w,
      down: keysDown.s,
      left: keysDown.a,
      right: keysDown.d,
    };

    // Update player and get result
    const result = player.update(inputs, map);

    // Track touched objects
    if (result.touchedIds && result.touchedIds.length > 0) {
      result.touchedIds.forEach((id) => touchedObjectIds.add(id));
    }

    // Check Death Condition (result.died)
    if (result.died || player.pos.y >= 500) {
      player.respawn(map.spawn);
      playerPath = [];
      playerPath.push({ x: player.pos.x, y: player.pos.y });
      touchedObjectIds.clear();

      console.log("[Sim] Player died. Path reset.");
      State.set("generatedPath", playerPath);
    }

    // Check Cap Zone
    const cz = State.get("capZone");
    if (cz) {
      const closestX = Math.max(cz.x, Math.min(player.pos.x, cz.x + cz.width));
      const closestY = Math.max(cz.y, Math.min(player.pos.y, cz.y + cz.height));
      const dx = player.pos.x - closestX;
      const dy = player.pos.y - closestY;
      if (dx * dx + dy * dy < player.radius * player.radius) {
        console.log("[Sim] Reached Cap Zone!");
        playerPath = [];
        stopGame(); // Stop game triggers the menu
        return;
      }
    }

    accumulator -= TIME_STEP;
  }

  // Path Recording Logic
  const lastPoint = playerPath[playerPath.length - 1];
  const dist = lastPoint
    ? Math.hypot(player.pos.x - lastPoint.x, player.pos.y - lastPoint.y)
    : Infinity;
  const minRecordDist = player.radius * 2;

  if (dist >= minRecordDist) {
    playerPath.push({ x: player.pos.x, y: player.pos.y });
    State.set("generatedPath", [...playerPath]);
  }

  State.set("simulationPreview", {
    x: player.pos.x,
    y: player.pos.y,
    radius: player.radius,
  });

  animFrameId = requestAnimationFrame(gameLoop);
}

function handleKeyDown(e) {
  switch (e.key.toLowerCase()) {
    case "w":
      keysDown.w = true;
      e.preventDefault();
      break;
    case "a":
      keysDown.a = true;
      e.preventDefault();
      break;
    case "s":
      keysDown.s = true;
      e.preventDefault();
      break;
    case "d":
      keysDown.d = true;
      e.preventDefault();
      break;
    case "escape":
      stopGame();
      e.preventDefault();
      break;
  }
}

function handleKeyUp(e) {
  switch (e.key.toLowerCase()) {
    case "w":
      keysDown.w = false;
      e.preventDefault();
      break;
    case "a":
      keysDown.a = false;
      e.preventDefault();
      break;
    case "s":
      keysDown.s = false;
      e.preventDefault();
      break;
    case "d":
      keysDown.d = false;
      e.preventDefault();
      break;
  }
}

// --- NEW: Function to convert UNTOUCHED objects to death ---
function convertUntouchedToDeath() {
  const allObjects = State.get("objects") || [];

  // Identify Untouched IDs
  const untouchedIds = allObjects
    .filter((obj) => !touchedObjectIds.has(obj.id))
    .map((obj) => obj.id);

  if (untouchedIds.length === 0) {
    showToast("All objects were touched! Nothing to change.", true);
    return;
  }

  let count = 0;

  untouchedIds.forEach((id) => {
    const obj = allObjects.find((o) => o.id === id);
    if (!obj) return;

    let updatePayload = { id };
    let changed = false;

    if (obj.type === "line" && obj.lineType !== "death") {
      updatePayload.lineType = "death";
      changed = true;
    } else if (obj.type === "circle" && obj.circleType !== "death") {
      updatePayload.circleType = "death";
      changed = true;
    } else if (obj.type === "poly" && obj.polyType !== "death") {
      updatePayload.polyType = "death";
      changed = true;
    }

    if (changed) {
      Network.updateObject(updatePayload);
      count++;
    }
  });

  showToast(`Converted ${count} untouched objects to Death.`);
}

/**
 * Stops the game simulation and cleans up.
 */
function stopGame(options = {}) {
  if (!isActive) return;

  isActive = false;
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);

  State.set("simulationPreview", null);

  // --- END GAME MENU ---

  // 1. CAPTURE DATA: Critical Fix!
  // We must copy playerPath now, because it gets cleared at the bottom of this function.
  const capturedPath = [...playerPath];
  const MIN_PATH_POINTS = 5;

  const buttons = [];

  // Option 1: Generate Tunnel
  if (capturedPath.length > MIN_PATH_POINTS) {
    buttons.push({
      name: "Generate Tunnel",
      onClick: () => {
        console.log(
          `[Path Recorder] Generating tunnel from ${capturedPath.length} points...`,
        );
        generateTunnelFromPath(capturedPath, State, {
          epsilon: 10,
          tunnelPadding: currentSimOptions.tunnelPadding,
        });
        State.set("generatedPath", null);
      },
    });
  }

  // Option 2: Convert UNTOUCHED to Death (Inverse Logic)
  const allObjects = State.get("objects") || [];
  const totalCount = allObjects.length;
  const touchedCount = touchedObjectIds.size;
  const untouchedCount = Math.max(0, totalCount - touchedCount);

  if (untouchedCount > 0) {
    buttons.push({
      name: `Kill Untouched (${untouchedCount})`,
      onClick: () => {
        convertUntouchedToDeath();
        State.set("generatedPath", null);
      },
    });
  }

  if (buttons.length > 0) {
    showToastWithButtons("Simulation Ended. Choose action:", buttons);
  } else {
    showToast("Simulation ended.");
    State.set("generatedPath", null);
  }

  // Reset tracking vars
  playerPath = [];
  player = null;
  map = null;
  keysDown = { w: false, a: false, s: false, d: false };
}

export function startGame(options = {}) {
  if (State.get("simulationPreview") && !isActive) {
    showToast("Cannot start: A simulation is already running!", true);
    return;
  }

  currentSimOptions = options;
  if (isActive) {
    stopGame();
    return;
  }

  console.log("Starting game simulation...");

  const spawnCircle = State.get("spawnCircle");
  if (!spawnCircle) {
    console.error("Spawn circle not found.");
    return;
  }

  const spawnPos = { x: spawnCircle.x, y: spawnCircle.y };
  const spawnRadius = spawnCircle.diameter / 2;

  player = new PhysicsPlayer(spawnPos.x, spawnPos.y, spawnRadius);
  map = new PhysicsMap([], spawnPos);

  // Reset Data
  playerPath = [];
  playerPath.push({ x: player.pos.x, y: player.pos.y });
  touchedObjectIds.clear();

  isActive = true;
  accumulator = 0;
  lastTime = performance.now();

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  animFrameId = requestAnimationFrame(gameLoop);
}

window.startMousePathGen = async function () {
  if (State.get("simulationPreview") && !isActive) {
    showToast("Cannot start: A simulation is already running!", true);
    return;
  }
  console.log("Draw a path using your mouse...");
  try {
    let pathPoints = await startPathDrawing();
    const spawnCircle = State.get("spawnCircle");
    if (!spawnCircle) {
      State.set("generatedPath", null);
      return;
    }
    const playerRadius = spawnCircle.diameter / 2;
    const minRecordDist = playerRadius * 2;

    const filteredPath = [];
    if (pathPoints.length > 0) {
      filteredPath.push(pathPoints[0]);
      for (let i = 1; i < pathPoints.length; i++) {
        const lastPoint = filteredPath[filteredPath.length - 1];
        const currentPoint = pathPoints[i];
        const dist = Math.hypot(
          currentPoint.x - lastPoint.x,
          currentPoint.y - lastPoint.y,
        );
        if (dist >= minRecordDist) {
          filteredPath.push(currentPoint);
        }
      }
    }
    pathPoints = filteredPath;

    const MIN_PATH_POINTS = 5;
    if (pathPoints.length < MIN_PATH_POINTS) {
      State.set("generatedPath", null);
      return;
    }

    await generateTunnelFromPath(pathPoints, State, {
      epsilon: 10,
      tunnelPadding: currentSimOptions.tunnelPadding || 15,
    });

    State.set("generatedPath", null);
  } catch (err) {
    console.log("Mouse Gen Cancelled:", err.message);
    State.set("generatedPath", null);
  }
};
