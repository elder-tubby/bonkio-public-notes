//** handlers.js - UI Event Binders
//
import UI from "./ui.js";
import { generateDeathTunnel } from "./tunnel-generator.js";
import State from "./state.js";
// LocalStore applies editor actions directly to this browser's map state.
import * as Network from "./local-store.js";
import {
  getHitObjectId,
  getHoveredObject,
  distance,
  getLineProps,
  pointFromEventOnCanvas,
  normalizeAngle,
  handleUndoLastObject,
  calculatePolygonCenter,
  isObjectInSelectionBox,
  canSelectObject,
  createValidPolygonObject,
  splitConcaveIntoConvex,
  handleGroupRotation,
  handleGroupScaling,
  computeEnd,
} from "./utils-client.js";
import { copyLineInfo, pasteLines } from "./copyPasteLines.js";
import { showToast, showToastWithButtons } from "./utils-client.js";

// --- State Flags for Mouse Actions ---
let isDraggingObject = false;
let isDraggingSpawn = false;
let isDraggingCapZone = false;
let isDraggingZone = false;
let isDrawing = false; // Generic flag for line or marquee
let mouseMovedSinceDown = false;
let mouseDownTime = 0;
let isDraggingVertex = false;
let vertexDrag = null; // will be mirrored to State for canvas rendering

const keysDown = new Set();
let nudgeLoopId = null;

const cameraKeysDown = new Set();
let cameraLoopId = null;

let isPanning = false;
let panStartScreen = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 };

function startCameraLoop() {
  if (cameraLoopId) return;
  const loop = () => {
    if (!State.get("cameraMode") || cameraKeysDown.size === 0) {
      stopCameraLoop();
      return;
    }
    let offset = State.get("cameraOffset");
    let dx = 0,
      dy = 0;
    // Visually scale the pan speed to match the zoom depth so it feels smooth
    const speed = 15 / (State.get("cameraZoom") || 1);

    if (cameraKeysDown.has("w") || cameraKeysDown.has("arrowup")) dy += speed;
    if (cameraKeysDown.has("s") || cameraKeysDown.has("arrowdown")) dy -= speed;
    if (cameraKeysDown.has("a") || cameraKeysDown.has("arrowleft")) dx += speed;
    if (cameraKeysDown.has("d") || cameraKeysDown.has("arrowright"))
      dx -= speed;

    if (dx !== 0 || dy !== 0) {
      State.set("cameraOffset", { x: offset.x + dx, y: offset.y + dy });
    }
    cameraLoopId = requestAnimationFrame(loop);
  };
  cameraLoopId = requestAnimationFrame(loop);
}

function stopCameraLoop() {
  if (cameraLoopId) {
    cancelAnimationFrame(cameraLoopId);
    cameraLoopId = null;
  }
}

// Track the drawing mode before shift was pressed
let drawingModeBeforeShift = null;
function rotatePoint(pt, angleDeg) {
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: pt.x * cos - pt.y * sin, y: pt.x * sin + pt.y * cos };
}

function rotatePointInverse(pt, angleDeg) {
  // rotate by -angleDeg
  return rotatePoint(pt, -angleDeg);
}

function getAbsoluteVertices(obj) {
  // obj.v are local (relative to obj.c), apply rotation + scale + translate
  const a = obj.a || 0;
  const s = obj.scale || 1;
  return (obj.v || []).map((lv) => {
    const scaled = { x: lv.x * s, y: lv.y * s };
    const rotated = rotatePoint(scaled, a);
    return { x: obj.c.x + rotated.x, y: obj.c.y + rotated.y };
  });
}

function localVerticesFromAbsolute(absVerts, center, angleDeg, scale) {
  // For each absolute vertex: compute (Ai - center), rotate inverse by angle, divide by scale
  return absVerts.map((A) => {
    const rel = { x: A.x - center.x, y: A.y - center.y };
    const invRot = rotatePointInverse(rel, angleDeg);
    return { x: invRot.x / (scale || 1), y: invRot.y / (scale || 1) };
  });
}

function handleCanvasDown(e) {
  if (e.button === 1) e.preventDefault(); // Prevent middle-click auto-scroll
  if ((e.button !== 0 && e.button !== 1) || e.target !== UI.elems.canvas)
    return;

  if (State.get("cameraMode")) {
    isPanning = true;
    panStartScreen = { x: e.clientX, y: e.clientY };
    panStartOffset = { ...(State.get("cameraOffset") || { x: 0, y: 0 }) };
    return; // Block editing
  }

  if (e.button === 1) return; // Block middle click from executing normal canvas actions

  if (State.get("isDrawingPath")) return;

  const point = pointFromEventOnCanvas(e);
  State.set("mouse", point);
  mouseMovedSinceDown = false;
  mouseDownTime = Date.now();

  const drawingMode = State.get("drawingMode");

  const zone = State.get("zoneIndicator");
  if (zone && zone.show) {
    const spawn = State.get("spawnCircle");
    const diam = spawn ? spawn.diameter : 18;
    if (distance(point, zone) < diam / 2 + 5) {
      isDraggingZone = true;
      return;
    }
  }

  const spawn = State.get("spawnCircle");
  if (spawn && distance(point, spawn) < (spawn.diameter || 0) / 2 + 5) {
    isDraggingSpawn = true;
    return;
  }
  const cz = State.get("capZone");
  if (
    cz &&
    point.x > cz.x &&
    point.x < cz.x + cz.width &&
    point.y > cz.y &&
    point.y < cz.y + cz.height
  ) {
    isDraggingCapZone = true;
    return;
  }

  const drawingShape = State.get("drawingShape");
  if (drawingShape) {
    if (drawingMode === "poly") addPolygonPoint(point);
    return;
  }

  if (drawingMode === "split") {
    isDrawing = true;
    State.set("startPt", point);
    return;
  }

  const objects = State.get("objects") || [];
  const hitObjectId = getHitObjectId(point, objects);

  if (hitObjectId && canSelectObject(hitObjectId)) {
    const obj = objects.find((o) => o.id === hitObjectId);
    if (obj && obj.type === "poly" && State.isSelected(hitObjectId)) {
      const absVerts = getAbsoluteVertices(obj);
      const HANDLE_RADIUS = 8;
      const vertexIndex = absVerts.findIndex(
        (v) => distance(v, point) < HANDLE_RADIUS,
      );
      if (vertexIndex !== -1) {
        isDraggingVertex = true;
        isDraggingObject = false;
        vertexDrag = {
          objectId: hitObjectId,
          vertexIndex,
          originalObject: { ...obj, v: obj.v.map((p) => ({ ...p })) },
          originalAbsVertices: absVerts.map((p) => ({ ...p })),
          mouseStart: point,
        };
        State.set("vertexDrag", { ...vertexDrag });
        State.set("draggingPreview", {
          mouseStart: point,
          originalObjects: [{ ...obj }],
          objects: [{ ...obj }],
        });
        return;
      }
    }

    isDraggingVertex = false;
    isDraggingObject = true;

    if (e.shiftKey) {
      if (State.isSelected(hitObjectId))
        State.removeSelectedObjectId(hitObjectId);
      else State.addSelectedObjectId(hitObjectId);
    } else if (!State.isSelected(hitObjectId)) {
      State.set("selectedObjectIds", [hitObjectId]);
    }

    const selectedObjects = objects.filter((o) => State.isSelected(o.id));
    State.set("draggingPreview", {
      mouseStart: point,
      originalObjects: selectedObjects.map((o) => ({ ...o })),
    });
    return;
  }

  const selectedIds = State.get("selectedObjectIds") || [];
  if (selectedIds.length > 0) {
    State.clearSelectedObjects();
    if (drawingMode === "poly") return;
  }

  if (drawingMode === "poly") {
    State.set("drawingShape", { type: "poly", vertices: [point] });
    UI.setStatus(
      "Click to add points, close shape to finish, or 'X' to cancel.",
    );
    return;
  }

  if (["line", "circle", "select", "split"].includes(drawingMode)) {
    isDrawing = true;
    State.set("startPt", point);
    if (drawingMode === "select")
      State.set("selectionBox", {
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      });
    return;
  }
}

function handleCanvasMove(e) {
  if (State.get("cameraMode")) {
    if (UI.elems.tooltip) UI.elems.tooltip.style.display = "none";
    if (isPanning) {
      const dx = e.clientX - panStartScreen.x;
      const dy = e.clientY - panStartScreen.y;

      const canvas = UI.elems.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const zoom = State.get("cameraZoom") || 1;
      State.set("cameraOffset", {
        x: panStartOffset.x + (dx * scaleX) / zoom,
        y: panStartOffset.y + (dy * scaleY) / zoom,
      });
    }
    return; // Block editing/hover updates
  }

  const point = pointFromEventOnCanvas(e);
  const lastPoint = State.get("mouse");
  if (point.x !== lastPoint.x || point.y !== lastPoint.y) {
    mouseMovedSinceDown = true;
  }
  State.set("mouse", point);

  const drawingShape = State.get("drawingShape");
  if (
    drawingShape &&
    drawingShape.type === "poly" &&
    drawingShape.vertices.length > 0
  ) {
    drawingShape.preview = point;
    State.set("drawingShape", drawingShape);
  }

  if (isDraggingVertex && vertexDrag) {
    mouseMovedSinceDown = true;
    const { objectId, vertexIndex, originalObject, originalAbsVertices } =
      vertexDrag;

    // Relaxed clamp allows editing securely even far off-screen
    const clampedPoint = {
      x: Math.max(-15000, Math.min(15000, point.x)),
      y: Math.max(-15000, Math.min(15000, point.y)),
    };

    const absVerts = originalAbsVertices.map((v, i) =>
      i === vertexIndex
        ? { x: clampedPoint.x, y: clampedPoint.y }
        : { x: v.x, y: v.y },
    );

    const center = calculatePolygonCenter(absVerts);
    const relativeVerts = localVerticesFromAbsolute(
      absVerts,
      center,
      originalObject.a || 0,
      originalObject.scale || 1,
    );
    const previewObj = { ...originalObject, c: center, v: relativeVerts };

    State.set("draggingPreview", {
      mouseStart: vertexDrag.mouseStart,
      originalObjects: [{ ...originalObject }],
      objects: [{ ...previewObj }],
    });
    const objs = State.get("objects") || [];
    const newObjs = objs.map((o) => (o.id === objectId ? previewObj : o));
    State.set("objects", newObjs);
    State.set("vertexDrag", { ...vertexDrag, currentAbsVerts: absVerts });
    return;
  }

  function padLabel(label, width = 7) {
    return (label + ":").padEnd(width, " ");
  }
  function padValue(value, width = 8) {
    return String(value).padStart(width, " ");
  }

  const tooltip = UI.elems.tooltip;
  if (tooltip) {
    const hoveredObject = getHoveredObject(point, State.get("objects"));
    if (hoveredObject && hoveredObject.id !== State.get("selectedObjectId")) {
      let tooltipText = "";
      if (hoveredObject.type === "line") {
        const { width, height, angle } = getLineProps(hoveredObject);
        tooltipText = [
          `${padLabel("Type")} ${padValue("Line")}`,
          `${padLabel("X")} ${padValue(hoveredObject.start.x.toFixed(1))}`,
          `${padLabel("Y")} ${padValue(hoveredObject.start.y.toFixed(1))}`,
          `${padLabel("Angle")} ${padValue(normalizeAngle(angle).toFixed(1) + "°")}`,
          `\nDouble-click to edit`,
        ].join("\n");
      } else if (hoveredObject.type === "poly") {
        const a = hoveredObject.a || 0;
        const s = hoveredObject.scale || 1;
        const vCount = hoveredObject.v ? hoveredObject.v.length : 0;
        tooltipText = [
          `${padLabel("Type")} ${padValue("Polygon")}`,
          `${padLabel("X")} ${padValue(hoveredObject.c.x.toFixed(1))}`,
          `${padLabel("Y")} ${padValue(hoveredObject.c.y.toFixed(1))}`,
          `${padLabel("Angle")} ${padValue(normalizeAngle(a).toFixed(1) + "°")}`,
          `${padLabel("Scale")} ${padValue(s.toFixed(3))}`,
          `${padLabel("Vertices")} ${padValue(vCount)}`,
          `\nDouble-click to edit`,
        ].join("\n");
      } else if (hoveredObject.type === "circle") {
        tooltipText = [
          `${padLabel("Type")} ${padValue("Circle")}`,
          `${padLabel("X")} ${padValue(hoveredObject.c.x.toFixed(1))}`,
          `${padLabel("Y")} ${padValue(hoveredObject.c.y.toFixed(1))}`,
          `${padLabel("Radius")} ${padValue(hoveredObject.radius.toFixed(1))}`,
          `\nDouble-click to edit`,
        ].join("\n");
      }
      tooltip.innerHTML = tooltipText;
      tooltip.style.display = "block";
      tooltip.style.left = `${e.clientX + 15}px`;
      tooltip.style.top = `${e.clientY + 15}px`;
    } else {
      tooltip.style.display = "none";
    }
  }

  if (State.get("drawingMode") === "poly" && State.get("drawingShape")) return;

  if (isDraggingZone) {
    const zone = State.get("zoneIndicator");
    State.set("zoneIndicator", { ...zone, x: point.x, y: point.y });
    return;
  }

  if (isDraggingSpawn) {
    const { width, height } = UI.elems.canvas;
    const spawn = State.get("spawnCircle");
    const radius = spawn.diameter / 2;
    const x = Math.max(-radius, Math.min(width + radius, point.x));
    const y = Math.max(-radius, Math.min(height + radius, point.y));
    State.set("spawnCircle", { ...spawn, x, y });
    return;
  }

  if (isDraggingCapZone) {
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const cz = State.get("capZone");
    const halfWidth = cz.width / 2;
    const halfHeight = cz.height / 2;
    const x = Math.max(-halfWidth, Math.min(canvasWidth - halfWidth, point.x));
    const y = Math.max(
      -halfHeight,
      Math.min(canvasHeight - halfHeight, point.y),
    );
    State.set("capZone", { ...cz, x, y });
    return;
  }

  if (isDraggingObject) {
    const preview = State.get("draggingPreview");
    if (!preview || !preview.originalObjects) return;
    const dx = point.x - preview.mouseStart.x;
    const dy = point.y - preview.mouseStart.y;
    const updatedObjects = preview.originalObjects.map((originalObject) => {
      let updatedObject;
      if (originalObject.type === "poly" || originalObject.type === "circle") {
        updatedObject = {
          ...originalObject,
          c: { x: originalObject.c.x + dx, y: originalObject.c.y + dy },
        };
      } else if (originalObject.type === "line") {
        updatedObject = {
          ...originalObject,
          start: {
            x: originalObject.start.x + dx,
            y: originalObject.start.y + dy,
          },
          end: { x: originalObject.end.x + dx, y: originalObject.end.y + dy },
        };
      }
      return updatedObject;
    });
    State.set("draggingPreview", { ...preview, objects: updatedObjects });
    return;
  }

  if (isDrawing) {
    const startPt = State.get("startPt");
    if (!startPt) return;

    if (State.get("drawingMode") === "select") {
      State.set("selectionBox", {
        x: Math.min(startPt.x, point.x),
        y: Math.min(startPt.y, point.y),
        width: Math.abs(startPt.x - point.x),
        height: Math.abs(startPt.y - point.y),
      });
    } else if (
      State.get("drawingMode") === "line" ||
      State.get("drawingMode") === "split"
    ) {
      State.set("drawingShape", { type: "line", start: startPt, end: point });
    } else if (State.get("drawingMode") === "circle") {
      const radius = distance(startPt, point);
      State.set("drawingShape", { type: "circle", c: startPt, radius: radius });
    }
  }
}

