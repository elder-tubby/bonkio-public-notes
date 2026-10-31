import UI from "./ui.js";
import State from "./state.js";
import * as Network from "./network.js";
import {
  createValidPolygonObject,
  splitConcaveIntoConvex,
} from "./utils-client.js";

let isActive = false;
let isMouseDown = false;
let currentPoints = [];
let strokeThickness = 20;
// Add this exported function so thickness updates live!
export function setStrokeThickness(thickness) {
  strokeThickness = parseInt(thickness, 10) || 20;
}

export function enableDrawingTool(thickness) {
  isActive = true;
  strokeThickness = thickness;
  State.set("isDrawingPath", true);
  State.set("generatedPath", []);

  const canvas = UI.elems.canvas;
  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKey);
}

export function disableDrawingTool() {
  isActive = false;
  State.set("isDrawingPath", false);
  State.set("generatedPath", null);

  const canvas = UI.elems.canvas;
  if (canvas) canvas.removeEventListener("mousedown", onDown);
  window.removeEventListener("mousemove", onMove);
  window.removeEventListener("mouseup", onUp);
  window.removeEventListener("keydown", onKey);
}

function toLocal(evt) {
  const rect = UI.elems.canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

function onDown(e) {
  if (!isActive || e.button !== 0) return;
  isMouseDown = true;
  currentPoints = [toLocal(e)];
  State.set("generatedPath", [...currentPoints]);
}

function onMove(e) {
  if (!isActive || !isMouseDown) return;
  const pt = toLocal(e);

  const last = currentPoints[currentPoints.length - 1];
  const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
  if (dist > strokeThickness / 4) {
    currentPoints.push(pt);
    State.set("generatedPath", [...currentPoints]);
  }
}

function onUp(e) {
  if (!isActive || !isMouseDown) return;
  isMouseDown = false;

  if (currentPoints.length > 2) {
    processUnifiedOrganicStroke(currentPoints, strokeThickness);
  }

  currentPoints = [];
  State.set("generatedPath", []);
}

function onKey(e) {
  if (isActive && e.key === "Escape") {
    disableDrawingTool();
    const btn = UI.elems.agpDrawBtn;
    if (btn) {
      btn.textContent = "Toggle Drawing: OFF";
      btn.style.backgroundColor = "";
    }
    UI.setStatus("Continuous Drawing OFF.");
  }
}

// ============================================================================
// MASSIVE POLYGON OPTIMIZATION GENERATOR
// ============================================================================

function processUnifiedOrganicStroke(pts, thickness) {
  if (typeof polygonClipping === "undefined" || typeof decomp === "undefined")
    return;

  // 1. Core Skeleton
  const epsilon = Math.max(4, thickness * 0.15);
  let skeleton = douglasPeucker(pts, epsilon);
  if (skeleton.length < 2) return;

  const allGeometry = []; // We will throw all segments and joints in here

  // Calligraphy width logic
  const getWidth = (i, total) => {
    const progress = i / Math.max(1, total - 1);
    const taper = Math.sin(progress * Math.PI) * 0.4 + 0.6;
    const wave = 0.8 + 0.2 * Math.sin(i * 1.5);
    return (thickness / 2) * taper * wave;
  };

  // Helper to create a circular joint (prevents notches at sharp elbows)
  const createJoint = (center, radius) => {
    const arr = [];
    const points = 8; // Octagon is highly efficient and curves nicely when simplified
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      arr.push([
        center.x + Math.cos(a) * radius,
        center.y + Math.sin(a) * radius,
      ]);
    }
    return [arr];
  };

  // 2. Build segments and joints into independent raw shapes
  for (let i = 0; i < skeleton.length; i++) {
    const p = skeleton[i];
    const w = getWidth(i, skeleton.length);

    // Add joint cap
    allGeometry.push(createJoint(p, w));

    // Add thick connecting bridge
    if (i < skeleton.length - 1) {
      const pNext = skeleton[i + 1];
      const wNext = getWidth(i + 1, skeleton.length);
      const dx = pNext.x - p.x;
      const dy = pNext.y - p.y;
      const len = Math.hypot(dx, dy);

      if (len > 0.1) {
        const nx = -dy / len;
        const ny = dx / len;
        allGeometry.push([
          [
            [p.x + nx * w, p.y + ny * w],
            [p.x - nx * w, p.y - ny * w],
            [pNext.x - nx * wNext, pNext.y - ny * wNext],
            [pNext.x + nx * wNext, pNext.y + ny * wNext],
            [p.x + nx * w, p.y + ny * w], // close loop
          ],
        ]);
      }
    }
  }

  // 3. THE MAGIC: Merge everything into ONE giant, continuous blob of ink.
  let mergedBlob;
  try {
    mergedBlob = polygonClipping.union(...allGeometry);
  } catch (e) {
    console.warn("Clipping union failed on stroke", e);
    return;
  }

  const finalObjects = [];
  const activeType = UI.elems.typeSelect ? UI.elems.typeSelect.value : "none";

  // 4. Extract, Simplify, and Slice the outer boundary
  mergedBlob.forEach((polygon) => {
    const outerRing = polygon[0];
    let ringPoints = outerRing.slice(0, -1); // remove duplicate closing point

    // Convert to object array for DP simplification
    const ringObj = ringPoints.map((p) => ({ x: p[0], y: p[1] }));

    // CRITICAL: Aggressively simplify the closed boundary.
    // This turns rigid curves into massive sweeping lines,
    // forcing the decomp algorithm to output FEW, MASSIVE polygons.
    const simplifyEpsilon = Math.max(2, thickness * 0.08);
    const simplifiedRing = simplifyClosedPath(ringObj, simplifyEpsilon);

    if (simplifiedRing.length < 3) return;

    // Finally, slice this ONE perfect outline into complex convex pieces.
    const shapeToSplit = { v: simplifiedRing.map((p) => [p.x, p.y]) };
    const convexPolygons = splitConcaveIntoConvex(shapeToSplit);

    if (convexPolygons && convexPolygons.length > 0) {
      convexPolygons.forEach((cp) => {
        const absoluteVertices = cp.v.map((p) => ({ x: p[0], y: p[1] }));
        const validPoly = createValidPolygonObject(
          absoluteVertices,
          activeType,
        );
        if (validPoly) {
          finalObjects.push(validPoly);
        }
      });
    }
  });

  if (finalObjects.length > 0) {
    Network.createObjectsBatch({
      objects: finalObjects,
      isAutoGeneration: false,
    });
  }
}

