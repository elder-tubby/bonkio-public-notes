import State from "./state.js";

const STORAGE_KEY = "parkour-map-editor-draft-v1";
const listeners = new Map();
const persistentKeys = new Set([
  "objects",
  "colors",
  "spawnCircle",
  "capZone",
  "mapSize",
]);

let saveTimer = null;
let nextId = 1;

function emit(event, payload) {
  (listeners.get(event) || []).forEach((callback) => callback(payload));
}

function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => listeners.get(event)?.delete(callback);
}

function record() {
  if (window.saveMapSnapshot) window.saveMapSnapshot();
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `local-${Date.now()}-${nextId++}`;
}

function objectType(obj) {
  return obj.lineType || obj.polyType || obj.circleType || "none";
}

function paletteColor(type) {
  const colors = State.get("colors") || {};
  return colors[type] || colors.none || "white";
}

function cleanObject(data = {}) {
  const {
    id,
    playerId,
    username,
    symbol,
    ...shape
  } = data;
  const type = objectType(shape);
  const createdAt = data.createdAt || Date.now();

  return {
    ...shape,
    id: id || createId(),
    color: data.color || paletteColor(type),
    createdAt,
  };
}

function isPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function isValidObject(obj) {
  if (!obj || !obj.type) return false;
  if (obj.type === "line") return isPoint(obj.start) && isPoint(obj.end);
  if (obj.type === "circle") {
    return isPoint(obj.c) && Number.isFinite(obj.radius) && obj.radius > 0;
  }
  if (obj.type === "poly") {
    return (
      isPoint(obj.c) &&
      Array.isArray(obj.v) &&
      obj.v.length >= 3 &&
      obj.v.every(isPoint)
    );
  }
  return false;
}

function applyUpdate(current, payload) {
  const updated = { ...current };

  if (current.type === "line") {
    const start = { ...current.start };
    const end = { ...current.end };
    const nudge = payload.nudge || {};
    const hasNudge = !!(nudge.x || nudge.y);
    if (hasNudge) {
      start.x += (nudge.x || 0) * 2;
      start.y += (nudge.y || 0) * 2;
      end.x += (nudge.x || 0) * 2;
      end.y += (nudge.y || 0) * 2;
    }
    if (isPoint(payload.start) && isPoint(payload.end)) {
      Object.assign(start, payload.start);
      Object.assign(end, payload.end);
    }
    updated.start = start;
    updated.end = end;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    updated.width = Math.hypot(dx, dy);
    updated.height = typeof current.height === "number" ? current.height : 4;
    updated.angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

    const isMoving =
      hasNudge ||
      (isPoint(payload.start) && isPoint(payload.end));
    const isResizing =
      typeof payload.width === "number" ||
      typeof payload.height === "number" ||
      typeof payload.angle === "number" ||
      !!payload.widthDelta ||
      !!payload.heightDelta ||
      !!payload.angleDelta;

    if (payload.widthDelta) updated.width += payload.widthDelta;
    if (payload.heightDelta) updated.height += payload.heightDelta;
    if (payload.angleDelta) updated.angle += payload.angleDelta;
    if (typeof payload.width === "number") updated.width = payload.width;
    if (typeof payload.height === "number") updated.height = payload.height;
    if (typeof payload.angle === "number") updated.angle = payload.angle;

    updated.width = Math.max(1, Math.min(10000, updated.width));
    updated.height = Math.max(1, Math.min(1000, updated.height));
    updated.angle = ((updated.angle % 360) + 360) % 360;

    if (isMoving && !isResizing) {
      const movedDx = end.x - start.x;
      const movedDy = end.y - start.y;
      updated.width = Math.hypot(movedDx, movedDy);
      updated.angle =
        ((Math.atan2(movedDy, movedDx) * 180) / Math.PI + 360) % 360;
    } else if (isResizing) {
      const center = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      const halfWidth = updated.width / 2;
      const radians = (updated.angle * Math.PI) / 180;
      updated.start = {
        x: center.x - Math.cos(radians) * halfWidth,
        y: center.y - Math.sin(radians) * halfWidth,
      };
      updated.end = {
        x: center.x + Math.cos(radians) * halfWidth,
        y: center.y + Math.sin(radians) * halfWidth,
      };
    }
  } else if (current.type === "poly") {
    if (payload.nudge) {
      updated.c = {
        x: current.c.x + (payload.nudge.x || 0) * 2,
        y: current.c.y + (payload.nudge.y || 0) * 2,
      };
    }
    if (isPoint(payload.c)) updated.c = payload.c;
    if (payload.angleDelta) updated.a = (updated.a || 0) + payload.angleDelta;
    if (typeof payload.a === "number") updated.a = payload.a;
    if (payload.scaleDelta) updated.scale = (updated.scale || 1) + payload.scaleDelta;
    if (typeof payload.scale === "number") updated.scale = payload.scale;
    if (Array.isArray(payload.v) && payload.v.length >= 3) updated.v = payload.v;
    updated.a = (((updated.a || 0) % 360) + 360) % 360;
    updated.scale = Math.max(0.1, Math.min(10, updated.scale || 1));
  } else if (current.type === "circle") {
    if (payload.nudge) {
      updated.c = {
        x: current.c.x + (payload.nudge.x || 0) * 2,
        y: current.c.y + (payload.nudge.y || 0) * 2,
      };
    }
    if (isPoint(payload.c)) updated.c = payload.c;
    if (payload.radiusDelta) {
      updated.radius = (updated.radius || 0) + payload.radiusDelta;
    }
    if (typeof payload.radius === "number") updated.radius = payload.radius;
    updated.radius = Math.max(1, Math.min(1000, updated.radius || 1));
  }

  for (const key of ["lineType", "polyType", "circleType", "isZone"]) {
    if (payload[key] !== undefined) updated[key] = payload[key];
  }

  if (
    payload.lineType !== undefined ||
    payload.polyType !== undefined ||
    payload.circleType !== undefined
  ) {
    updated.color = paletteColor(objectType(updated));
  }

  return updated;
}

function saveDraftSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          objects: State.get("objects") || [],
          colors: State.get("colors"),
          spawnCircle: State.get("spawnCircle"),
          capZone: State.get("capZone"),
          mapSize: State.get("mapSize"),
        }),
      );
    } catch (error) {
      console.warn("Could not save the local map draft.", error);
    }
  }, 200);
}

State.onChange((key) => {
  if (persistentKeys.has(key)) saveDraftSoon();
});

export function loadSavedDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || draft.version !== 1 || !Array.isArray(draft.objects)) {
      return false;
    }

    State.set(
      "objects",
      draft.objects.map(cleanObject).filter(isValidObject),
    );
    if (draft.colors && typeof draft.colors === "object") {
      State.set("colors", draft.colors);
    }
    if (draft.spawnCircle) State.set("spawnCircle", draft.spawnCircle);
    if (draft.capZone) State.set("capZone", draft.capZone);
    if (Number.isFinite(draft.mapSize)) State.set("mapSize", draft.mapSize);
    return true;
  } catch (error) {
    console.warn("Could not load the local map draft.", error);
    return false;
  }
}

export function onObjectCreated(callback) {
  return on("objectCreated", callback);
}
export function onObjectsCreatedBatch(callback) {
  return on("objectsCreatedBatch", callback);
}
export function onObjectUpdated(callback) {
  return on("objectUpdated", callback);
}
export function onObjectDeleted(callback) {
  return on("objectDeleted", callback);
}
export function onObjectsReordered(callback) {
  return on("objectsReordered", callback);
}
export function onSpawnCircleUpdate(callback) {
  return on("spawnCircleUpdate", callback);
}
export function onCapZoneUpdate(callback) {
  return on("capZoneUpdate", callback);
}
export function onMapSizeUpdate(callback) {
  return on("mapSizeUpdate", callback);
}
export function onColorsUpdated(callback) {
  return on("colorsUpdated", callback);
}

export function createObject(objectData) {
  record();
  const object = cleanObject(objectData);
  if (!isValidObject(object)) return;
  emit("objectCreated", object);
}

export function createObjectsBatch(batchData = {}) {
  record();
  const objects = (batchData.objects || [])
    .map(cleanObject)
    .filter(isValidObject);
  if (objects.length) emit("objectsCreatedBatch", objects);
}

export function updateObject(payload) {
  if (!payload?.id) return;
  const current = (State.get("objects") || []).find((obj) => obj.id === payload.id);
  if (!current) return;

  record();
  emit("objectUpdated", applyUpdate(current, payload));
}

export function updateObjectsBatch(payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return;
  record();
  const byId = new Map(payloads.filter((item) => item?.id).map((item) => [item.id, item]));
  const objects = (State.get("objects") || []).map((obj) =>
    byId.has(obj.id) ? applyUpdate(obj, byId.get(obj.id)) : obj,
  );
  emit("objectsReordered", objects);
}

export function deleteObject(objectId) {
  if (!objectId) return;
  record();
  emit("objectDeleted", { id: objectId });
}

export function reorderObjects({ ids, toBack } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  record();
  const selectedIds = new Set(ids);
  const current = State.get("objects") || [];
  const moving = ids
    .map((id) => current.find((obj) => obj.id === id))
    .filter(Boolean);
  const remaining = current.filter((obj) => !selectedIds.has(obj.id));
  emit(
    "objectsReordered",
    toBack ? [...moving, ...remaining] : [...remaining, ...moving],
  );
}