function handleCanvasUp(e) {
  if (State.get("cameraMode")) {
    isPanning = false;
    return;
  }

  const drawingMode = State.get("drawingMode");

  if (isDraggingVertex && vertexDrag) {
    try {
      const { objectId, originalObject } = vertexDrag;
      const preview = State.get("draggingPreview");
      const previewObj =
        preview?.objects?.find((o) => o.id === objectId) || null;

      if (previewObj) {
        const absVerts = getAbsoluteVertices(previewObj);
        if (!absVerts || absVerts.length < 3) {
          Network.deleteObject(objectId);
        } else {
          const shapeToSplit = { v: absVerts.map((p) => [p.x, p.y]) };
          const convexPolygons = splitConcaveIntoConvex(shapeToSplit);

          if (!convexPolygons || convexPolygons.length === 0) {
            Network.deleteObject(objectId);
          } else if (convexPolygons.length === 1) {
            const absoluteVertices = convexPolygons[0].v.map((p) => ({
              x: p[0],
              y: p[1],
            }));
            const validPoly = createValidPolygonObject(
              absoluteVertices,
              null,
              previewObj,
            );

            if (validPoly) {
              const objs = State.get("objects") || [];
              const updatedObjs = objs.map((o) =>
                o.id === objectId
                  ? { ...o, v: validPoly.v, c: validPoly.c }
                  : o,
              );
              State.set("objects", updatedObjs);
              Network.updateObject({
                id: objectId,
                v: validPoly.v,
                c: validPoly.c,
              });
            } else {
              Network.deleteObject(objectId);
            }
          } else {
            const polygonsToSend = convexPolygons
              .map((convexPoly) => {
                const absoluteVertices = convexPoly.v.map((p) => ({
                  x: p[0],
                  y: p[1],
                }));
                return createValidPolygonObject(
                  absoluteVertices,
                  originalObject.polyType,
                  originalObject,
                );
              })
              .filter(Boolean);

            Network.deleteObject(objectId);
            if (polygonsToSend.length > 0)
              Network.createObjectsBatch({ objects: polygonsToSend });
          }
        }
      }
    } catch (err) {
      console.error("Error committing vertex drag:", err);
    } finally {
      isDraggingVertex = false;
      vertexDrag = null;
      State.set("vertexDrag", null);
      State.set("draggingPreview", null);
      isDraggingObject = false;
    }
  }

  if (isDraggingObject) {
    const preview = State.get("draggingPreview");
    if (preview && preview.objects && mouseMovedSinceDown) {
      preview.objects.forEach((obj) => {
        let payload = { id: obj.id };
        if (obj.type === "poly" || obj.type === "circle") payload.c = obj.c;
        if (obj.type === "line") {
          payload.start = obj.start;
          payload.end = obj.end;
        }
        Network.updateObject(payload);
      });
    }
  }

  if (isDraggingSpawn) {
    const spawn = State.get("spawnCircle");
    Network.setSpawnCircle({ x: spawn.x, y: spawn.y });
  }
  if (isDraggingCapZone) {
    const cz = State.get("capZone");
    Network.setCapZone({ x: cz.x, y: cz.y });
  }

  if (isDrawing && drawingMode === "select" && mouseMovedSinceDown) {
    const selectionBox = State.get("selectionBox");
    const allObjects = State.get("objects");
    const idsToSelect = allObjects
      .filter(
        (obj) =>
          canSelectObject(obj.id) && isObjectInSelectionBox(obj, selectionBox),
      )
      .map((obj) => obj.id);

    if (e.shiftKey) idsToSelect.forEach((id) => State.addSelectedObjectId(id));
    else State.set("selectedObjectIds", idsToSelect);
  }

  if (isDrawing && drawingMode === "line") {
    const startPt = State.get("startPt");
    const endPt = State.get("mouse");
    if (startPt && distance(startPt, endPt) > 5)
      Network.createObject({ type: "line", start: startPt, end: endPt });
  }

  if (isDrawing && drawingMode === "circle") {
    const startPt = State.get("startPt");
    const endPt = State.get("mouse");
    const radius = distance(startPt, endPt);
    if (startPt && radius > 2)
      Network.createObject({ type: "circle", c: startPt, radius });
  }

  if (isDrawing && drawingMode === "split") {
    const startPt = State.get("startPt");
    const endPt = State.get("mouse");
    if (startPt && distance(startPt, endPt) > 5) {
      if (window.executeSplitShape) window.executeSplitShape(startPt, endPt);
    } else {
      showToast("Line too short to split.", true);
    }

    State.set("drawingMode", "line");
    const btn = document.getElementById("drawModeBtn");
    if (btn) btn.textContent = "Mode: Line (M)";
    UI.setStatus("Draw by dragging on canvas.");
  }

  isDraggingObject = false;
  isDraggingSpawn = false;
  isDraggingZone = false;
  isDraggingCapZone = false;
  isDrawing = false;
  State.set("startPt", null);
  State.set("selectionBox", null);
  State.set("draggingPreview", null);
  State.set("vertexDrag", null);
  State.set(
    "drawingShape",
    State.get("drawingShape")?.type === "poly"
      ? State.get("drawingShape")
      : null,
  );
}

function addPolygonPoint(point) {
  const currentShape = State.get("drawingShape");
  if (!currentShape || currentShape.type !== "poly") return;

  // Relax clamp to allow placing vertices off-screen
  const clampedPoint = {
    x: Math.max(-15000, Math.min(15000, point.x)),
    y: Math.max(-15000, Math.min(15000, point.y)),
  };

  const vertices = currentShape.vertices;
  //...
  // Check if closing the polygon
  if (vertices.length > 1 && distance(clampedPoint, vertices[0]) < 10) {
    if (vertices.length < 3) {
      // Not enough vertices, cancel drawing
      State.set("drawingShape", null);
      UI.setStatus("Polygon cancelled. Click to start a new one.");
      return;
    }

    // Finalize polygon
    const shapeToSplit = { v: vertices.map((p) => [p.x, p.y]) };
    const convexPolygons = splitConcaveIntoConvex(shapeToSplit);

    const polygonsToSend = convexPolygons
      .map((convexPoly) => {
        const absoluteVertices = convexPoly.v.map((p) => ({
          x: p[0],
          y: p[1],
        }));
        // Use the new centralized, validating function
        return createValidPolygonObject(absoluteVertices, "none"); // Assumes "none" type for drawn polys
      })
      .filter(Boolean); // .filter(Boolean) removes any 'null' results
    Network.createObjectsBatch({
      objects: polygonsToSend,
      isAutoGeneration: false,
    });
    State.set("drawingShape", null);
    UI.setStatus("Click on the canvas to start drawing a polygon.");
  } else {
    // Add a new point
    const updatedVertices = [...vertices, clampedPoint];
    State.set("drawingShape", { ...currentShape, vertices: updatedVertices });
  }
}
// --- Keyboard Handlers ---

// --- handlers.js ---

function startNudgeLoop() {
  if (nudgeLoopId) return;

  const nudgeLoop = () => {
    const selectedIds = State.get("selectedObjectIds");
    if (selectedIds.length === 0 || keysDown.size === 0) {
      stopNudgeLoop();
      return;
    }

    let dx = 0;
    let dy = 0;
    const speed = 2; // Speed of movement per frame

    if (keysDown.has("ArrowUp")) dy -= speed;
    if (keysDown.has("ArrowDown")) dy += speed;
    if (keysDown.has("ArrowLeft")) dx -= speed;
    if (keysDown.has("ArrowRight")) dx += speed;

    if (dx !== 0 || dy !== 0) {
      const objects = State.get("objects");

      // 1. Update Local State ONLY (Fixes relative drift & visual smoothness)
      const updatedObjects = objects.map((obj) => {
        if (!selectedIds.includes(obj.id)) return obj;

        // Calculate new absolute coords based on type
        if (obj.type === "poly" || obj.type === "circle") {
          return { ...obj, c: { x: obj.c.x + dx, y: obj.c.y + dy } };
        } else if (obj.type === "line") {
          return {
            ...obj,
            start: { x: obj.start.x + dx, y: obj.start.y + dy },
            end: { x: obj.end.x + dx, y: obj.end.y + dy },
          };
        }
        return obj;
      });

      State.set("objects", updatedObjects);
      // Preview geometry is kept local until the drag is committed.
    }
    nudgeLoopId = requestAnimationFrame(nudgeLoop);
  };
  nudgeLoopId = requestAnimationFrame(nudgeLoop);
}

function stopNudgeLoop() {
  if (nudgeLoopId) {
    cancelAnimationFrame(nudgeLoopId);
    nudgeLoopId = null;

    // 2. Send FINAL absolute positions to server on KeyUp
    const selectedIds = State.get("selectedObjectIds");
    const objects = State.get("objects");
    const batchPayloads = [];

    selectedIds.forEach((id) => {
      const obj = objects.find((o) => o.id === id);
      if (obj) {
        if (obj.type === "poly" || obj.type === "circle") {
          batchPayloads.push({ id, c: obj.c });
        } else if (obj.type === "line") {
          batchPayloads.push({ id, start: obj.start, end: obj.end });
        }
      }
    });

    if (batchPayloads.length > 0) {
      Network.updateObjectsBatch(batchPayloads);
    }
  }
}

function handleKeyUp(e) {
  const key = e.key.toLowerCase();
  keysDown.delete(e.key);

  // NEW: Camera Mode Key Release
  if (cameraKeysDown.has(key)) {
    cameraKeysDown.delete(key);
    if (cameraKeysDown.size === 0) stopCameraLoop();
  }

  // Handle shift key release to restore previous drawing mode
  if (e.key === "Shift" && drawingModeBeforeShift !== null) {
    State.set("drawingMode", drawingModeBeforeShift);
    // Update button text
    const btn = UI.elems.drawModeBtn;
    if (btn) {
      const capitalizedMode =
        drawingModeBeforeShift.charAt(0).toUpperCase() +
        drawingModeBeforeShift.slice(1);
      btn.textContent = `Mode: ${capitalizedMode} (M)`;
    }
    drawingModeBeforeShift = null;
  }

  if (keysDown.size === 0) {
    stopNudgeLoop();
  }
}