// ============================================================================
// MATHEMATICAL UTILITIES
// ============================================================================

// Simplifies a closed polygon ring while keeping it closed
function simplifyClosedPath(pts, epsilon) {
  if (pts.length < 5) return pts;

  // Find the furthest point from the start to break the loop into two curves
  let maxD = 0,
    fIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > maxD) {
      maxD = d;
      fIdx = i;
    }
  }

  const path1 = pts.slice(0, fIdx + 1);
  const path2 = pts.slice(fIdx).concat([pts[0]]);

  const sim1 = douglasPeucker(path1, epsilon);
  const sim2 = douglasPeucker(path2, epsilon);

  sim1.pop(); // prevent vertex overlap at joint
  sim2.pop();
  return sim1.concat(sim2);
}

// standard open-path Douglas-Peucker
function douglasPeucker(pts, epsilon) {
  if (pts.length <= 2) return pts;
  let dmax = 0;
  let index = 0;
  const end = pts.length - 1;
  for (let i = 1; i < end; i++) {
    const d = pointLineDistance(pts[i], pts[0], pts[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const rec1 = douglasPeucker(pts.slice(0, index + 1), epsilon);
    const rec2 = douglasPeucker(pts.slice(index), epsilon);
    return rec1.slice(0, -1).concat(rec2);
  } else {
    return [pts[0], pts[end]];
  }
}

function pointLineDistance(p, a, b) {
  const num = Math.abs(
    (b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x,
  );
  const den = Math.hypot(b.x - a.x, b.y - a.y);
  return den === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : num / den;
}