export function setSpawnCircle(position) {
  record();
  const spawn = { ...(State.get("spawnCircle") || {}), ...position };
  State.set("spawnCircle", spawn);
  emit("spawnCircleUpdate", spawn);
}

export function setCapZone(position) {
  record();
  const capZone = { ...(State.get("capZone") || {}), ...position };
  State.set("capZone", capZone);
  emit("capZoneUpdate", capZone);
}

export function setMapSize(size) {
  if (!Number.isFinite(Number(size))) return;
  const mapSize = Math.max(1, Math.min(13, Number(size)));
  State.set("mapSize", mapSize);
  emit("mapSizeUpdate", mapSize);
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `rgb(${Math.round(255 * f(0))}, ${Math.round(255 * f(8))}, ${Math.round(255 * f(4))})`;
}

function colorDistance(first, second) {
  const a = first.match(/\d+/g)?.map(Number) || [0, 0, 0];
  const b = second.match(/\d+/g)?.map(Number) || [0, 0, 0];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function randomDistinctColor(colors, excludedType) {
  const existing = Object.entries(colors)
    .filter(([type, color]) => type !== excludedType && typeof color === "string")
    .map(([, color]) => color);
  for (let attempt = 0; attempt < 500; attempt++) {
    const color = hslToRgb(
      Math.floor(Math.random() * 360),
      Math.floor(Math.random() * 101),
      Math.floor(Math.random() * 84) + 8,
    );
    if (existing.every((other) => colorDistance(color, other) > 70)) return color;
  }
  return hslToRgb(Math.floor(Math.random() * 360), 100, 50);
}

function randomShadingStyle() {
  const styles = [
    "left-to-right",
    "right-to-left",
    "top-to-bottom",
    "bottom-to-top",
    "diagonal-nw-se",
    "diagonal-ne-sw",
    "radial-out",
    "radial-in",
  ];
  return styles[Math.floor(Math.random() * styles.length)];
}

function publishColors(colors) {
  State.set("colors", colors);
  emit("colorsUpdated", colors);
}

export function changeSpecificColor(type) {
  if (!["none", "bouncy", "death", "background"].includes(type)) return;
  const colors = { ...(State.get("colors") || {}) };
  colors[type] = randomDistinctColor(colors, type);
  if (type !== "background") {
    colors.shadingStyles = {
      ...(colors.shadingStyles || {}),
      [type]: randomShadingStyle(),
    };
  }
  publishColors(colors);
}

export function changeColors() {
  const colors = { ...(State.get("colors") || {}) };
  const hue = Math.floor(Math.random() * 360);
  colors.none = hslToRgb(hue, 55 + Math.floor(Math.random() * 35), 48 + Math.floor(Math.random() * 24));
  colors.background = hslToRgb(hue, 25 + Math.floor(Math.random() * 30), 8 + Math.floor(Math.random() * 17));
  colors.death = hslToRgb(hue, 75 + Math.floor(Math.random() * 26), 28 + Math.floor(Math.random() * 25));
  colors.bouncy = hslToRgb(hue + 150 + Math.floor(Math.random() * 61), 65 + Math.floor(Math.random() * 31), 35 + Math.floor(Math.random() * 31));
  colors.shadingStyles = {
    none: randomShadingStyle(),
    death: randomShadingStyle(),
    bouncy: randomShadingStyle(),
  };
  publishColors(colors);
}

export function toggleShades(payload) {
  if (!payload || !["none", "death", "bouncy"].includes(payload.type)) return;
  const colors = { ...(State.get("colors") || {}) };
  const key =
    payload.type === "none"
      ? "useShades"
      : payload.type === "death"
        ? "shadeDeath"
        : "shadeBouncy";
  colors[key] = !!payload.state;
  if (payload.state) {
    colors.shadingStyles = {
      ...(colors.shadingStyles || {}),
      [payload.type]: randomShadingStyle(),
    };
  }
  publishColors(colors);
}

export function pasteLines(pasteData = {}) {
  if (!Array.isArray(pasteData.objects)) return;
  record();

  if (pasteData.colors && typeof pasteData.colors === "object") {
    publishColors({ ...(State.get("colors") || {}), ...pasteData.colors });
  }

  const imported = pasteData.objects
    .filter((obj) => obj && !obj.isBgLine)
    .map((obj) => cleanObject({ ...obj, id: undefined }))
    .filter(isValidObject);

  if (Number.isFinite(Number(pasteData.mapSize))) {
    setMapSize(pasteData.mapSize);
  }
  if (isPoint(pasteData.spawn)) setSpawnCircle(pasteData.spawn);
  if (isPoint(pasteData.capZone)) setCapZone(pasteData.capZone);
  if (imported.length) emit("objectsCreatedBatch", imported);
}