function handleKeyDown(e) {
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "SELECT"))
    return;
  if (!State.get("editorActive")) return;

  const key = e.key.toLowerCase();

  // NEW: Camera Mode Key Intercepts
  if (State.get("cameraMode")) {
    if (
      [
        "w",
        "a",
        "s",
        "d",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
      ].includes(key)
    ) {
      e.preventDefault();
      cameraKeysDown.add(key);
      startCameraLoop();
      return;
    }
    if (key === "=" || key === "+") {
      e.preventDefault();
      let zoom = State.get("cameraZoom");
      State.set("cameraZoom", Math.min(10, zoom * 1.1));
      return;
    }
    if (key === "-" || key === "_") {
      e.preventDefault();
      let zoom = State.get("cameraZoom");
      State.set("cameraZoom", Math.max(0.1, zoom / 1.1));
      return;
    }
  }

  // --- NEW HOTKEYS: Guaranteed to fire ---
  if (e.ctrlKey && key === "d") {
    e.preventDefault();
    if (window.toggleDrawingTool) window.toggleDrawingTool();
    return;
  }

  if (key === "o" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    if (window.toggleMoreOptions) window.toggleMoreOptions();
    return;
  }

  // Handle shift key for temporary select mode
  if (e.key === "Shift" && !keysDown.has("Shift")) {
    keysDown.add("Shift");
    const currentMode = State.get("drawingMode");
    if (currentMode !== "select") {
      drawingModeBeforeShift = currentMode;
      State.set("drawingMode", "select");
      // Update button text
      const btn = UI.elems.drawModeBtn;
      if (btn) btn.textContent = "Selecting";
    }
  }

  const selectedIds = State.get("selectedObjectIds");

  // 2) Alt + Arrow keys: prevent browser nav in specific cases
  if (
    e.altKey &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
  ) {
    const objects = State.get("objects") || [];
    const selectedObjects = objects.filter((o) => State.isSelected(o.id));

    // If no object is selected, block default navigation
    if (selectedObjects.length === 0) {
      e.preventDefault();
      return;
    }

    // If selection contains polygons but no lines, block Alt+Left/Right
    const hasLine = selectedObjects.some((o) => o.type === "line");
    const hasPoly = selectedObjects.some((o) => o.type === "poly");
    if (
      hasPoly &&
      !hasLine &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault();
      return;
    }
  }
  // Quick toggle for draw mode (M) — delegate to button handler
  if (key === "m") {
    const btn = UI.elems.drawModeBtn;
    if (btn) btn.click();
    return;
  }
  if (key === "g") {
    e.preventDefault();
    UI.show("autoGeneratePopup");
    return;
  }
  // General hotkeys
  switch (key) {
    case "a":
      if (e.ctrlKey) {
        e.preventDefault();
        const objects = State.get("objects") || [];
        const objectIds = objects
          .filter((obj) => canSelectObject(obj.id))
          .map((o) => o.id);
        State.set("selectedObjectIds", objectIds);
      }
      return; // Added missing return to prevent fall-through to 'h'
    case "c":
      if (e.metaKey || e.ctrlKey) {
        copyLineInfo();
      }
      return;
    case "v":
      if (e.metaKey || e.ctrlKey) {
        pasteLines();
      }
      return;
    case "x":
      if (State.get("drawingMode") === "poly" && State.get("drawingShape")) {
        e.preventDefault();
        State.set("drawingShape", null);
        UI.setStatus("Click to start drawing a new polygon.");
      }
      break;
    case "z":
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) window.redoMap();
        else window.undoMap();
      }
      return;
    case "y":
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        window.redoMap();
      }
      return;
  }

  if (selectedIds.length === 0) return;

  // Hotkeys for selected objects
  const objects = State.get("objects").filter((o) =>
    selectedIds.includes(o.id),
  );
  if (objects.length === 0) return;

  // If Shift+Left/Right is pressed and multiple objects are selected, rotate as a group.
  if (
    objects.length > 1 &&
    e.shiftKey &&
    (key === "arrowleft" || key === "arrowright")
  ) {
    e.preventDefault();
    const step = e.ctrlKey ? 10 : 1;
    const delta = key === "arrowleft" ? -step : step;
    handleGroupRotation(objects, delta);
    return; // Skip individual object handling
  }

  // Group Scaling Interception (Alt + Up/Down)
  if (
    objects.length > 1 &&
    e.altKey &&
    (key === "arrowup" || key === "arrowdown")
  ) {
    e.preventDefault();
    const delta = key === "arrowup" ? 0.1 : -0.1;
    handleGroupScaling(objects, delta);
    return;
  }

  if (e.key.startsWith("Arrow") && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    keysDown.add(e.key);
    startNudgeLoop();
    return;
  }

  if (key === "[") {
    e.preventDefault();
    createReorderHandler(true)(); // <-- invoke the returned function
    return;
  }
  if (key === "]") {
    e.preventDefault();
    createReorderHandler(false)(); // <-- invoke the returned function
    return;
  }

  // Type and transform hotkeys
  const isMultiSelect = selectedIds.length > 1;

  objects.forEach((object) => {
    const id = object.id;
    if (object.type === "poly") {
      if (e.shiftKey && (key === "arrowleft" || key === "arrowright")) {
        e.preventDefault();
        const step = e.ctrlKey ? 10 : 1;
        const delta = key === "arrowleft" ? -step : step;
        Network.updateObject({ id, a: Math.round(object.a || 0) + delta });
      } else if (e.altKey && (key === "arrowup" || key === "arrowdown")) {
        e.preventDefault();
        if (key === "arrowup" && object.scale >= 5) return;
        const delta = key === "arrowup" ? 0.1 : -0.1;
        const currentScale = object.scale || 1;
        Network.updateObject({
          id,
          scale: Math.round(currentScale * 100 + delta * 100) / 100,
        });
      } else {
        switch (key) {
          case "b":
            Network.updateObject({
              id,
              polyType: isMultiSelect
                ? "bouncy"
                : object.polyType === "bouncy"
                  ? "none"
                  : "bouncy",
            });
            break;
          case "d":
            Network.updateObject({
              id,
              polyType: isMultiSelect
                ? "death"
                : object.polyType === "death"
                  ? "none"
                  : "death",
            });
            break;
          case "n":
            Network.updateObject({ id, polyType: "none" });
            break;
          case "x":
          case "delete":
          case "backspace":
            Network.deleteObject(id);
            break;
        }
      }
    } else if (object.type === "circle") {
      if (e.altKey && (key === "arrowup" || key === "arrowdown")) {
        e.preventDefault();
        const delta =
          key === "arrowup" ? (e.shiftKey ? 10 : 1) : e.shiftKey ? -10 : -1;
        Network.updateObject({
          id,
          radius: Math.max(1, Math.round(object.radius || 50) + delta),
        });
      } else {
        switch (key) {
          case "b":
            Network.updateObject({
              id,
              circleType: isMultiSelect
                ? "bouncy"
                : object.circleType === "bouncy"
                  ? "none"
                  : "bouncy",
            });
            break;
          case "d":
            Network.updateObject({
              id,
              circleType: isMultiSelect
                ? "death"
                : object.circleType === "death"
                  ? "none"
                  : "death",
            });
            break;
          case "n":
            Network.updateObject({ id, circleType: "none" });
            break;
          case "x":
          case "delete":
          case "backspace":
            Network.deleteObject(id);
            break;
        }
      }
    } else if (object.type === "line") {
      if (e.altKey && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const { width, height } = getLineProps(object);
        if (key === "arrowleft" || key === "arrowright") {
          const delta = key === "arrowleft" ? -step : step;
          Network.updateObject({
            id,
            width: Math.max(1, Math.round(width) + delta),
          });
        } else if (key === "arrowup" || key === "arrowdown") {
          const delta = key === "arrowup" ? step : -step;
          Network.updateObject({
            id,
            height: Math.max(1, Math.round(height) + delta),
          });
        }
      } else if (e.shiftKey && (key === "arrowleft" || key === "arrowright")) {
        e.preventDefault();
        const step = e.ctrlKey ? 10 : 1;
        const delta = key === "arrowleft" ? -step : step;
        const { angle } = getLineProps(object);
        Network.updateObject({ id, angle: Math.round(angle) + delta });
      } else {
        switch (key) {
          case "b":
            Network.updateObject({
              id,
              lineType: isMultiSelect
                ? "bouncy"
                : object.lineType === "bouncy"
                  ? "none"
                  : "bouncy",
            });
            break;
          case "d":
            Network.updateObject({
              id,
              lineType: isMultiSelect
                ? "death"
                : object.lineType === "death"
                  ? "none"
                  : "death",
            });
            break;
          case "n":
            Network.updateObject({ id, lineType: "none" });
            break;
          case "x":
          case "delete":
          case "backspace":
            Network.deleteObject(id);
            break;
        }
      }
    }
  });
}
const createReorderHandler = (toBack) => () => {
  const selectedIds = State.get("selectedObjectIds");
  if (selectedIds.length > 0) {
    Network.reorderObjects({ ids: selectedIds, toBack });
  }
};

// public/handlers.js

function createSliderHandlerFactory(elems) {
  return (propName, type) => {
    // Generic approach: build keys from type and propName
    const uiProp = propName === "a" ? "angle" : propName;
    const capitalized = uiProp.charAt(0).toUpperCase() + uiProp.slice(1);
    const prefix = `${type}${capitalized}`; // e.g., 'lineAngle', 'polyScale', 'circleRadius'
    const sliderKey = `${prefix}Slider`;
    const valueKey = `${prefix}Value`;

    const slider = elems[sliderKey];
    const valueLabel = elems[valueKey];
    if (!slider) {
      console.warn(`Slider with key "${sliderKey}" not found in UI elements.`);
      return;
    }

    // REPLACE the old handleInput with this:
    const handleInput = () => {
      const val = slider.value;
      if (valueLabel) valueLabel.innerText = val;

      const selectedIds = State.get("selectedObjectIds");
      if (selectedIds.length === 0) return;

      let parsed = parseFloat(val);
      if (propName === "scale") parsed = parsed / 100.0;

      const objects = State.get("objects");
      let changed = false;

      objects.forEach((obj) => {
        if (selectedIds.includes(obj.id) && obj.type === type) {
          // Handle Polys and Circles (Simple properties)
          if (propName === "scale") obj.scale = parsed;
          else if (propName === "radius") obj.radius = parsed;
          else if (propName === "a") obj.a = parsed;
          else if (propName === "height") obj.height = parsed;
          // Handle Line Geometry (Width/Angle) with Center Pivot
          else if (
            type === "line" &&
            (propName === "width" || propName === "angle")
          ) {
            // 1. Calculate current center
            const cx = (obj.start.x + obj.end.x) / 2;
            const cy = (obj.start.y + obj.end.y) / 2;

            // 2. Determine current or new values
            // If property is missing on obj, calculate from coordinates
            const dx = obj.end.x - obj.start.x;
            const dy = obj.end.y - obj.start.y;

            const currentW =
              typeof obj.width === "number" ? obj.width : Math.hypot(dx, dy);
            const currentA =
              typeof obj.angle === "number"
                ? obj.angle
                : (Math.atan2(dy, dx) * 180) / Math.PI;

            const newW = propName === "width" ? parsed : currentW;
            const newA = propName === "angle" ? parsed : currentA;

            // 3. Update properties
            obj.width = newW;
            obj.angle = newA;

            // 4. Recalculate Start/End from Center
            const rad = (newA * Math.PI) / 180;
            const halfW = newW / 2;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            obj.start.x = cx - cos * halfW;
            obj.start.y = cy - sin * halfW;
            obj.end.x = cx + cos * halfW;
            obj.end.y = cy + sin * halfW;
          }
          changed = true;
        }
      });

      if (changed) State.set("objects", objects);
    };

    // handleChange: Fires on mouseup, sends the final network request
    const handleChange = () => {
      if (valueLabel) valueLabel.innerText = slider.value; // Ensure final value is set

      const selectedIds = State.get("selectedObjectIds");
      if (selectedIds.length === 0) return;

      let parsed = parseFloat(slider.value);
      if (propName === "scale") {
        parsed = parsed / 100.0;
      }

      const payload = {};
      payload[propName] = Number.isFinite(parsed) ? parsed : slider.value;

      // Send one update for each selected object
      selectedIds.forEach((id) => {
        Network.updateObject({ id, ...payload });
      });
    };

    slider.addEventListener("input", handleInput); // Updates label on drag
    slider.addEventListener("change", handleChange); // Sends network request on mouseup
  };
}

// NEW HELPER FUNCTION (for step 5)
function handleGeneratedPolygons(newPolygons) {
  if (newPolygons && newPolygons.length > 0) {
    Network.createObjectsBatch({
      objects: newPolygons,
      isAutoGeneration: true,
    });
    showToast(`Generated ${newPolygons.length} new polygons!`);
  } else {
    showToast("Polygon generation failed.", true);
  }

  // Set path to disappear after 3 seconds
  setTimeout(() => {
    State.set("generatedPath", null);
  }, 3000);
}

// NEW HELPER FUNCTION (for step 6)
function resetStatusToDefault() {
  const drawingMode = State.get("drawingMode") || "line";
  let statusText = "Draw by dragging on canvas.";
  if (drawingMode === "poly") statusText = "Click to start drawing a polygon.";
  if (drawingMode === "circle") statusText = "Click and drag to draw a circle.";
  UI.setStatus(statusText);
}

export function handleGlobalZoom(zoomFactor) {
  const objects = State.get("objects");
  if (!objects || objects.length === 0) return;

  let cx = 0,
    cy = 0,
    count = 0;
  objects.forEach((obj) => {
    if (obj.type === "poly" || obj.type === "circle") {
      cx += obj.c.x;
      cy += obj.c.y;
      count++;
    } else if (obj.type === "line") {
      cx += (obj.start.x + obj.end.x) / 2;
      cy += (obj.start.y + obj.end.y) / 2;
      count++;
    }
  });
  if (count === 0) return;
  cx /= count;
  cy /= count;

  const updatedObjects = objects.map((o) => {
    const obj = {
      ...o,
      c: o.c ? { ...o.c } : undefined,
      start: o.start ? { ...o.start } : undefined,
      end: o.end ? { ...o.end } : undefined,
    };
    if (obj.type === "poly" || obj.type === "circle") {
      obj.c = {
        x: cx + (obj.c.x - cx) * zoomFactor,
        y: cy + (obj.c.y - cy) * zoomFactor,
      };
      if (obj.type === "poly") obj.scale = (obj.scale || 1) * zoomFactor;
      if (obj.type === "circle") obj.radius = (obj.radius || 50) * zoomFactor;
    } else if (obj.type === "line") {
      const newStart = {
        x: cx + (obj.start.x - cx) * zoomFactor,
        y: cy + (obj.start.y - cy) * zoomFactor,
      };
      const newEnd = {
        x: cx + (obj.end.x - cx) * zoomFactor,
        y: cy + (obj.end.y - cy) * zoomFactor,
      };
      obj.start = newStart;
      obj.end = newEnd;
      obj.height = (obj.height || 4) * zoomFactor;
      obj.width = Math.hypot(newEnd.x - newStart.x, newEnd.y - newStart.y);
      obj.angle =
        (Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) * 180) /
        Math.PI;
    }
    return obj;
  });

  State.set("objects", updatedObjects);

  if (window._globalZoomTimeout) clearTimeout(window._globalZoomTimeout);
  window._globalZoomTimeout = setTimeout(() => {
    if (window.saveMapSnapshot) window.saveMapSnapshot();
    const latestObjs = State.get("objects");
    const batchPayloads = latestObjs.map((obj) => {
      const payload = { id: obj.id };
      if (obj.type === "poly" || obj.type === "circle") {
        payload.c = obj.c;
        if (obj.type === "poly") payload.scale = obj.scale;
        if (obj.type === "circle") payload.radius = obj.radius;
      } else if (obj.type === "line") {
        payload.start = obj.start;
        payload.end = obj.end;
        payload.height = obj.height;
        payload.width = obj.width;
        payload.angle = obj.angle;
      }
      return payload;
    });
    Network.updateObjectsBatch(batchPayloads);
  }, 300);
}

export function bindUIEvents() {
  const e = UI.elems;

  safeAddEvent(e.startDrawingBtn, "click", () => {
    State.set("editorActive", true);
    UI.hide("home");
    UI.show("canvasWrap");
  });
  safeAddEvent(e.canvas, "mousedown", handleCanvasDown);
  window.addEventListener("mousemove", handleCanvasMove);
  window.addEventListener("mouseup", handleCanvasUp);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  const sliderHandler = createSliderHandlerFactory(e);
  sliderHandler("width", "line");
  sliderHandler("height", "line");
  sliderHandler("angle", "line");
  sliderHandler("a", "poly"); // 'a' is for angle
  sliderHandler("scale", "poly");
  sliderHandler("radius", "circle");

  // single select handler (remove line/poly separate handlers)
  const createSelectHandler = () => (ev) => {
    const selectedIds = State.get("selectedObjectIds");
    const objects = State.get("objects");

    if (!selectedIds || selectedIds.length === 0) return;

    selectedIds.forEach((id) => {
      const obj = objects.find((o) => o.id === id);
      if (!obj) return;

      // infer property name based on object type
      const propName =
        obj.type === "line"
          ? "lineType"
          : obj.type === "poly"
            ? "polyType"
            : "circleType"; // Simplified logic
      Network.updateObject({ id, [propName]: ev.target.value });
    });
  };

  // hook it up once
  safeAddEvent(e.typeSelect, "change", createSelectHandler());

  const createDeleteHandler = () => () => {
    const selectedIds = State.get("selectedObjectIds");
    if (selectedIds.length > 0) {
      selectedIds.forEach((id) => Network.deleteObject(id));
    }
  };
  safeAddEvent(e.deleteBtn, "click", createDeleteHandler());

  safeAddEvent(e.duplicateBtn, "click", () => {
    const selectedIds = State.get("selectedObjectIds");
    const objects = State.get("objects");
    const toDuplicate = objects.filter((o) => selectedIds.includes(o.id));

    if (toDuplicate.length === 0) {
      showToast("No shapes selected to duplicate.", true);
      return;
    }

    const duplicated = toDuplicate.map((obj) => {
      const newObj = JSON.parse(JSON.stringify(obj));
      delete newObj.id;
      // Offset removed - objects duplicate perfectly in place
      return newObj;
    });

    Network.createObjectsBatch({
      objects: duplicated,
      isAutoGeneration: false,
    });
    showToast(`Duplicated ${duplicated.length} object(s).`);
  });

  safeAddEvent(e.toFrontBtn, "click", createReorderHandler(false));
  safeAddEvent(e.toBackBtn, "click", createReorderHandler(true));
  safeAddEvent(e.polyToFrontBtn, "click", createReorderHandler(false));
  safeAddEvent(e.polyToBackBtn, "click", createReorderHandler(true));

  safeAddEvent(e.copyMapBtn, "click", () => copyLineInfo());
  safeAddEvent(e.pasteMapBtn, "click", () => pasteLines());

  // Find this block around line 832 and replace it:
  safeAddEvent(e.spawnSizeSlider, "input", (ev) => {
    const size = parseInt(ev.target.value, 10);
    if (e.spawnSizeValue) e.spawnSizeValue.innerText = size;
    // ADD THIS LINE to update visual diameter immediately
    State.set("mapSize", size);
  });
  safeAddEvent(e.spawnSizeSlider, "change", (ev) => {
    const size = parseInt(ev.target.value, 10);
    Network.setMapSize(size);
  });

  safeAddEvent(e.drawModeBtn, "click", () => {
    const modes = ["line", "poly", "circle"]; // Exclude "select" from toggle cycle
    const currentMode = State.get("drawingMode") || "line";

    // If currently in select mode (from shift), use the mode before shift
    const modeToToggleFrom = drawingModeBeforeShift || currentMode;

    const currentIndex = modes.indexOf(modeToToggleFrom);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    State.set("drawingMode", nextMode);
    e.drawModeBtn.textContent = `Mode: ${nextMode.charAt(0).toUpperCase() + nextMode.slice(1)} (M)`;

    // If we were in shift-select mode, update the mode to return to
    if (drawingModeBeforeShift !== null) {
      drawingModeBeforeShift = nextMode;
    }

    State.clearSelectedObjects();
    State.set("drawingShape", null);
  });

  safeAddEvent(e.changeColorsBtn, "click", () => {
    console.log("Change Colors button clicked");
    Network.changeColors();
  });

  // --- Replace this handler ---
  safeAddEvent(e.autoGenerateBtn, "click", () => {
    // Now just shows the popup
    UI.show("autoGeneratePopup");
  });

  // --- AUTO GENERATE POPUP HANDLERS ---

  // --- POPUP HANDLERS ---
  safeAddEvent(e.agpCloseBtn, "click", () => UI.hide("autoGeneratePopup"));
  safeAddEvent(e.autoGeneratePopup, "click", (ev) => {
    if (ev.target === e.autoGeneratePopup) UI.hide("autoGeneratePopup");
  });

  

  // Bind Individual Color Randomizer Buttons
  ["none", "bouncy", "death", "background"].forEach((type) => {
    safeAddEvent(e[`btnColor-${type}`], "click", () => {
      Network.changeSpecificColor(type);
    });
  });

  // Add this Double Click Editor Logic
  safeAddEvent(e.canvas, "dblclick", (ev) => {
    const point = pointFromEventOnCanvas(ev);
    const objects = State.get("objects") || [];
    const hitObjectId = getHitObjectId(point, objects);
    if (hitObjectId && canSelectObject(hitObjectId)) {
      const obj = objects.find((o) => o.id === hitObjectId);
      openEditShapePopup(obj);
    }
  });

  function openEditShapePopup(obj) {
    let popup = document.getElementById("editShapePopup");
    if (!popup) {
      popup = document.createElement("div");
      popup.id = "editShapePopup";
      popup.className = "popup-overlay";
      popup.style.zIndex = "3000";
      popup.innerHTML = `
              <div class="popup-box" style="width: 320px;">
                  <h3 style="margin-bottom: 15px;">Edit Attributes</h3>
                  <div id="editShapeInputs" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;"></div>
                  <div class="popup-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
                      <button id="editShapeCancel" class="btn" style="background: transparent; border: 1px solid #555;">Cancel</button>
                      <button id="editShapeSave" class="btn" style="background: #4ade80; color: #000;">Save</button>
                  </div>
              </div>
          `;
      document.body.appendChild(popup);
      popup.addEventListener("mousedown", (ev) => {
        if (ev.target === popup) popup.classList.add("hidden");
      });
      document
        .getElementById("editShapeCancel")
        .addEventListener("click", () => popup.classList.add("hidden"));
    }

    const inputsContainer = document.getElementById("editShapeInputs");
    inputsContainer.innerHTML = "";

    const createInput = (label, id, value, min = null, max = null) => {
      const row = document.createElement("div");
      row.style =
        "display: flex; justify-content: space-between; align-items: center;";
      row.innerHTML = `<label for="${id}" style="font-size: 13px; color: #ccc;">${label}</label>
                           <input type="number" id="${id}" value="${Number(value).toFixed(3)}" step="0.001" ${min !== null ? `min="${min}"` : ""} ${max !== null ? `max="${max}"` : ""} style="width: 120px; padding: 4px; background: #222; border: 1px solid #444; color: #fff; border-radius: 3px; font-family: monospace;">`;
      inputsContainer.appendChild(row);
    };

    if (obj.type === "line") {
      const props = getLineProps(obj);
      const cx = (obj.start.x + computeEnd(obj).x) / 2;
      const cy = (obj.start.y + computeEnd(obj).y) / 2;
      createInput("Center X", "editX", cx);
      createInput("Center Y", "editY", cy);
      createInput("Width", "editW", props.width, 1);
      createInput("Height", "editH", props.height, 1);
      createInput(
        "Angle (0-360)",
        "editA",
        normalizeAngle(props.angle),
        0,
        360,
      );
    } else if (obj.type === "poly") {
      createInput("Center X", "editX", obj.c.x);
      createInput("Center Y", "editY", obj.c.y);
      createInput("Scale", "editS", obj.scale || 1, 0.1);
      createInput("Angle (0-360)", "editA", normalizeAngle(obj.a || 0), 0, 360);
    } else if (obj.type === "circle") {
      createInput("Center X", "editX", obj.c.x);
      createInput("Center Y", "editY", obj.c.y);
      createInput("Radius", "editR", obj.radius || 50, 1);
    }

    popup.classList.remove("hidden");

    const saveBtn = document.getElementById("editShapeSave");
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener("click", () => {
      const currentObjs = State.get("objects");
      if (!currentObjs.find((o) => o.id === obj.id)) {
        showToast("Error: Shape no longer exists.", true);
        popup.classList.add("hidden");
        return;
      }

      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) : 0;
      };
      const payload = { id: obj.id };

      if (obj.type === "line") {
        const cx = getVal("editX");
        const cy = getVal("editY");
        const w = Math.max(1, getVal("editW"));
        const h = Math.max(1, getVal("editH"));
        const a = normalizeAngle(getVal("editA"));

        const rad = (a * Math.PI) / 180;
        const halfW = w / 2;
        payload.start = {
          x: cx - Math.cos(rad) * halfW,
          y: cy - Math.sin(rad) * halfW,
        };
        payload.end = {
          x: cx + Math.cos(rad) * halfW,
          y: cy + Math.sin(rad) * halfW,
        };
        payload.width = w;
        payload.height = h;
        payload.angle = a;
      } else if (obj.type === "poly") {
        payload.c = { x: getVal("editX"), y: getVal("editY") };
        payload.scale = Math.max(0.1, getVal("editS"));
        payload.a = normalizeAngle(getVal("editA"));
      } else if (obj.type === "circle") {
        payload.c = { x: getVal("editX"), y: getVal("editY") };
        payload.radius = Math.max(1, getVal("editR"));
      }

      Network.updateObject(payload);
      popup.classList.add("hidden");
      showToast("Shape updated via editor.");
    });
  }

  // Replace Shading Checkbox Handlers with Independent Broadcasts
  const updateShades = (type, checked) => {
    Network.toggleShades({ type, state: checked });
  };

  if (e.cbUseShades)
    safeAddEvent(e.cbUseShades, "change", (ev) =>
      updateShades("none", ev.target.checked),
    );
  if (e.cbShadeDeath)
    safeAddEvent(e.cbShadeDeath, "change", (ev) =>
      updateShades("death", ev.target.checked),
    );
  if (e.cbShadeBouncy)
    safeAddEvent(e.cbShadeBouncy, "change", (ev) =>
      updateShades("bouncy", ev.target.checked),
    );

  // ==========================================
  // CONTINUOUS DRAWING & MORE OPTIONS LOGIC
  // ==========================================

  let isDrawingToolActive = false;

  window.toggleDrawingTool = function () {
    isDrawingToolActive = !isDrawingToolActive;

    if (e.agpDrawBtn) {
      e.agpDrawBtn.textContent = `Toggle Drawing: ${isDrawingToolActive ? "ON" : "OFF"} (Ctrl+D)`;
      e.agpDrawBtn.style.backgroundColor = isDrawingToolActive ? "#28a745" : "";
    }

    if (isDrawingToolActive) {
      import("./drawing-tool.js").then((module) => {
        const thickness = e.drawingThicknessSlider
          ? parseInt(e.drawingThicknessSlider.value, 10)
          : 20;
        module.enableDrawingTool(thickness);
      });
      UI.setStatus(
        "Continuous Drawing ON. Click and drag to paint. Press Esc to stop.",
      );
    } else {
      import("./drawing-tool.js").then((module) => {
        module.disableDrawingTool();
      });
      UI.setStatus("Continuous Drawing OFF.");
    }
  };

  safeAddEvent(e.agpDrawBtn, "click", window.toggleDrawingTool);

  

  // Live Thickness Slider Handler
  safeAddEvent(e.drawingThicknessSlider, "input", (ev) => {
    const val = ev.target.value;
    if (e.drawingThicknessVal) e.drawingThicknessVal.innerText = val;
    if (isDrawingToolActive) {
      import("./drawing-tool.js").then((module) =>
        module.setStrokeThickness(val),
      );
    }
  });

 // --- BULLETPROOF TOGGLE MORE OPTIONS ---
  window.toggleMoreOptions = function (show) {
	  show = true
    const panel = e.optionsPanel || document.querySelector(".options-panel");
    if (!panel) return;
    
    if (typeof show === "boolean") {
      if (show) panel.classList.remove("hidden");
      else panel.classList.add("hidden");
    } else {
      panel.classList.toggle("hidden");
    }
  };

  if (e.moreOptionsTrigger) {
    const newTrigger = e.moreOptionsTrigger.cloneNode(true);
    e.moreOptionsTrigger.parentNode.replaceChild(newTrigger, e.moreOptionsTrigger);
    
    newTrigger.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.toggleMoreOptions(); 
    });
  }

  // CRITICAL: Prevent clicks inside the panel from bubbling to the canvas/document
  const panelEl = e.optionsPanel || document.querySelector(".options-panel");
  if (panelEl) {
    panelEl.addEventListener("click", (ev) => ev.stopPropagation());
    panelEl.addEventListener("mousedown", (ev) => ev.stopPropagation());
  }

  safeAddEvent(e.moreOptionsTrigger, "click", () =>
    window.toggleMoreOptions(),
  );

  // Use perfect mathematical reciprocals to prevent cumulative map distortion
  safeAddEvent(e.btnZoomIn, "click", () => handleGlobalZoom(1.05));
  safeAddEvent(e.btnZoomOut, "click", () => handleGlobalZoom(1 / 1.05));

  // --- ROBUST CONTEXT-AWARE MAP MODIFIERS ENGINE ---
  const applyMapModifier = (btnId, actionName, validationFn, processFn) => {
    const oldBtn = document.getElementById(btnId);
    if (!oldBtn) return;

    // CRITICAL FIX: Destroy hidden, duplicate event listeners by replacing the DOM node.
    // This prevents the action from executing instantly in the background before confirmation.
    const btn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(btn, oldBtn);

    safeAddEvent(btn, "click", () => {
      if (window.toggleMoreOptions) window.toggleMoreOptions();

      const objects = State.get("objects") || [];

      // 1. Mathematically verify which shapes ACTUALLY need modifying
      const allRelevant = objects.filter(validationFn);

      if (allRelevant.length === 0) {
        showToast(`No shapes found that require '${actionName}'.`, true);
        return;
      }

      const currentSelectedIds = State.get("selectedObjectIds") || [];
      let targetObjects = [];

      // 2. Filter down to selection if the user has things selected
      if (currentSelectedIds.length > 0) {
        targetObjects = allRelevant.filter((o) =>
          currentSelectedIds.includes(o.id),
        );
        if (targetObjects.length === 0) {
          showToast(
            `None of your selected shapes require '${actionName}'.`,
            true,
          );
          return;
        }
      } else {
        targetObjects = allRelevant;
        State.set(
          "selectedObjectIds",
          targetObjects.map((o) => o.id),
        );
      }

      const promptMessage = `Apply '${actionName}' to the ${targetObjects.length} highlighted shape(s)? (You can adjust selection)`;

      showToastWithButtons(promptMessage, [
        {
          name: "Confirm",
          onClick: () => {
            const liveSelectedIds = State.get("selectedObjectIds") || [];
            const finalTargets = allRelevant.filter((o) =>
              liveSelectedIds.includes(o.id),
            );

            if (finalTargets.length === 0) {
              showToast(
                "Action aborted: No valid shapes remained selected.",
                true,
              );
              return;
            }

            if (window.saveMapSnapshot) window.saveMapSnapshot();
            processFn(finalTargets);
          },
        },
      ]);
    });
  };

  // 1. Fix Y Slants
  applyMapModifier(
    "btnFixY",
    "Fix Y Slants",
    (obj) => {
      if (obj.type !== "poly" || !canSelectObject(obj.id)) return false;
      const abs = getAbsoluteVertices(obj);
      if (abs.length !== 4) return false;
      const sorted = [...abs].sort((a, b) => a.y - b.y);
      const topDiff = Math.abs(sorted[0].y - sorted[1].y);
      const botDiff = Math.abs(sorted[2].y - sorted[3].y);
      return (topDiff > 0.01 && topDiff < 5) || (botDiff > 0.01 && botDiff < 5);
    },
    (targets) => {
      const batch = [];
      targets.forEach((obj) => {
        const abs = getAbsoluteVertices(obj);
        const sortedByY = [...abs].sort((a, b) => a.y - b.y);
        const topPair = [sortedByY[0], sortedByY[1]].sort((a, b) => a.x - b.x);
        const bottomPair = [sortedByY[2], sortedByY[3]].sort(
          (a, b) => a.x - b.x,
        );

        let newTL = { ...topPair[0] },
          newTR = { ...topPair[1] };
        let newBL = { ...bottomPair[0] },
          newBR = { ...bottomPair[1] };

        const topDiff = Math.abs(newTL.y - newTR.y);
        if (topDiff > 0.01 && topDiff < 5) {
          const targetY = Math.max(newTL.y, newTR.y);
          newTL.y = targetY;
          newTR.y = targetY;
        }
        const botDiff = Math.abs(newBL.y - newBR.y);
        if (botDiff > 0.01 && botDiff < 5) {
          const targetY = Math.min(newBL.y, newBR.y);
          newBL.y = targetY;
          newBR.y = targetY;
        }

        const fixedAbs = abs.map((v) => {
          if (v === topPair[0]) return newTL;
          if (v === topPair[1]) return newTR;
          if (v === bottomPair[0]) return newBL;
          if (v === bottomPair[1]) return newBR;
          return v;
        });
        const validPoly = createValidPolygonObject(fixedAbs, obj.polyType, obj);
        if (validPoly)
          batch.push({
            id: obj.id,
            v: validPoly.v,
            c: validPoly.c,
            a: validPoly.a,
            scale: validPoly.scale,
          });
      });
      Network.updateObjectsBatch(batch);
      showToast(`Fixed ${batch.length} polygons.`);
    },
  );

  // 2. Fix X Slants
  applyMapModifier(
    "btnFixX",
    "Fix X Slants",
    (obj) => {
      if (obj.type !== "poly" || !canSelectObject(obj.id)) return false;
      const abs = getAbsoluteVertices(obj);
      if (abs.length !== 4) return false;
      const sorted = [...abs].sort((a, b) => a.x - b.x);
      const leftDiff = Math.abs(sorted[0].x - sorted[1].x);
      const rightDiff = Math.abs(sorted[2].x - sorted[3].x);
      return (
        (leftDiff > 0.01 && leftDiff < 2) || (rightDiff > 0.01 && rightDiff < 2)
      );
    },
    (targets) => {
      const batch = [];
      targets.forEach((obj) => {
        const abs = getAbsoluteVertices(obj);
        const sortedByX = [...abs].sort((a, b) => a.x - b.x);
        const leftPair = [sortedByX[0], sortedByX[1]].sort((a, b) => a.y - b.y);
        const rightPair = [sortedByX[2], sortedByX[3]].sort(
          (a, b) => a.y - b.y,
        );

        let newTL = { ...leftPair[0] },
          newBL = { ...leftPair[1] };
        let newTR = { ...rightPair[0] },
          newBR = { ...rightPair[1] };

        const leftDiff = Math.abs(newTL.x - newBL.x);
        if (leftDiff > 0.01 && leftDiff < 2) {
          const targetX = Math.max(newTL.x, newBL.x);
          newTL.x = targetX;
          newBL.x = targetX;
        }
        const rightDiff = Math.abs(newTR.x - newBR.x);
        if (rightDiff > 0.01 && rightDiff < 2) {
          const targetX = Math.min(newTR.x, newBR.x);
          newTR.x = targetX;
          newBR.x = targetX;
        }

        const fixedAbs = abs.map((v) => {
          if (v === leftPair[0]) return newTL;
          if (v === leftPair[1]) return newBL;
          if (v === rightPair[0]) return newTR;
          if (v === rightPair[1]) return newBR;
          return v;
        });
        const validPoly = createValidPolygonObject(fixedAbs, obj.polyType, obj);
        if (validPoly)
          batch.push({
            id: obj.id,
            v: validPoly.v,
            c: validPoly.c,
            a: validPoly.a,
            scale: validPoly.scale,
          });
      });
      Network.updateObjectsBatch(batch);
      showToast(`Fixed ${batch.length} polygons.`);
    },
  );

  // 3. Straighten Lines
  const getTargetAngle = (angle) => {
    const n = normalizeAngle(angle);
    if ((n > 0.01 && n <= 2) || (n >= 358 && n < 359.99)) return 0;
    if (n >= 88 && n <= 92 && n !== 90) return 90;
    if (n >= 178 && n <= 182 && n !== 180) return 180;
    if (n >= 268 && n <= 272 && n !== 270) return 270;
    return null;
  };

  applyMapModifier(
    "btnStraightenLines",
    "Straighten Lines",
    (obj) =>
      obj.type === "line" &&
      canSelectObject(obj.id) &&
      getTargetAngle(getLineProps(obj).angle) !== null,
    (targets) => {
      const batchPayloads = [];
      targets.forEach((obj) => {
        const { width, angle } = getLineProps(obj);
        const targetAngle = getTargetAngle(angle);

        const start = obj.start;
        const end =
          typeof obj.width === "number" && typeof obj.angle === "number"
            ? {
                x: start.x + Math.cos((angle * Math.PI) / 180) * width,
                y: start.y + Math.sin((angle * Math.PI) / 180) * width,
              }
            : obj.end;

        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        const rad = (targetAngle * Math.PI) / 180;
        const halfW = width / 2;

        batchPayloads.push({
          id: obj.id,
          angle: targetAngle,
          width: width,
          start: {
            x: cx - Math.cos(rad) * halfW,
            y: cy - Math.sin(rad) * halfW,
          },
          end: { x: cx + Math.cos(rad) * halfW, y: cy + Math.sin(rad) * halfW },
        });
      });
      Network.updateObjectsBatch(batchPayloads);
      showToast(`Straightened ${batchPayloads.length} lines.`);
    },
  );

  // 4. Lines to Polygons
  applyMapModifier(
    "btnLinesToPolys",
    "Convert Lines to Polys",
    (obj) => obj.type === "line" && canSelectObject(obj.id),
    (targets) => {
      const newPolys = [];
      const idsToDelete = [];

      targets.forEach((obj) => {
        const start = obj.start;
        const end =
          typeof obj.width === "number" && typeof obj.angle === "number"
            ? {
                x: start.x + Math.cos((obj.angle * Math.PI) / 180) * obj.width,
                y: start.y + Math.sin((obj.angle * Math.PI) / 180) * obj.width,
              }
            : obj.end;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.hypot(dx, dy);
        const h = (obj.height || 4) / 2;

        if (len === 0) return;

        const nx = (-dy / len) * h;
        const ny = (dx / len) * h;
        const corners = [
          { x: start.x + nx, y: start.y + ny },
          { x: start.x - nx, y: start.y - ny },
          { x: end.x - nx, y: end.y - ny },
          { x: end.x + nx, y: end.y + ny },
        ];

        const polyObj = createValidPolygonObject(
          corners,
          obj.lineType || "none",
          obj,
        );
        if (polyObj) {
          newPolys.push(polyObj);
          idsToDelete.push(obj.id);
        }
      });
      Network.createObjectsBatch({
        objects: newPolys,
        isAutoGeneration: false,
      });
      idsToDelete.forEach((id) => Network.deleteObject(id));
      showToast(`Converted ${newPolys.length} lines to polygons.`);
    },
  );

  // 5. Lines to Curved Polygons
  applyMapModifier(
    "btnLinesToCurvedPolys",
    "Curve Lines",
    (obj) =>
      obj.type === "line" &&
      !obj.isFloor &&
      !obj.isCapzone &&
      canSelectObject(obj.id),
    (targets) => {
      const newPolys = [];
      const idsToDelete = [];

      targets.forEach((line) => {
        let cx, cy, halfL, halfH, angle;
        const start = line.start;
        const end =
          typeof line.width === "number" && typeof line.angle === "number"
            ? {
                x:
                  start.x + Math.cos((line.angle * Math.PI) / 180) * line.width,
                y:
                  start.y + Math.sin((line.angle * Math.PI) / 180) * line.width,
              }
            : line.end;

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) return;

        angle = Math.atan2(dy, dx);
        halfL = length / 2;
        halfH = (line.height || 4) / 2;
        cx = start.x + dx / 2;
        cy = start.y + dy / 2;

        if (halfH > halfL) {
          const temp = halfL;
          halfL = halfH;
          halfH = temp;
          angle += Math.PI / 2;
        }
        const capRadiusX = Math.min(halfL, halfH * 0.8);
        const capSteps = Math.max(6, Math.min(12, Math.ceil(capRadiusX * 0.3)));
        const rightCapCenterX = halfL - capRadiusX;
        const leftCapCenterX = -halfL + capRadiusX;
        const verts = [];

        for (let i = 0; i <= capSteps; i++) {
          const theta = -Math.PI / 2 + (i / capSteps) * Math.PI;
          verts.push({
            x: rightCapCenterX + Math.cos(theta) * capRadiusX,
            y: Math.sin(theta) * halfH,
          });
        }
        for (let i = 0; i <= capSteps; i++) {
          const theta = Math.PI / 2 + (i / capSteps) * Math.PI;
          const px = leftCapCenterX + Math.cos(theta) * capRadiusX;
          const py = Math.sin(theta) * halfH;
          if (
            verts.length === 0 ||
            Math.hypot(
              px - verts[verts.length - 1].x,
              py - verts[verts.length - 1].y,
            ) > 0.01
          ) {
            verts.push({ x: px, y: py });
          }
        }
        if (
          verts.length > 0 &&
          Math.hypot(
            verts[0].x - verts[verts.length - 1].x,
            verts[0].y - verts[verts.length - 1].y,
          ) < 0.01
        )
          verts.pop();

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const absoluteVertices = verts.map((v) => ({
          x: cx + v.x * cosA - v.y * sinA,
          y: cy + v.x * sinA + v.y * cosA,
        }));

        const polyObj = createValidPolygonObject(
          absoluteVertices,
          line.lineType || "none",
          line,
        );
        if (polyObj) {
          if (line.color !== undefined) polyObj.color = line.color;
          if (line.isDeath !== undefined) polyObj.isDeath = line.isDeath;
          if (line.isBouncy !== undefined) polyObj.isBouncy = line.isBouncy;
          if (line.bounciness !== undefined)
            polyObj.bounciness = line.bounciness;
          if (line.isBgLine !== undefined) polyObj.isBgLine = line.isBgLine;
          if (line.noGrapple !== undefined) polyObj.noGrapple = line.noGrapple;
          if (line.noPhysics !== undefined) polyObj.noPhysics = line.noPhysics;
          newPolys.push(polyObj);
          idsToDelete.push(line.id);
        }
      });

      Network.createObjectsBatch({
        objects: newPolys,
        isAutoGeneration: false,
      });
      idsToDelete.forEach((id) => Network.deleteObject(id));
      showToast(`Converted ${newPolys.length} lines to curved polygons.`);
    },
  );

  // 6. Curve Polygons
  applyMapModifier(
    "btnCurvePolygons",
    "Curve Polygons",
    (obj) => {
      if (obj.type !== "poly" || !canSelectObject(obj.id)) return false;
      const abs = getAbsoluteVertices(obj);
      if (abs.length < 3) return false;
      for (let i = 0; i < abs.length; i++) {
        const prev = abs[(i - 1 + abs.length) % abs.length];
        const curr = abs[i];
        const next = abs[(i + 1) % abs.length];
        const d1 = Math.hypot(prev.x - curr.x, prev.y - curr.y);
        const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
        if (d1 === 0 || d2 === 0) continue;
        const dot = Math.max(
          -1,
          Math.min(
            1,
            ((prev.x - curr.x) * (next.x - curr.x) +
              (prev.y - curr.y) * (next.y - curr.y)) /
              (d1 * d2),
          ),
        );
        if (Math.acos(dot) < 150 * (Math.PI / 180)) return true; // Has sharp corner
      }
      return false;
    },
    (targets) => {
      const batchPayloads = [];

      targets.forEach((poly) => {
        const absVerts = getAbsoluteVertices(poly);
        const newVerts = [];
        const n = absVerts.length;

        for (let i = 0; i < n; i++) {
          const prev = absVerts[(i - 1 + n) % n],
            curr = absVerts[i],
            next = absVerts[(i + 1) % n];
          const dx1 = prev.x - curr.x,
            dy1 = prev.y - curr.y;
          const dx2 = next.x - curr.x,
            dy2 = next.y - curr.y;
          const len1 = Math.hypot(dx1, dy1),
            len2 = Math.hypot(dx2, dy2);

          if (len1 === 0 || len2 === 0) {
            newVerts.push(curr);
            continue;
          }

          const u = { x: dx1 / len1, y: dy1 / len1 };
          const w = { x: dx2 / len2, y: dy2 / len2 };
          const dot = Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y));
          const angle = Math.acos(dot);

          if (angle < 150 * (Math.PI / 180)) {
            const d = Math.min(len1 / 2.1, len2 / 2.1, 15);
            const b1 = { x: curr.x + u.x * d, y: curr.y + u.y * d };
            const b2 = { x: curr.x + w.x * d, y: curr.y + w.y * d };

            for (let t = 0; t <= 1; t += 0.25) {
              const mt = 1 - t;
              const px = mt * mt * b1.x + 2 * mt * t * curr.x + t * t * b2.x;
              const py = mt * mt * b1.y + 2 * mt * t * curr.y + t * t * b2.y;
              if (
                newVerts.length > 0 &&
                Math.hypot(
                  px - newVerts[newVerts.length - 1].x,
                  py - newVerts[newVerts.length - 1].y,
                ) < 0.1
              )
                continue;
              newVerts.push({ x: px, y: py });
            }
          } else newVerts.push(curr);
        }

        if (
          newVerts.length > 2 &&
          Math.hypot(
            newVerts[0].x - newVerts[newVerts.length - 1].x,
            newVerts[0].y - newVerts[newVerts.length - 1].y,
          ) < 0.1
        )
          newVerts.pop();
        const polyObj = createValidPolygonObject(
          newVerts,
          poly.polyType || "none",
          poly,
        );
        if (polyObj)
          batchPayloads.push({
            id: poly.id,
            v: polyObj.v,
            c: polyObj.c,
            a: polyObj.a,
            scale: polyObj.scale,
          });
      });
      Network.updateObjectsBatch(batchPayloads);
      showToast(`Smoothed sharp corners on ${batchPayloads.length} polygons.`);
    },
  );

  // 7. Delete OOB
  applyMapModifier(
    "btnDelOOB",
    "Delete Out-of-Bounds",
    (obj) => {
      if (!canSelectObject(obj.id)) return false;
      const canvas = UI.elems.canvas;
      const cw = canvas.width || 800;
      const ch = canvas.height || 600;
      if (obj.type === "poly") {
        const abs = getAbsoluteVertices(obj);
        return abs.every((v) => v.x < 0 || v.x > cw || v.y < 0 || v.y > ch);
      } else if (obj.type === "line") {
        const end =
          typeof obj.width === "number" && typeof obj.angle === "number"
            ? {
                x:
                  obj.start.x +
                  Math.cos((obj.angle * Math.PI) / 180) * obj.width,
                y:
                  obj.start.y +
                  Math.sin((obj.angle * Math.PI) / 180) * obj.width,
              }
            : obj.end;
        return (
          (obj.start.x < 0 ||
            obj.start.x > cw ||
            obj.start.y < 0 ||
            obj.start.y > ch) &&
          (end.x < 0 || end.x > cw || end.y < 0 || end.y > ch)
        );
      } else if (obj.type === "circle") {
        return (
          obj.c.x + obj.radius < 0 ||
          obj.c.x - obj.radius > cw ||
          obj.c.y + obj.radius < 0 ||
          obj.c.y - obj.radius > ch
        );
      }
      return false;
    },
    (targets) => {
      let deletedCount = 0;
      targets.forEach((obj) => {
        Network.deleteObject(obj.id);
        deletedCount++;
      });
      State.clearSelectedObjects();
      showToast(`Deleted ${deletedCount} OOB objects.`);
    },
  );

  // 8. Merge Convex Polygons
  applyMapModifier(
    "btnMergePolys",
    "Merge Polygons",
    (obj) => obj.type === "poly" && canSelectObject(obj.id),
    (targets) => {
      // Verify we have at least 2 shapes to attempt merge
      if (targets.length < 2) {
        showToast("At least 2 polygons must be highlighted to merge.", true);
        return;
      }
      const result = window.mergeClosePolygons(targets);
      if (result && result.success)
        showToast(
          `Merged ${result.mergedCount} polygons into ${result.createdCount} structures.`,
        );
      else showToast("Selected polygons do not perfectly share edges.", true);
    },
  );

  // --- SELECT BY TYPE ---
  ['none', 'bouncy', 'death'].forEach(type => {
      const btnId = type === 'none' ? 'btnSelectNormal' : `btnSelect${type.charAt(0).toUpperCase() + type.slice(1)}`;
      const btn = document.getElementById(btnId);

      if (btn) {
          safeAddEvent(btn, 'click', () => {
              if (window.toggleMoreOptions) window.toggleMoreOptions();

              const objects = State.get("objects") || [];
              const targets = objects.filter(obj => {
                  if (!canSelectObject(obj.id)) return false;

                  // Ignore map bounds/zones
                  if (obj.isBgLine || obj.isZone || obj.isZoneIndicator || obj.isCapzone) return false;

                  const objType = obj.polyType || obj.lineType || obj.circleType || 'none';
                  return objType === type;
              });

              if (targets.length === 0) {
                  showToast(`No editable ${type === 'none' ? 'normal' : type} shapes found.`, true);
                  return;
              }

              State.set("selectedObjectIds", targets.map(o => o.id));
              showToast(`Highlighted ${targets.length} ${type === 'none' ? 'normal' : type} shape(s).`);
          });
      }
  });
  
  // --- BULK CONVERTER ---
  safeAddEvent(document.getElementById("btnBulkConvert"), "click", () => {
    const fromType = document.getElementById("bulkConvertFrom").value;
    const toType = document.getElementById("bulkConvertTo").value;
    const objects = State.get("objects");
    const batchPayloads = [];

    objects.forEach((obj) => {
      if (!canSelectObject(obj.id)) return;
      const currentType =
        obj.polyType || obj.lineType || obj.circleType || "none";
      if (fromType === "all" || currentType === fromType) {
        const payload = { id: obj.id };
        if (obj.type === "poly") payload.polyType = toType;
        else if (obj.type === "line") payload.lineType = toType;
        else if (obj.type === "circle") payload.circleType = toType;
        batchPayloads.push(payload);
      }
    });

    if (batchPayloads.length > 0) {
      Network.updateObjectsBatch(batchPayloads);
      showToast(`Converted ${batchPayloads.length} shapes to ${toType}.`);
      window.toggleMoreOptions();
    } else {
      showToast(`No editable ${fromType} shapes found.`, true);
    }
  });

  // --- SPLIT SHAPE ENGINE ---
  safeAddEvent(document.getElementById("btnSplitShape"), "click", () => {
    window.toggleMoreOptions();
    const selectedIds = State.get("selectedObjectIds");
    if (selectedIds.length === 0) {
      showToast("Please select at least one shape to split.", true);
      return;
    }
    State.set("drawingMode", "split");
    UI.setStatus("Draw a line across the shape to split it.");
  });

  window.executeSplitShape = (p1, p2) => {
    console.log("=== SPLIT SHAPE ENGINE LOG ===");
    console.log("1. Input Line:", p1, p2);

    if (typeof window.polygonClipping === "undefined") {
      showToast("Polygon clipping library missing.", true);
      return;
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const nx = -dy / len;
    const ny = dx / len;

    // Reduced bounds to 3000 to prevent floating point precision loss
    const BIG = 3000;
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    const L1 = [mx - (dx / len) * BIG, my - (dy / len) * BIG];
    const L2 = [mx + (dx / len) * BIG, my + (dy / len) * BIG];

    const hp1 = [
      [
        L1,
        L2,
        [L2[0] + nx * BIG, L2[1] + ny * BIG],
        [L1[0] + nx * BIG, L1[1] + ny * BIG],
        L1,
      ],
    ];

    const hp2 = [
      [
        L1,
        [L1[0] - nx * BIG, L1[1] - ny * BIG],
        [L2[0] - nx * BIG, L2[1] - ny * BIG],
        L2,
        L1,
      ],
    ];
    console.log("2. Bounding planes created safely.");

    const objects = State.get("objects");
    const selectedIds = State.get("selectedObjectIds");
    const newPolys = [];
    const idsToDelete = [];
    let splitOccurred = false;

    selectedIds.forEach((id) => {
      console.log(`\n--- Processing Shape ID: ${id} ---`);
      const obj = objects.find((o) => o.id === id);
      if (!obj || !canSelectObject(id)) return;

      let absVerts = [];
      if (obj.type === "poly") {
        const a = obj.a || 0;
        const s = obj.scale || 1;
        const rad = (a * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        absVerts = (obj.v || []).map((lv) => ({
          x: obj.c.x + (lv.x * s * cos - lv.y * s * sin),
          y: obj.c.y + (lv.x * s * sin + lv.y * s * cos),
        }));
      } else if (obj.type === "line") {
        const start = obj.start;
        let angleRad = 0;
        if (obj.angle !== undefined) {
          angleRad = (obj.angle * Math.PI) / 180;
        } else {
          angleRad = Math.atan2(obj.end.y - start.y, obj.end.x - start.x);
        }
        const w =
          obj.width !== undefined
            ? obj.width
            : Math.hypot(obj.end.x - start.x, obj.end.y - start.y);
        const end = {
          x: start.x + Math.cos(angleRad) * w,
          y: start.y + Math.sin(angleRad) * w,
        };
        const h = (obj.height || 4) / 2;
        const ldx = end.x - start.x;
        const ldy = end.y - start.y;
        const llen = Math.hypot(ldx, ldy) || 1;
        const lnx = (-ldy / llen) * h;
        const lny = (ldx / llen) * h;
        absVerts = [
          { x: start.x + lnx, y: start.y + lny },
          { x: start.x - lnx, y: start.y - lny },
          { x: end.x - lnx, y: end.y - lny },
          { x: end.x + lnx, y: end.y + lny },
        ];
      } else if (obj.type === "circle") {
        const steps = 32;
        for (let i = 0; i < steps; i++) {
          const th = (i / steps) * Math.PI * 2;
          absVerts.push({
            x: obj.c.x + Math.cos(th) * obj.radius,
            y: obj.c.y + Math.sin(th) * obj.radius,
          });
        }
      }

      if (absVerts.length < 3) return;

      const ring = absVerts.map((v) => [v.x, v.y]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (
        Math.abs(first[0] - last[0]) > 1e-6 ||
        Math.abs(first[1] - last[1]) > 1e-6
      ) {
        ring.push([first[0], first[1]]);
      }
      const targetPoly = [ring];
      console.log("3. Extracted Target Poly:", targetPoly);

      try {
        const result1 = window.polygonClipping.intersection(targetPoly, hp1);
        const result2 = window.polygonClipping.intersection(targetPoly, hp2);

        let intersected1 = false;
        let intersected2 = false;

        const processResult = (res, flagSetter, sideName) => {
          if (res && res.length > 0) {
            let generatedAny = false;
            res.forEach((multiPoly, idx) => {
              let exteriorRing = multiPoly[0];

              if (exteriorRing.length > 0) {
                const f = exteriorRing[0];
                const l = exteriorRing[exteriorRing.length - 1];
                if (
                  Math.abs(f[0] - l[0]) < 1e-6 &&
                  Math.abs(f[1] - l[1]) < 1e-6
                ) {
                  exteriorRing = exteriorRing.slice(0, -1);
                }
              }

              if (exteriorRing.length < 3) return;

              // CRITICAL FIX: Only pass the Array format `[x, y]` to poly-decomp
              const shapeToSplitArr = {
                v: exteriorRing.map((p) => [p[0], p[1]]),
              };

              let convexPolygons = [];
              try {
                convexPolygons = splitConcaveIntoConvex(shapeToSplitArr);
              } catch (err) {
                console.warn(`Decomp failed on ${sideName} piece ${idx}`, err);
              }

              if (!convexPolygons || convexPolygons.length === 0) {
                convexPolygons = [shapeToSplitArr];
              }

              convexPolygons.forEach((cp) => {
                const finalVerts = cp.v.map((p) => {
                  if (Array.isArray(p)) return { x: p[0], y: p[1] };
                  return { x: p.x, y: p.y };
                });

                const typeStr =
                  obj.polyType || obj.lineType || obj.circleType || "none";
                const customObjProps = { ...obj, a: 0, scale: 1 };

                // Check strict validation
                let validPoly = createValidPolygonObject(
                  finalVerts,
                  typeStr,
                  customObjProps,
                );

                // FAILSAFE: If strict validation rejects the shape due to collinear lines
                // along the split edge or minor float errors, forcefully build the polygon.
                if (!validPoly && finalVerts.length >= 3) {
                  console.log(
                    `   Strict validation skipped. Forcing polygon build for ${sideName}.`,
                  );
                  let cx = 0,
                    cy = 0;
                  finalVerts.forEach((v) => {
                    cx += v.x;
                    cy += v.y;
                  });
                  cx /= finalVerts.length;
                  cy /= finalVerts.length;

                  validPoly = {
                    type: "poly",
                    c: { x: cx, y: cy },
                    v: finalVerts.map((v) => ({ x: v.x - cx, y: v.y - cy })),
                    a: 0,
                    scale: 1,
                    polyType: typeStr,
                    isZone: !!obj.isZone,
                  };
                }

                if (validPoly) {
                  if (obj.color) validPoly.color = obj.color;
                  if (obj.isDeath) validPoly.isDeath = obj.isDeath;
                  if (obj.isBouncy) validPoly.isBouncy = obj.isBouncy;
                  if (obj.isZone) validPoly.isZone = obj.isZone;

                  newPolys.push(validPoly);
                  generatedAny = true;
                } else {
                  console.error(
                    `   Failed completely to map final vertices:`,
                    finalVerts,
                  );
                }
              });
            });
            if (generatedAny) flagSetter();
          } else {
            console.log(`   ${sideName} intersection resulted in empty slice.`);
          }
        };

        processResult(
          result1,
          () => {
            intersected1 = true;
          },
          "Left",
        );
        processResult(
          result2,
          () => {
            intersected2 = true;
          },
          "Right",
        );
        console.log(
          `4. Split validation: Left=${intersected1}, Right=${intersected2}`,
        );

        if (intersected1 && intersected2) {
          splitOccurred = true;
          idsToDelete.push(obj.id);
        }
      } catch (e) {
        console.error("Split calculation crash:", e);
      }
    });

    if (splitOccurred) {
      Network.createObjectsBatch({
        objects: newPolys,
        isAutoGeneration: false,
      });
      idsToDelete.forEach((id) => Network.deleteObject(id));

      setTimeout(() => {
        const latestObjs = State.get("objects");
        const newIds = newPolys
          .map((np) => {
            const found = latestObjs.find(
              (o) =>
                Math.abs(o.c.x - np.c.x) < 0.1 &&
                Math.abs(o.c.y - np.c.y) < 0.1,
            );
            return found ? found.id : null;
          })
          .filter((id) => id !== null);
        if (newIds.length > 0) State.set("selectedObjectIds", newIds);
      }, 150);

      showToast(`Successfully split shape into ${newPolys.length} polygons.`);
      console.log("5. Split Successful.");
    } else {
      showToast("Line did not intersect shape properly.", true);
      console.warn("5. Split Aborted - Line missed boundaries.");
    }
  };

  // --- ADD IMMEDIATELY AFTER ---
  safeAddEvent(document.getElementById("btnToggleZone"), "click", () => {
    window.toggleMoreOptions();
    const objects = State.get("objects");
    const selectedIds = State.get("selectedObjectIds") || [];

    if (selectedIds.length === 0) {
      showToast("No objects selected to toggle zone.", true);
      return;
    }

    const selectedObjects = objects.filter((o) => selectedIds.includes(o.id));

    // Toggle behavior: if ALL selected objects are zones, untag them. Otherwise, tag all as zones.
    const allAreZones = selectedObjects.every((o) => o.isZone);
    const nextState = !allAreZones;

    const batchPayloads = selectedIds.map((id) => ({
      id: id,
      isZone: nextState,
    }));

    Network.updateObjectsBatch(batchPayloads);
    showToast(
      nextState
        ? `Marked ${selectedIds.length} object(s) as zones.`
        : `Removed zone from ${selectedIds.length} object(s).`,
    );
  });

  // --- REMOVE OVERLAP ENGINE ---
  safeAddEvent(document.getElementById("btnRemoveOverlap"), "click", () => {
    if (window.toggleMoreOptions) window.toggleMoreOptions();
    const objects = State.get("objects") || [];
    const selectedIds = State.get("selectedObjectIds") || [];

    // Prioritize selected items, else evaluate the whole map
    let targets = [];
    if (selectedIds.length > 1) {
      // Must use filter to preserve the global Z-order exactly as drawn
      targets = objects.filter((o) => selectedIds.includes(o.id));
    } else {
      targets = objects;
    }

    if (targets.length < 2) {
      showToast(
        "At least 2 shapes (or a multi-selection) are required to remove overlaps.",
        true,
      );
      return;
    }

    const promptMessage = `Remove hidden overlaps across ${targets.length} shapes? Front-most shapes will cleanly cut out the hidden parts of any shapes behind them.`;
    showToastWithButtons(promptMessage, [
      {
        name: "Confirm",
        onClick: () => {
          if (window.saveMapSnapshot) window.saveMapSnapshot();
          if (typeof window.polygonClipping === "undefined") {
            showToast("Polygon clipping library missing.", true);
            return;
          }

          const idsToDelete = [];
          const polysToCreate = [];
          let modifiedCount = 0;

          // Helper to convert any shape to an absolute Polygon clipping format
          const getShapePolygon = (obj) => {
            let verts = [];
            if (obj.type === "poly") {
              const a = obj.a || 0;
              const s = obj.scale || 1;
              const rad = (a * Math.PI) / 180;
              const cos = Math.cos(rad);
              const sin = Math.sin(rad);
              verts = (obj.v || []).map((lv) => ({
                x: obj.c.x + (lv.x * s * cos - lv.y * s * sin),
                y: obj.c.y + (lv.x * s * sin + lv.y * s * cos),
              }));
            } else if (obj.type === "line") {
              const start = obj.start;
              const end =
                typeof obj.width === "number" && typeof obj.angle === "number"
                  ? {
                      x:
                        start.x +
                        Math.cos((obj.angle * Math.PI) / 180) * obj.width,
                      y:
                        start.y +
                        Math.sin((obj.angle * Math.PI) / 180) * obj.width,
                    }
                  : obj.end;
              const h = (obj.height || 4) / 2;
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const len = Math.hypot(dx, dy);
              if (len === 0) return null;
              const nx = (-dy / len) * h;
              const ny = (dx / len) * h;
              verts = [
                { x: start.x + nx, y: start.y + ny },
                { x: start.x - nx, y: start.y - ny },
                { x: end.x - nx, y: end.y - ny },
                { x: end.x + nx, y: end.y + ny },
              ];
            } else if (obj.type === "circle") {
              const steps = 32;
              for (let i = 0; i < steps; i++) {
                const th = (i / steps) * Math.PI * 2;
                verts.push({
                  x: obj.c.x + Math.cos(th) * obj.radius,
                  y: obj.c.y + Math.sin(th) * obj.radius,
                });
              }
            }

            if (verts.length < 3) return null;
            const ring = verts.map((v) => [v.x, v.y]);
            const first = ring[0],
              last = ring[ring.length - 1];
            if (
              Math.abs(first[0] - last[0]) > 1e-6 ||
              Math.abs(first[1] - last[1]) > 1e-6
            )
              ring.push([first[0], first[1]]);
            return [ring];
          };

          // Cache bounding boxes for fast broad-phase collision
          const shapeData = targets.map((obj) => {
            const poly = getShapePolygon(obj);
            if (!poly) return { obj, poly: null, box: null };
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            poly[0].forEach((p) => {
              if (p[0] < minX) minX = p[0];
              if (p[0] > maxX) maxX = p[0];
              if (p[1] < minY) minY = p[1];
              if (p[1] > maxY) maxY = p[1];
            });
            return { obj, poly, box: { minX, minY, maxX, maxY } };
          });

          // Iteratively subtract foreground shapes from background shapes
          for (let i = 0; i < shapeData.length - 1; i++) {
            const back = shapeData[i];
            if (!back.poly || !canSelectObject(back.obj.id)) continue;

            let currentGeom = [back.poly];
            let wasClipped = false;

            for (let j = i + 1; j < shapeData.length; j++) {
              const front = shapeData[j];
              if (!front.poly) continue;

              // Broad-phase skip
              if (
                back.box.minX > front.box.maxX + 1 ||
                back.box.maxX < front.box.minX - 1 ||
                back.box.minY > front.box.maxY + 1 ||
                back.box.maxY < front.box.minY - 1
              )
                continue;

              try {
                const intersection = window.polygonClipping.intersection(
                  currentGeom,
                  [front.poly],
                );
                if (intersection && intersection.length > 0) {
                  currentGeom = window.polygonClipping.difference(currentGeom, [
                    front.poly,
                  ]);
                  wasClipped = true;
                }
              } catch (err) {
                console.warn(
                  "Clipping math failed for shapes",
                  back.obj.id,
                  front.obj.id,
                  err,
                );
              }
              if (currentGeom.length === 0) break; // Shape completely erased
            }

            if (wasClipped) {
              idsToDelete.push(back.obj.id);
              modifiedCount++;

              if (currentGeom.length > 0) {
                // Break the fragmented geometry back into valid convex shapes
                currentGeom.forEach((multiPoly) => {
                  let exteriorRing = multiPoly[0];
                  if (!exteriorRing || exteriorRing.length < 3) return;

                  const f = exteriorRing[0],
                    l = exteriorRing[exteriorRing.length - 1];
                  if (
                    Math.abs(f[0] - l[0]) < 1e-6 &&
                    Math.abs(f[1] - l[1]) < 1e-6
                  )
                    exteriorRing = exteriorRing.slice(0, -1);
                  if (exteriorRing.length < 3) return;

                  const shapeToSplit = {
                    v: exteriorRing.map((p) => [p[0], p[1]]),
                  };
                  let convexPolys = [];
                  try {
                    convexPolys = splitConcaveIntoConvex(shapeToSplit);
                  } catch (e) {
                    convexPolys = [shapeToSplit];
                  }
                  if (!convexPolys || convexPolys.length === 0)
                    convexPolys = [shapeToSplit];

                  convexPolys.forEach((cp) => {
                    const finalVerts = cp.v.map((p) => ({ x: p[0], y: p[1] }));
                    const typeStr =
                      back.obj.polyType ||
                      back.obj.lineType ||
                      back.obj.circleType ||
                      "none";
                    const customObjProps = { ...back.obj, a: 0, scale: 1 };

                    let validPoly = createValidPolygonObject(
                      finalVerts,
                      typeStr,
                      customObjProps,
                    );

                    // Failsafe for mathematically intense vertices
                    if (!validPoly && finalVerts.length >= 3) {
                      let cx = 0,
                        cy = 0;
                      finalVerts.forEach((v) => {
                        cx += v.x;
                        cy += v.y;
                      });
                      cx /= finalVerts.length;
                      cy /= finalVerts.length;
                      validPoly = {
                        type: "poly",
                        c: { x: cx, y: cy },
                        v: finalVerts.map((v) => ({
                          x: v.x - cx,
                          y: v.y - cy,
                        })),
                        a: 0,
                        scale: 1,
                        polyType: typeStr,
                        isZone: !!back.obj.isZone,
                        color: back.obj.color,
                      };
                    }

                    // Inherit exact rendering properties from parent
                    if (validPoly) {
                      if (back.obj.color) validPoly.color = back.obj.color;
                      if (back.obj.isDeath)
                        validPoly.isDeath = back.obj.isDeath;
                      if (back.obj.isBouncy)
                        validPoly.isBouncy = back.obj.isBouncy;
                      polysToCreate.push(validPoly);
                    }
                  });
                });
              }
            }
          }

          if (modifiedCount > 0) {
            idsToDelete.forEach((id) => Network.deleteObject(id));
            if (polysToCreate.length > 0)
              Network.createObjectsBatch({
                objects: polysToCreate,
                isAutoGeneration: false,
              });
            showToast(
              `Cleaned overlaps from ${modifiedCount} shape(s). Splintered into ${polysToCreate.length} pieces.`,
            );
          } else {
            showToast("No overlaps found to remove.", true);
          }
        },
      },
    ]);
  });

  // --- MIRROR MAP ENGINE ---
  safeAddEvent(document.getElementById("btnMirrorMap"), "click", () => {
    if (window.toggleMoreOptions) window.toggleMoreOptions();

    const selectedIds = State.get("selectedObjectIds") || [];
    const isPartialMirror = selectedIds.length > 0;

    const promptMessage = isPartialMirror
      ? `Mirror ${selectedIds.length} selected shape(s) horizontally?`
      : "Mirror entire map horizontally?";

    const buttonText = isPartialMirror ? "Mirror Selected" : "Mirror Map";

    showToastWithButtons(promptMessage, [
      {
        name: buttonText,
        onClick: () => {
          const canvas = UI.elems.canvas;
          const cw = canvas ? canvas.width || 800 : 800; // Use center of map boundaries
          const objects = State.get("objects") || [];
          const batchPayloads = [];

          objects.forEach((obj) => {
            // If doing a partial mirror, ignore objects that aren't selected
            if (isPartialMirror && !selectedIds.includes(obj.id)) return;

            if (obj.type === "poly") {
              // Mirrored Position
              const c = { x: cw - obj.c.x, y: obj.c.y };
              // Negate local X-coords and reverse to protect CCW Physics Winding Order
              const v = (obj.v || []).map((pt) => ({ x: -pt.x, y: pt.y }));
              v.reverse();

              batchPayloads.push({
                id: obj.id,
                c: c,
                v: v,
                a: obj.a ? normalizeAngle(360 - obj.a) : 0,
              });
            } else if (obj.type === "line") {
              const start = obj.start;
              let end = obj.end;
              if (
                typeof obj.width === "number" &&
                typeof obj.angle === "number"
              ) {
                end = {
                  x:
                    start.x + Math.cos((obj.angle * Math.PI) / 180) * obj.width,
                  y:
                    start.y + Math.sin((obj.angle * Math.PI) / 180) * obj.width,
                };
              } else if (!end) {
                end = { x: start.x, y: start.y };
              }

              const newStart = { x: cw - start.x, y: start.y };
              const newEnd = { x: cw - end.x, y: end.y };

              let newAngle = obj.angle;
              if (newAngle !== undefined) {
                newAngle = normalizeAngle(180 - newAngle);
              } else {
                newAngle =
                  (Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) *
                    180) /
                  Math.PI;
              }

              batchPayloads.push({
                id: obj.id,
                start: newStart,
                end: newEnd,
                angle: newAngle,
              });
            } else if (obj.type === "circle") {
              batchPayloads.push({
                id: obj.id,
                c: { x: cw - obj.c.x, y: obj.c.y },
              });
            }
          });

          if (batchPayloads.length > 0) {
            Network.updateObjectsBatch(batchPayloads);
          }

          // Only mirror environmental boundaries if we are mirroring the entire map
          if (!isPartialMirror) {
            const spawn = State.get("spawnCircle");
            if (spawn) {
              Network.setSpawnCircle({ x: cw - spawn.x, y: spawn.y });
            }

            const cz = State.get("capZone");
            if (cz && cz.x !== null) {
              Network.setCapZone({ x: cw - cz.x - (cz.width || 30), y: cz.y });
            }
          }

          showToast(
            `Successfully mirrored ${isPartialMirror ? selectedIds.length + " shapes" : "entire map"}.`,
          );
        },
      },
    ]);
  });

  safeAddEvent(document.getElementById("btnAddFrames"), "click", () => {
    const cw = UI.elems.canvas.width;
    const ch = UI.elems.canvas.height;
    const thickness = 200;
    const stickInside = 10;
    const offset = thickness / 2 - stickInside; // 90 units outside

    const frames = [
      // Top Frame
      {
        type: "line",
        start: { x: 0, y: -offset },
        end: { x: cw, y: -offset },
        height: thickness,
      },

      // Bottom Frame
      {
        type: "line",
        start: { x: 0, y: ch + offset },
        end: { x: cw, y: ch + offset },
        height: thickness,
      },

      // Left Frame
      {
        type: "line",
        start: { x: -offset, y: 0 },
        end: { x: -offset, y: ch },
        height: thickness,
      },

      // Right Frame (FIXED)
      {
        type: "line",
        start: { x: cw + offset, y: 0 },
        end: { x: cw + offset, y: ch },
        height: thickness,
      },
    ];

    Network.createObjectsBatch({ objects: frames, isAutoGeneration: false });
    showToast("Canvas frames added successfully.");
    window.toggleMoreOptions();
  });

  // ==========================================
  // DEATH TUNNEL GENERATOR
  // ==========================================
  safeAddEvent(e.tunnelPaddingSlider, "input", (ev) => {
    if (e.tunnelPaddingVal) e.tunnelPaddingVal.innerText = ev.target.value;
  });

  safeAddEvent(e.btnGenerateTunnel, "click", async () => {
    window.toggleMoreOptions(); // Hide the options panel for a clear view
    const padding = e.tunnelPaddingSlider
      ? parseInt(e.tunnelPaddingSlider.value, 10)
      : 30;
    await generateDeathTunnel(padding);
  });

  // --- Initialize Zone Indicator State ---
  if (!State.get("zoneIndicator")) {
    State.set("zoneIndicator", { x: 300, y: 150, show: false });
  }

  safeAddEvent(e.cbShowZone, "change", (ev) => {
    const zone = State.get("zoneIndicator") || { x: 300, y: 150 };
    State.set("zoneIndicator", { ...zone, show: ev.target.checked });
  });

  // --- CAMERA NAVIGATION MODE ---
  safeAddEvent(e.btnCameraMode, "click", () => {
    const isCam = !State.get("cameraMode");
    State.set("cameraMode", isCam);

    if (isCam) {
      e.btnCameraMode.style.backgroundColor = "#4ade80";
      e.btnCameraMode.style.color = "#000";
      showToast(
        "Camera Mode ON: Use WASD/Arrows or Drag Mouse to pan, Scroll or +/- to zoom. Editing disabled.",
        false,
      );
      State.clearSelectedObjects();
    } else {
      e.btnCameraMode.style.backgroundColor = "";
      e.btnCameraMode.style.color = "";
      // Note: Deliberately NOT resetting offset and zoom so editing persists in the transformed state!
      showToast("Camera Mode OFF: Editing enabled. Viewport retained.", false);
    }
  });

  safeAddEvent(e.btnResetCamera, "click", () => {
    State.set("cameraZoom", 1);
    State.set("cameraOffset", { x: 0, y: 0 });
    showToast("Camera reset.", false);
  });

  // Only allow wheel zooming when Camera mode is active to prevent accidental scrolling while editing
  safeAddEvent(e.canvas, "wheel", (ev) => {
    if (!State.get("cameraMode")) return;
    ev.preventDefault();
    let zoom = State.get("cameraZoom") || 1;
    if (ev.deltaY < 0) zoom *= 1.1;
    else zoom /= 1.1;
    zoom = Math.max(0.1, Math.min(10, zoom));
    State.set("cameraZoom", zoom);
  });
}

function safeAddEvent(elem, eventName, handler) {
  if (elem) {
    elem.addEventListener(eventName, handler);
  }
}

// --- IN handlers.js ---

window.mergeClosePolygons = (targetPolys) => {
  if (!targetPolys || targetPolys.length === 0) return { success: false };
  let polys = targetPolys;

  // --- Math & Geometry Helpers ---
  function distSq(v1, v2) {
    return (v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2;
  }

  function linesIntersect(p1, p2, p3, p4) {
    let det = (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
    if (det === 0) return false;
    let lambda =
      ((p4.y - p3.y) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.y - p1.y)) / det;
    let gamma =
      ((p1.y - p2.y) * (p4.x - p1.x) + (p2.x - p1.x) * (p4.y - p1.y)) / det;
    return 0 < lambda && lambda < 1 && 0 < gamma && gamma < 1;
  }

  function isSelfIntersecting(verts) {
    for (let i = 0; i < verts.length; i++) {
      let a1 = verts[i],
        a2 = verts[(i + 1) % verts.length];
      for (let j = i + 2; j < verts.length; j++) {
        if (i === 0 && j === verts.length - 1) continue;
        let b1 = verts[j],
          b2 = verts[(j + 1) % verts.length];
        if (linesIntersect(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  function isStrictlyConvex(verts) {
    if (verts.length <= 3) return !isSelfIntersecting(verts);
    let isPositive = null;
    for (let i = 0; i < verts.length; i++) {
      let p0 = verts[i],
        p1 = verts[(i + 1) % verts.length],
        p2 = verts[(i + 2) % verts.length];
      let cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
      if (Math.abs(cross) < 0.1) continue;
      if (isPositive === null) isPositive = cross > 0;
      else if (cross > 0 !== isPositive) return false;
    }
    return !isSelfIntersecting(verts);
  }

  // Removes redundant points on flat walls created by merging
  function simplify(verts, epsilon = 0.5) {
    if (verts.length <= 3) return verts;
    let clean = [];
    for (let i = 0; i < verts.length; i++) {
      let prev = verts[(i - 1 + verts.length) % verts.length];
      let curr = verts[i];
      let next = verts[(i + 1) % verts.length];
      let area = Math.abs(
        (prev.x * (curr.y - next.y) +
          curr.x * (next.y - prev.y) +
          next.x * (prev.y - curr.y)) /
          2,
      );
      if (area > epsilon) clean.push(curr);
    }
    return clean.length >= 3 ? clean : verts;
  }

  function getAbsVerts(obj) {
    const a = obj.a || 0,
      s = obj.scale || 1,
      rad = (a * Math.PI) / 180;
    return (obj.v || []).map((lv) => ({
      x: obj.c.x + (lv.x * s * Math.cos(rad) - lv.y * s * Math.sin(rad)),
      y: obj.c.y + (lv.x * s * Math.sin(rad) + lv.y * s * Math.cos(rad)),
    }));
  }

  // --- Prepare Data ---
  let polyData = polys.map((p) => ({
    id: p.id,
    polyType: p.polyType,
    color: p.color,
    verts: getAbsVerts(p),
  }));

  let changed = true,
    iter = 0;
  let mergedIds = new Set();
  const TOLERANCE_SQ = 2.0; // Max squared pixel distance to consider vertices overlapping

  while (changed && iter < 200) {
    changed = false;
    iter++;
    for (let i = 0; i < polyData.length; i++) {
      for (let j = i + 1; j < polyData.length; j++) {
        let pA = polyData[i],
          pB = polyData[j];
        if (pA.polyType !== pB.polyType) continue;

        let mergedVerts = null;
        let A = pA.verts,
          B = pB.verts;

        // Search for a shared edge
        for (let a = 0; a < A.length; a++) {
          let a1 = A[a],
            a2 = A[(a + 1) % A.length];
          for (let b = 0; b < B.length; b++) {
            let b1 = B[b],
              b2 = B[(b + 1) % B.length];

            // If edge A goes opposite to edge B, they are a shared wall
            if (
              distSq(a1, b2) < TOLERANCE_SQ &&
              distSq(a2, b1) < TOLERANCE_SQ
            ) {
              let stitched = [];
              let currA = (a + 1) % A.length;
              while (currA !== a) {
                stitched.push(A[currA]);
                currA = (currA + 1) % A.length;
              }
              stitched.push(A[a]);

              let currB = (b + 1) % B.length;
              while (currB !== b) {
                if (currB !== (b + 1) % B.length) stitched.push(B[currB]);
                currB = (currB + 1) % B.length;
              }

              // Strictly enforce convexity and validity before accepting the merge
              if (isStrictlyConvex(stitched)) {
                mergedVerts = simplify(stitched);
              }
            }
          }
          if (mergedVerts) break;
        }

        if (mergedVerts) {
          mergedIds.add(pA.id);
          mergedIds.add(pB.id);

          polyData.splice(j, 1);
          polyData.splice(i, 1);

          // Recalculate physical center
          let cx = 0,
            cy = 0;
          mergedVerts.forEach((v) => {
            cx += v.x;
            cy += v.y;
          });
          cx /= mergedVerts.length;
          cy /= mergedVerts.length;

          let mergedColor =
            pA.color !== pB.color
              ? Math.random() > 0.5
                ? pA.color
                : pB.color
              : pA.color;

          let newObj = {
            type: "poly",
            c: { x: cx, y: cy },
            v: mergedVerts.map((v) => ({ x: v.x - cx, y: v.y - cy })),
            a: 0,
            scale: 1,
            polyType: pA.polyType,
            color: mergedColor,
          };

          polyData.push({
            id: "NEW_" + Math.random(),
            polyType: pA.polyType,
            color: mergedColor,
            verts: mergedVerts,
            objData: newObj,
          });

          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // Push updates to network
  Array.from(mergedIds).forEach((id) => {
    if (!id.startsWith("NEW_")) Network.deleteObject(id);
  });

  const finalCreates = polyData
    .filter((p) => p.id.startsWith("NEW_"))
    .map((p) => p.objData);

  if (finalCreates.length > 0) {
    Network.createObjectsBatch({
      objects: finalCreates,
      isAutoGeneration: true,
    });
    return {
      success: true,
      mergedCount: mergedIds.size,
      createdCount: finalCreates.length,
    };
  } else {
    return { success: false };
  }
};
