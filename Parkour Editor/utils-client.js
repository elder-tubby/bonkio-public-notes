// utils-client.js
import State from "./state.js";
import * as LocalStore from "./local-store.js";
import UI from "./ui.js"; // Assuming UI module exports elems

/**
 * helper: convert a line's width+angle into an endpoint if present, else use line.end
 */
export function computeEnd(line) {
  if (typeof line.width === "number" && typeof line.angle === "number") {
    const r = (line.angle * Math.PI) / 180;
    return {
      x: line.start.x + Math.cos(r) * line.width,
      y: line.start.y + Math.sin(r) * line.width,
    };
  }
  return line.end;
}

/**
 * A helper function to check if a point is inside a polygon using the ray-casting algorithm.
 * @param {{x, y}} point The point to check.
 * @param {[{x, y}]} vertices The vertices of the polygon.
 * @returns {boolean} True if the point is inside the polygon.
 */
function isPointInPolygon(point, vertices) {
  let isInside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x,
      yi = vertices[i].y;
    const xj = vertices[j].x,
      yj = vertices[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

export function updateLineTypeUI(type) {
  const select = document.getElementById("lineTypeSelect");
  if (!select) return;

  switch (type) {
    case "bouncy":
      select.style.backgroundColor = "#888"; // gray
      select.style.color = "#000";
      break;
    case "death":
      select.style.backgroundColor = "#e53935"; // vivid red
      select.style.color = "#000";
      break;
    case "none":
    default:
      select.style.backgroundColor = "#fff"; // white
      select.style.color = "#000";
      break;
  }
}
export function showToast(message, isWarning = false) {
  const toast = document.createElement("div");
  toast.textContent = message;

  const backgroundColor = isWarning ? "#d9822b" : "#333"; // darker orange

  Object.assign(toast.style, {
    position: "fixed",
    top: "1rem",
    left: "50%",
    transform: "translateX(-50%)",
    background: backgroundColor,
    color: "#fff",
    padding: "0.6rem 1rem",
    borderRadius: "5px",
    fontSize: "0.9rem",
    zIndex: 1000,
    opacity: 0,
    transition: "opacity 0.3s ease",
  });

  document.body.appendChild(toast);
  requestAnimationFrame(() => (toast.style.opacity = 1));

  setTimeout(() => {
    toast.style.opacity = 0;
    toast.addEventListener("transitionend", () => toast.remove());
  }, 2000);
}

// 2. Sleek Interactive Toast
export function showToastWithButtons(message, buttons = []) {
  const existingToast = document.getElementById("interactive-toast-container");
  if (existingToast) existingToast.remove();

  // Container
  const container = document.createElement("div");
  container.id = "interactive-toast-container";
  Object.assign(container.style, {
    position: "fixed",
    top: "2rem",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(15, 15, 15, 0.95)", // Very dark grey
    color: "#eee",
    padding: "1.2rem 2rem",
    borderRadius: "4px", // Sharper corners for sleek look
    zIndex: 2000,
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
    border: "1px solid #333",
    minWidth: "340px",
    textAlign: "center",
    fontFamily: "'Lexend', sans-serif", // Enforce Lexend
    backdropFilter: "blur(8px)",
  });

  // Close 'X'
  const closeBtn = document.createElement("div");
  closeBtn.textContent = "✕";
  Object.assign(closeBtn.style, {
    position: "absolute",
    top: "8px",
    right: "10px",
    cursor: "pointer",
    fontSize: "0.9rem",
    color: "#666",
    fontFamily: "sans-serif",
  });
  closeBtn.onmouseenter = () => (closeBtn.style.color = "#fff");
  closeBtn.onmouseleave = () => (closeBtn.style.color = "#666");
  closeBtn.onclick = () => container.remove();
  container.appendChild(closeBtn);

  // Message
  const msgEl = document.createElement("div");
  msgEl.textContent = message;
  msgEl.style.fontWeight = "400";
  msgEl.style.fontSize = "0.9rem";
  msgEl.style.letterSpacing = "0.5px";
  container.appendChild(msgEl);

  // Buttons Row
  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, {
    display: "flex",
    justifyContent: "center",
    gap: "12px",
    flexWrap: "wrap",
  });

  buttons.forEach((btnDef) => {
    const btn = document.createElement("button");
    btn.textContent = btnDef.name;

    // Sleek Minimalistic Style
    Object.assign(btn.style, {
      padding: "8px 16px",
      background: "transparent",
      border: "1px solid #555",
      borderRadius: "3px",
      color: "#ccc",
      cursor: "pointer",
      fontSize: "0.7rem",
      fontFamily: "'Lexend', sans-serif",
      fontWeight: "500",
      transition: "all 0.2s ease",
      letterSpacing: "0.5px",
      textTransform: "uppercase",
    });

    // Invert colors on hover
    btn.onmouseenter = () => {
      btn.style.background = "#fff";
      btn.style.color = "#000";
      btn.style.borderColor = "#fff";
      btn.style.boxShadow = "0 0 10px rgba(255,255,255,0.2)";
    };
    btn.onmouseleave = () => {
      btn.style.background = "transparent";
      btn.style.color = "#ccc";
      btn.style.borderColor = "#555";
      btn.style.boxShadow = "none";
    };

    btn.onclick = () => {
      if (btnDef.onClick) btnDef.onClick();
      container.remove();
    };
    btnRow.appendChild(btn);
  });

  container.appendChild(btnRow);
  document.body.appendChild(container);
}

// Rotates a point around the origin (0,0)
function rotatePoint(point, angle) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function getSpawnDiameter(mapSize) {
  let diameter = 18; // Default value
  const sizeMap = {
    13: 10,
    12: 12,
    11: 14,
    10: 16,
    9: 18,
    8: 20,
    7: 24,
    6: 26,
    5: 30,
    4: 34,
    3: 40,
    2: 48,
    1: 60,
  };
  return sizeMap[mapSize] || diameter;
}

export function getLineProps(l) {
  const dx = l.end.x - l.start.x;
  const dy = l.end.y - l.start.y;
  const fallbackWidth = Math.hypot(dx, dy);

  const width = typeof l.width === "number" ? l.width : fallbackWidth;
  const height = typeof l.height === "number" ? l.height : 4;
  const angle =
    typeof l.angle === "number"
      ? l.angle
      : (Math.atan2(dy, dx) * 180) / Math.PI;

  return { width, height, angle };
}

export function normalizeAngle(angle) {
  // Normalize to 0 - 360
  return ((angle % 360) + 360) % 360;
}

export function distance(a, b) {
  // --- FIX --- Added a guard to prevent crash if points are invalid
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function pointFromEventOnCanvas(evt) {
  const canvas = UI.elems.canvas;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();

  // Calculate the scale to map screen pixels to canvas coordinates
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const screenX = (evt.clientX - rect.left) * scaleX;
  const screenY = (evt.clientY - rect.top) * scaleY;

  // Apply Inverse Camera Transform so mouse mapping works accurately at any zoom/pan level
  const zoom = State.get("cameraZoom") || 1;
  const offset = State.get("cameraOffset") || { x: 0, y: 0 };
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  const worldX = (screenX - cx) / zoom + cx - offset.x;
  const worldY = (screenY - cy) / zoom + cy - offset.y;

  return { x: worldX, y: worldY };
}

/**
 * Calculate the centroid (geometric center) of a polygon.
 * @param {Array<{x:number, y:number}>} verts - polygon vertices in order (not necessarily closed)
 * @returns {[number, number]} centroid as [cx, cy]
 */
// return { x, y } (always)
export function calculatePolygonCenter(verts) {
  if (!Array.isArray(verts) || verts.length === 0) return { x: 0, y: 0 };

  // normalize vertices to objects {x,y}
  const v = verts.map((p) =>
    Array.isArray(p)
      ? { x: Number(p[0]), y: Number(p[1]) }
      : { x: Number(p.x), y: Number(p.y) },
  );

  const n = v.length;
  if (n === 1) return { x: v[0].x, y: v[0].y };
  if (n === 2) return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };

  let twiceArea = 0; // 2 * signed area
  let cxTimes6Area = 0;
  let cyTimes6Area = 0;

  for (let i = 0; i < n; i++) {
    const a = v[i];
    const b = v[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cxTimes6Area += (a.x + b.x) * cross;
    cyTimes6Area += (a.y + b.y) * cross;
  }

  // degenerate polygon -> fallback to simple average
  if (Math.abs(twiceArea) < 1e-8) {
    let sx = 0,
      sy = 0;
    for (let i = 0; i < n; i++) {
      sx += v[i].x;
      sy += v[i].y;
    }
    return { x: sx / n, y: sy / n };
  }

  // centroid formula: Cx = (1/(6A)) * sum( (xi + xi+1) * cross )
  // twiceArea = 2*A => 6*A = 3*twiceArea
  const cx = cxTimes6Area / (3 * twiceArea);
  const cy = cyTimes6Area / (3 * twiceArea);

  return { x: cx, y: cy };
}

/**
 * A variant of getHitObjectId that checks for any object under the cursor,
 * regardless of ownership. Used for the hover tooltip.
 * @param {{x, y}} point The coordinates of the mouse.
 * @param {Array<Object>} objects The array of all objects.
 * @returns {Object|null} The hovered object itself, or null.
 */
export function getHoveredObject(point, objects) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type === "poly") {
      const { c, v, a, scale } = obj;
      const s = scale || 1;
      const angleRad = -a * (Math.PI / 180);
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const translatedX = point.x - c.x;
      const translatedY = point.y - c.y;
      const rotatedX = translatedX * cos - translatedY * sin;
      const rotatedY = translatedX * sin + translatedY * cos;
      // Reverse the scale transformation for accurate hit detection
      const finalX = rotatedX / s;
      const finalY = rotatedY / s;

      if (isPointInPolygon({ x: finalX, y: finalY }, v)) {
        return obj;
      }
    } else if (obj.type === "line") {
      const start = obj.start;
      const end = computeEnd(obj);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      const localX = (point.x - start.x) * cos - (point.y - start.y) * sin;
      const localY = (point.x - start.x) * sin + (point.y - start.y) * cos;
      const lineHeight = typeof obj.height === "number" ? obj.height : 4;
      const halfH = lineHeight / 2;

      if (
        localX >= 0 &&
        localX <= length &&
        localY >= -halfH &&
        localY <= halfH
      ) {
        return obj;
      }
    } else if (obj.type === "circle") {
      // --- NEW ---
      // Check if point is within the circle's radius
      if (distance(point, obj.c) < obj.radius) {
        return obj;
      }
    }
  }
  return null;
}

// utils-client.js

// --- Replace the handleUndoLastObject function ---
export function handleUndoLastObject() {
  const objects = State.get("objects");

  const myLastObject = objects
    .filter((obj) => obj.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (myLastObject) {
    LocalStore.deleteObject(myLastObject.id);
  }
}

// Add to utils-client.js (near the other exported helpers)

function rectsIntersect(r1, r2) {
  return !(
    r2.x > r1.x + r1.width ||
    r2.x + r2.width < r1.x ||
    r2.y > r1.y + r1.height ||
    r2.y + r2.height < r1.y
  );
}

/**
 * In the single-user editor, every object in the local map is selectable.
 */
export function canSelectObject(objectId) {
  if (!objectId) return false;
  const objects = State.get("objects") || [];
  const obj = objects.find((o) => o.id === objectId);
  if (!obj) return false;

  // Allow selection of any existing object
  return true;
}

// This function should replace your existing getHitObjectId logic.
// You can place it in utils-client.js and import it, or add it directly to handlers.js.

/**
 * Calculates the absolute-coordinate vertices of a polygon object.
 * @param {object} obj The polygon object with properties c, a, scale, v.
 * @returns {Array<{x: number, y: number}>} An array of vertex points in world coordinates.
 */
function getAbsoluteVertices(obj) {
  const a = obj.a || 0;
  const s = obj.scale || 1;
  const r = (a * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);

  return (obj.v || []).map((lv) => {
    const scaledX = lv.x * s;
    const scaledY = lv.y * s;
    const rotatedX = scaledX * cos - scaledY * sin;
    const rotatedY = scaledX * sin + scaledY * cos;
    return { x: obj.c.x + rotatedX, y: obj.c.y + rotatedY };
  });
}

// This is the new getHitObjectId function
export function getHitObjectId(point, objects) {
  // Iterate backwards to select objects on top first
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type === "poly") {
      const absoluteVertices = getAbsoluteVertices(obj);
      if (isPointInPolygon(point, absoluteVertices)) {
        return obj.id;
      }
    } else if (obj.type === "line") {
      // FIX: Use OBB (Oriented Bounding Box) detection for precise rectangular clicks
      const start = obj.start;
      const end = computeEnd(obj); // Ensure we have the calculated end point

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      // Transform mouse point into line's local space
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      const rx = (point.x - start.x) * cos - (point.y - start.y) * sin;
      const ry = (point.x - start.x) * sin + (point.y - start.y) * cos;

      const height = typeof obj.height === "number" ? obj.height : 4;
      const halfH = height / 2;
      const buffer = 5; // Small pixel buffer for easier clicking

      // Check if point is inside the rectangle (0 to length, -halfH to halfH)
      if (
        rx >= -buffer &&
        rx <= len + buffer &&
        ry >= -halfH - buffer &&
        ry <= halfH + buffer
      ) {
        return obj.id;
      }
    } else if (obj.type === "circle") {
      if (distance(point, obj.c) < obj.radius) {
        return obj.id;
      }
    }
  }
  return null;
}

// You will also need a distanceToLineSegment helper if you don't have one
function distanceToLineSegment(p, v, w) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    p.x - (v.x + t * (w.x - v.x)),
    p.y - (v.y + t * (w.y - v.y)),
  );
}

// ----------------------- GEOMETRY FUNCTIONS --------------------------------
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
// Strict poly-decomp-only implementation.
// Throws a clear error if poly-decomp is not present (no fallback).

/**

 * Split a single concave polygon-like shape into convex polygon shapes.

 * Requires the poly-decomp UMD global to be loaded (decomp or polyDecomp).

 *

 * Input shape:

 * { v: [ [x,y], ... ], s?, a?, c? }

 *

 * Output: array of { type:'po', v: [ [x,y], ... ], s, a, c }

 */

export function splitConcaveIntoConvex(shape) {
  // detect the poly-decomp global (UMD builds expose `decomp`; some builds expose `polyDecomp`)

  const pd =
    window.decomp ||
    window.polyDecomp ||
    window.polyDecompES ||
    window.polyDecompLib;

  if (
    !pd ||
    (typeof pd.makeCCW !== "function" &&
      typeof pd.quickDecomp !== "function" &&
      typeof pd.decomp !== "function")
  ) {
    throw new Error(
      "poly-decomp library not found. Include the UMD build before your module script, for example:\n\n" +
        '<script src="https://cdn.jsdelivr.net/npm/poly-decomp@0.2.1/build/decomp.min.js"></script>\n' +
        '<script type="module" src="app.js"></script>\n\n' +
        "Make sure the poly-decomp <script> appears *before* your module script so the global is available when the module executes.",
    );
  }

  // normalize input vertices

  const inPoly =
    shape && Array.isArray(shape.v)
      ? shape.v.map((p) => [Number(p[0]), Number(p[1])])
      : [];

  if (inPoly.length < 3) return [];

  // prefer makeCCW if available

  if (typeof pd.makeCCW === "function") pd.makeCCW(inPoly);

  // choose decomposition function that definitely comes from poly-decomp

  const decompFn =
    typeof pd.quickDecomp === "function" ? pd.quickDecomp : pd.decomp;

  if (typeof decompFn !== "function") {
    // This should not happen because we checked earlier — fail loudly.

    throw new Error(
      "poly-decomp is present but does not expose quickDecomp or decomp.",
    );
  }

  // run decomposition (this is poly-decomp's algorithm)

  const convexes = decompFn(inPoly.slice());

  // remove collinear points if library exposes that helper

  if (
    Array.isArray(convexes) &&
    convexes.length > 0 &&
    typeof pd.removeCollinearPoints === "function"
  ) {
    for (let i = 0; i < convexes.length; i++) {
      pd.removeCollinearPoints(convexes[i], 0); // 0 tolerance -> strict removal
    }
  }

  // map results into your shape format

  const out = (convexes || []).map((poly) => ({
    type: "po",

    v: poly.map((p) => [Number(p[0]), Number(p[1])]),

    s: shape.s ?? 1,

    a: shape.a ?? 0,

    c: shape.c ?? [0, 0],
  }));

  // console.log(out);

  return out;
}

// ----------------------------------------------------------------
// --- NEW RDP SIMPLIFICATION (from external app) -----------------
// ----------------------------------------------------------------

/**
 * Calculates the perpendicular distance from a point to a line segment.
 * @param {Array<number>} p - Point [x, y]
 * @param {Array<number>} a - Line start [x, y]
 * @param {Array<number>} b - Line end [x, y]
 * @returns {number}
 */
function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  // If the line segment is just a point (start == end)
  // return the direct distance from p to a.
  if (lenSq === 0) {
    const pdx = p[0] - a[0];
    const pdy = p[1] - a[1];
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  let closest;
  if (t < 0) {
    closest = a;
  } else if (t > 1) {
    closest = b;
  } else {
    closest = [a[0] + t * dx, a[1] + t * dy];
  }

  const pdx = p[0] - closest[0];
  const pdy = p[1] - closest[1];
  return Math.sqrt(pdx * pdx + pdy * pdy);
}

/**
 * Simplifies a polygon using the Ramer-Douglas-Peucker algorithm.
 * @param {Array<Array<number>>} points - Array of [x, y] points
 * @param {number} epsilon - Simplification tolerance
 * @returns {Array<Array<number>>} Simplified array of points
 */
export function rdpSimplify(points, epsilon) {
  const n = points.length;
  if (n < 3) return points;

  let maxDist = 0;
  let index = 0;
  const a = points[0];
  const b = points[n - 1];

  for (let i = 1; i < n - 1; i++) {
    const p = points[i];
    const d = perpendicularDistance(p, a, b);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    // Point is important, recursively simplify
    const part1 = rdpSimplify(points.slice(0, index + 1), epsilon);
    const part2 = rdpSimplify(points.slice(index), epsilon);
    // Combine and remove the duplicated point
    return part1.slice(0, -1).concat(part2);
  } else {
    // All points in between are not important
    return [a, b];
  }
}

// ----------------------------------------------------------------
// --- NEW EARCUT-BASED SPLITTING FUNCTIONS -----------------------
// ----------------------------------------------------------------

const EPSILON = 1e-9; // For floating point comparisons

/**
 * Checks if two points are effectively equal within a small tolerance.
 * @param {Array<number>} p1 - Point [x, y]
 * @param {Array<number>} p2 - Point [x, y]
 * @returns {boolean}
 */
function arePointsEqual(p1, p2) {
  if (!p1 || !p2) return false;
  return Math.abs(p1[0] - p2[0]) < EPSILON && Math.abs(p1[1] - p2[1]) < EPSILON;
}

// public/utils-client.js
// REPLACE these two functions (near line 610)

/**
 * Calculates the 2D cross product of vectors (b-a) and (c-a).
 * @param {Array<number>} a - Point [x, y]
 * @param {Array<number>} b - Point [x, y]
 * @param {Array<number>} c - Point [x, y]
 * @returns {number}
 */
function crossProduct(a, b, c) {
  if (!a || !b || !c) return 0; // Safety check
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * Checks if a polygon (array of [x, y] vertices) is convex.
 * This version correctly handles polygons with a duplicate closing point.
 * @param {Array<Array<number>>} poly - e.g., [[x1,y1], [x2,y2], ...]
 * @returns {boolean}
 */
function isConvex(poly) {
  if (!poly || poly.length < 3) return false;

  let n = poly.length; // Start with the full length

  // --- FIX: Check for duplicate closing point ---
  const first = poly[0];
  const last = poly[n - 1];

  // Check if first and last points are (nearly) identical
  if (
    Math.abs(first[0] - last[0]) < EPSILON &&
    Math.abs(first[1] - last[1]) < EPSILON
  ) {
    // They are duplicates. Reduce n to ignore the last point in calculations.
    n = n - 1;
  }

  // If after removing the duplicate we have less than 3 vertices...
  if (n < 3) return false;
  // --- END FIX ---

  let firstSign = 0;

  // Loop from i=0 to n-1 (using the *effective* length)
  for (let i = 0; i < n; i++) {
    // Use the effective 'n' for all modulo operations
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];

    const cp = crossProduct(a, b, c);
    let sign;
    if (Math.abs(cp) < EPSILON) {
      sign = 0; // Treat as collinear
    } else {
      sign = Math.sign(cp);
    }

    if (sign !== 0) {
      if (firstSign === 0) {
        firstSign = sign;
      } else if (sign !== firstSign) {
        return false; // Signs flipped, concave
      }
    }
  }

  // Final check: if all signs were 0 (a perfect line), it's not convex.
  if (firstSign === 0) return false;

  return true; // All signs were the same
}

// public/utils-client.js

// ... (near your other exported geometry functions)

/**
 * Creates a valid polygon object from absolute vertices.
 * Correctly applies inverse rotation AND inverse scale so the shape stays consistent.
 */
export function createValidPolygonObject(
  absoluteVertices,
  polyType = "none",
  baseProps = {},
) {
  if (!absoluteVertices || absoluteVertices.length < 3) return null;
  if (polygonArea(absoluteVertices) < 1.0) return null;
  if (polygonSelfIntersects(absoluteVertices)) return null;

  const c = calculatePolygonCenter(absoluteVertices);
  if (!c || !isFinite(c.x) || !isFinite(c.y)) return null;

  // FIX: Apply inverse rotation AND inverse scale
  const angle = baseProps.a || 0;
  const s = baseProps.scale || 1; // Get current scale

  const v = absoluteVertices.map((p) => {
    // 1. Translate to center
    let rel = { x: p.x - c.x, y: p.y - c.y };

    // 2. Inverse Rotation
    if (angle !== 0) {
      rel = rotatePoint(rel, -angle);
    }

    // 3. Inverse Scale (This was missing!)
    return {
      x: rel.x / s,
      y: rel.y / s,
    };
  });

  return {
    type: "poly",
    c,
    v,
    a: angle,
    scale: s,
    polyType: polyType || "none",
    isZone: !!baseProps.isZone,
  };
}
/**
 * Returns true if the object intersects with the selection box.
 * Uses precise polygon intersection for lines to avoid loose bounding box selection.
 */
export function isObjectInSelectionBox(obj, box) {
  if (!obj || !box) return false;

  // Helper: check if any point in `points` is inside `rect`
  const anyPointInRect = (points, rect) => {
    return points.some(
      (p) =>
        p.x >= rect.x &&
        p.x <= rect.x + rect.width &&
        p.y >= rect.y &&
        p.y <= rect.y + rect.height,
    );
  };

  // Helper: check if any point in `points` is inside `poly` (using existing isPointInPolygon)
  const anyPointInPoly = (points, polyVerts) => {
    return points.some((p) => isPointInPolygon(p, polyVerts));
  };

  // Selection Box corners
  const boxCorners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];

  let objVerts = [];

  if (obj.type === "poly") {
    // Reconstruct absolute vertices for the polygon
    const c = obj.c || { x: 0, y: 0 };
    const s = obj.scale || 1;
    const rad = ((obj.a || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    objVerts = (obj.v || []).map((p) => {
      const sx = p.x * s,
        sy = p.y * s;
      return {
        x: sx * cos - sy * sin + c.x,
        y: sx * sin + sy * cos + c.y,
      };
    });
  } else if (obj.type === "line") {
    // Construct 4 corners of the thick line
    const start = obj.start;
    const end = computeEnd(obj) || obj.end;
    const h = (obj.height || 4) / 2;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);

    if (len === 0) {
      // Dot case
      return (
        box.x <= start.x + h &&
        box.x + box.width >= start.x - h &&
        box.y <= start.y + h &&
        box.y + box.height >= start.y - h
      );
    }

    const nx = (-dy / len) * h;
    const ny = (dx / len) * h;

    objVerts = [
      { x: start.x + nx, y: start.y + ny },
      { x: start.x - nx, y: start.y - ny },
      { x: end.x - nx, y: end.y - ny },
      { x: end.x + nx, y: end.y + ny },
    ];
  } else if (obj.type === "circle") {
    // AABB check is usually sufficient for circles, or distance check
    const r = obj.radius || 0;
    // Check if circle center is in expanded box (Box + radius padding)
    // This is equivalent to Circle intersects Box
    const closestX = Math.max(box.x, Math.min(obj.c.x, box.x + box.width));
    const closestY = Math.max(box.y, Math.min(obj.c.y, box.y + box.height));
    const dx = obj.c.x - closestX;
    const dy = obj.c.y - closestY;
    return dx * dx + dy * dy <= r * r;
  } else {
    return false;
  }

  // General Polygon vs Box Intersection (SAT-like check)
  // 1. Check if any Object vertex is in Box
  if (anyPointInRect(objVerts, box)) return true;

  // 2. Check if any Box vertex is in Object
  if (anyPointInPoly(boxCorners, objVerts)) return true;

  // 3. Check if any edges intersect (handles 'crossing' case)
  for (let i = 0; i < objVerts.length; i++) {
    const p1 = objVerts[i];
    const p2 = objVerts[(i + 1) % objVerts.length];
    for (let j = 0; j < 4; j++) {
      const q1 = boxCorners[j];
      const q2 = boxCorners[(j + 1) % 4];
      if (segmentsIntersect(p1, p2, q1, q2)) return true;
    }
  }

  return false;
}

/**
 * Finds the shared edge between two polygons.
 * @param {Array<Array<number>>} poly1
 * @param {Array<Array<number>>} poly2
 * @returns {object|null} Info about the shared edge or null
 */
function findSharedEdge(poly1, poly2) {
  const n1 = poly1.length;
  const n2 = poly2.length;
  for (let i = 0; i < n1; i++) {
    const p1_a = poly1[i];
    const p1_b = poly1[(i + 1) % n1];
    for (let j = 0; j < n2; j++) {
      const p2_a = poly2[j];
      const p2_b = poly2[(j + 1) % n2];
      if (arePointsEqual(p1_a, p2_b) && arePointsEqual(p1_b, p2_a)) {
        return {
          poly1_index: i, // Index of A in poly1
          poly2_index: j, // Index of B in poly2
        };
      }
    }
  }
  return null;
}

/**
 * Merges two polygons that share an edge.
 * @param {Array<Array<number>>} poly1
 * @param {Array<Array<number>>} poly2
 * @param {object} edgeInfo - From findSharedEdge
 * @returns {Array<Array<number>>} The new merged polygon
 */
function mergePolygons(poly1, poly2, edgeInfo) {
  const { poly1_index, poly2_index } = edgeInfo;
  const n1 = poly1.length;
  const n2 = poly2.length;
  const i = poly1_index;
  const j = poly2_index;

  const part1 = poly1.slice(0, i + 1);
  const part2 = [];
  let k = (j + 2) % n2;
  while (k !== (j + 1) % n2) {
    part2.push(poly2[k]);
    k = (k + 1) % n2;
  }
  const part3 = poly1.slice(i + 2);
  return part1.concat(part2, part3);
}

/**
 * Splits a polygon into triangles using Earcut.
 * Accepts shape in { v: [ [x,y], ... ] } format.
 * @param {object} shape - The input shape object
 * @returns {Array<Array<[number, number]>>} An array of triangles.
 */
function splitConcaveIntoConvexX(shape) {
  if (!shape || !Array.isArray(shape.v) || shape.v.length < 3) {
    console.error("[splitX] Invalid shape or insufficient vertices.");
    return [];
  }
  // --- FIX: Use window.earcut.default (npm version exports default) ---
  if (
    typeof window.earcut === "undefined" ||
    typeof window.earcut.default !== "function"
  ) {
    console.error(
      "earcut.js is not loaded! Cannot split polygon. (Checked window.earcut.default)",
    );
    return [];
  }

  const originalVertsArray = shape.v;
  const flatVertices = [];
  for (const p of originalVertsArray) {
    flatVertices.push(p[0], p[1]);
  }

  let indices;
  try {
    // --- FIX: Use window.earcut.default (npm version exports default) ---
    indices = window.earcut.default(flatVertices);
  } catch (e) {
    console.error("Earcut failed:", e);
    return [];
  }

  const convexPolys = [];
  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i];
    const i2 = indices[i + 1];
    const i3 = indices[i + 2];
    const v1 = originalVertsArray[i1];
    const v2 = originalVertsArray[i2];
    const v3 = originalVertsArray[i3];
    if (v1 && v2 && v3) {
      convexPolys.push([v1, v2, v3]);
    }
  }
  return convexPolys;
}

/**
 * Takes a shape, splits it into triangles, then merges them back into larger convex polygons.
 * @param {object} shape - The input shape object, { v: [ [x,y], ... ] }
 * @returns {Array<Array<[number, number]>>} An array of merged convex polygons.
 */
export function splitAndMergeConvex(shape) {
  let polygons = splitConcaveIntoConvexX(shape);
  if (polygons.length === 0) return [];

  let merged = true;
  while (merged) {
    merged = false;
    // Iterate backwards to allow safe removal
    for (let i = polygons.length - 1; i >= 1; i--) {
      if (merged) break; // A merge happened, restart outer loop
      for (let j = i - 1; j >= 0; j--) {
        const poly1 = polygons[i];
        const poly2 = polygons[j];
        const edgeInfo = findSharedEdge(poly1, poly2);

        if (edgeInfo) {
          const newPoly = mergePolygons(poly1, poly2, edgeInfo);
          if (newPoly.length < 3) continue;

          if (isConvex(newPoly)) {
            polygons[j] = newPoly; // Replace poly2 with new merged poly
            polygons.splice(i, 1); // Remove poly1
            merged = true;
            break; // Break inner loop and restart outer
          }
        }
      }
    }
  }
  return polygons;
}

// ----------------------------------------------------------------
// --- NEW AUTO-GENERATOR UTILITIES (SHARED) ----------------------
// ----------------------------------------------------------------

// --- Vector Math Helpers ---
export const v = (x, y) => ({ x, y });
export const add = (v1, v2) => v(v1.x + v2.x, v1.y + v2.y);
export const sub = (v1, v2) => v(v1.x - v2.x, v1.y - v2.y);
export const scale = (v1, s) => v(v1.x * s, v1.y * s);
export const mag = (v1) => Math.hypot(v1.x, v1.y);
export const normalize = (v1) => {
  const m = mag(v1);
  return m === 0 ? v(0, 0) : scale(v1, 1 / m);
};
export const perp = (v1) => v(-v1.y, v1.x);

// --- Random Helpers ---
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Selects a random key from a weights object.
 * e.g., { none: 1, bouncy: 1, death: 2 }
 */
export function getRandomType(weights) {
  const safe = weights && typeof weights === "object" ? weights : { none: 1 };
  // Filter out any inherited or invalid properties
  const entries = Object.entries(safe).filter(
    ([k, v]) => typeof v === "number" && v >= 0 && k !== "__proto__",
  );

  if (entries.length === 0) return "none";

  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return entries[0][0] || "none"; // Fallback if all weights are 0

  let r = randomFloat(0, total);
  for (const [k, w] of entries) {
    if (r < w) return k;
    r -= w;
  }

  return entries[entries.length - 1][0]; // Fallback
}

// --- Geometry & Collision ---

/**
 * Calculates the Axis-Aligned Bounding Box (AABB) for a set of vertices.
 */
export function calculateBoundingBox(vertices) {
  if (!vertices || vertices.length === 0)
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Checks if two AABBs overlap, with an optional padding.
 */
export function doBoundsOverlap(box1, box2, padding = 0) {
  return (
    box1.minX < box2.maxX + padding &&
    box1.maxX > box2.minX - padding &&
    box1.minY < box2.maxY + padding &&
    box1.maxY > box2.minY - padding
  );
}

/**
 * Checks if any part of a polygon is within the canvas boundaries.
 */
export function isPolygonInCanvas(vertices, canvasWidth, canvasHeight) {
  if (!vertices || vertices.length === 0) return false;
  // Check if at least one vertex is inside
  for (const v of vertices) {
    if (v.x >= 0 && v.x <= canvasWidth && v.y >= 0 && v.y <= canvasHeight)
      return true;
  }
  // TODO: Add check for polygons completely outside but whose edges cross the canvas
  return false;
}

// --- Segment Intersection Helpers ---
export function orientation(a, b, c) {
  if (!a || !b || !c) return 0;
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2; // 1 -> clockwise, 2 -> counterclockwise
}
export function onSegment(a, b, c) {
  if (!a || !b || !c) return false;
  return (
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9
  );
}
export function segmentsIntersect(p1, p2, q1, q2) {
  if (!p1 || !p2 || !q1 || !q2) return false;
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

// --- End Segment Intersection ---

/**
 * Generates a random, non-self-intersecting polygon shape via a random walk.
 * Returns a set of *local* vertices centered around {0, 0}.
 * @param {object} opts - Options object { minVertices, maxVertices, minArea, maxArea }
 * @returns {Array<{x, y}>|null} Array of local vertices or null on failure.
 */
export function generateRandomVertices(opts) {
  const {
    minVertices = 3,
    maxVertices = 8,
    minArea = 1000,
    maxArea = 10000,
  } = opts;
  const perVertexAttempts = 12;
  const maxPolygonAttempts = 30; // Max attempts to generate one valid polygon

  function generateLocalWalk(numVertices, targetArea) {
    const maxTurn = Math.PI * 0.9;
    const baseline = Math.sqrt(
      Math.max(1, targetArea) / Math.max(3, numVertices),
    );
    const minStep = Math.max(1, baseline * 0.35);
    const maxStep = Math.max(minStep + 0.1, baseline * 1.8);

    for (let globalTry = 0; globalTry < 3; globalTry++) {
      const verts = [{ x: 0, y: 0 }];
      let angle = randomFloat(0, Math.PI * 2);
      let x = 0,
        y = 0;

      let failed = false;
      for (let i = 1; i < numVertices; i++) {
        let placed = false;
        for (let tryV = 0; tryV < perVertexAttempts; tryV++) {
          const delta = randomFloat(-maxTurn, maxTurn);
          const newAngle = angle + delta;
          const step = randomFloat(minStep, maxStep);
          const nx = x + Math.cos(newAngle) * step;
          const ny = y + Math.sin(newAngle) * step;
          const candidate = { x: nx, y: ny };

          if (Math.hypot(nx - x, ny - y) < 1e-3) continue;

          let intersects = false;
          for (let e = 0; e < verts.length - 2; e++) {
            if (
              segmentsIntersect(
                verts[verts.length - 1],
                candidate,
                verts[e],
                verts[e + 1],
              )
            ) {
              intersects = true;
              break;
            }
          }
          if (intersects) continue;

          verts.push(candidate);
          x = nx;
          y = ny;
          angle = newAngle;
          placed = true;
          break;
        }
        if (!placed) {
          failed = true;
          break;
        }
      }
      if (failed) continue;

      const n = verts.length;
      if (n >= 3) {
        let closesOK = true;
        for (let e = 1; e < n - 2; e++) {
          if (
            segmentsIntersect(verts[n - 1], verts[0], verts[e], verts[e + 1])
          ) {
            closesOK = false;
            break;
          }
        }
        if (!closesOK) continue;
      }
      return verts;
    }
    return null;
  }

  for (let attempt = 0; attempt < maxPolygonAttempts; attempt++) {
    const numVertices = randomInt(minVertices, maxVertices);
    const targetArea = Math.max(1, randomFloat(minArea, maxArea));

    const local = generateLocalWalk(numVertices, targetArea);
    if (!local) continue;

    const centroid = calculatePolygonCenter(local);
    if (!centroid) continue;
    const recentered = local.map((p) => ({
      x: p.x - centroid.x,
      y: p.y - centroid.y,
    }));

    const currentArea = polygonArea(recentered);
    if (!isFinite(currentArea) || Math.abs(currentArea) < 1e-6) continue;

    const scale = Math.sqrt(Math.abs(targetArea / currentArea));
    const scaled = recentered.map((p) => ({ x: p.x * scale, y: p.y * scale }));

    return scaled; // Return the local, scaled vertices
  }

  return null; // Failed to generate
}

/**
 * Translates local vertices to an absolute position.
 * @param {Array<{x, y}>} localVertices - Vertices centered around {0, 0}.
 * @param {{x, y}} center - The target absolute center position.
 * @returns {Array<{x, y}>} Array of absolute-position vertices.
 */
export function translateVertices(localVertices, center) {
  if (!localVertices || !center) return [];
  return localVertices.map((p) => ({ x: p.x + center.x, y: p.y + center.y }));
}

/**
 * Splits absolute vertices into convex polygons and formats them for the server.
 * @param {Array<{x, y}>} vertices - Absolute-position vertices.
 * @param {string} polyType - "none", "bouncy", or "death".
 * @returns {Array<object>} Array of formatted polygon objects for `createObjectsBatch`.
 */
export function splitAndFormatPolygons(vertices, polyType) {
  if (!vertices || vertices.length < 3) return [];
  const shape = { v: vertices.map((p) => [p.x, p.y]) };

  // Use the existing utility for splitting
  const convex = splitConcaveIntoConvex(shape);
  if (!convex || convex.length === 0) return [];

  const formatted = convex
    .map((cp) => {
      const abs = cp.v.map((p) => ({ x: p[0], y: p[1] }));
      if (abs.length < 3) return null;
      const c = calculatePolygonCenter(abs);
      if (!c) return null;
      const v = abs.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
      // Format for createObjectsBatch
      return { type: "poly", c, v, a: 0, scale: 1, polyType };
    })
    .filter(Boolean); // Filter out any nulls from failed calculations

  return formatted;
}

/**
 * Makes a config object editable via the console.
 * @param {string} windowVarName - The name for the `window` variable (e.g., "PLATFORMER_CONFIG").
 * @param {object} configObj - The internal config object to expose.
 * @param {function} updateFn - The function that will be exposed on `window` to update the config.
 */
export function makeConfigEditable(windowVarName, configObj, updateFn) {
  if (typeof window !== "undefined") {
    window[windowVarName] = configObj;
    window[`UPDATE_${windowVarName}`] = (patch) => {
      if (typeof patch === "function") {
        try {
          const result = patch(JSON.parse(JSON.stringify(configObj)));
          if (result && typeof result === "object") {
            safeDeepMerge(configObj, result);
            console.info(`${windowVarName} updated via function patch.`);
          } else {
            console.warn(
              `Function did not return an object. ${windowVarName} not modified.`,
            );
          }
        } catch (err) {
          console.error(
            `Error applying function patch to ${windowVarName}:`,
            err,
          );
        }
      } else if (patch && typeof patch === "object") {
        safeDeepMerge(configObj, patch);
        console.info(`${windowVarName} patched.`);
      } else {
        console.warn(
          `UPDATE_${windowVarName} expects an object patch or a function returning a patch.`,
        );
      }
      console.log(
        `Current ${windowVarName}:`,
        JSON.parse(JSON.stringify(configObj)),
      );
    };
  }
}

/**
 * Safely merges properties from `patch` into `target` without prototype pollution.
 */
export function safeDeepMerge(target, patch) {
  if (!patch || typeof patch !== "object") return target;
  const stack = [[target, patch]];
  while (stack.length) {
    const [t, p] = stack.pop();
    for (const key of Object.keys(p)) {
      if (key === "__proto__" || key === "constructor") continue;
      const pv = p[key];
      // Merge plain objects, replace arrays/other
      if (
        pv &&
        typeof pv === "object" &&
        !Array.isArray(pv) &&
        Object.prototype.toString.call(pv) === "[object Object]"
      ) {
        if (
          !t[key] ||
          typeof t[key] !== "object" ||
          Array.isArray(t[key]) ||
          Object.prototype.toString.call(t[key]) !== "[object Object]"
        ) {
          t[key] = {};
        }
        stack.push([t[key], pv]);
      } else {
        t[key] = pv;
      }
    }
  }
  return target;
}

// ... (inside utils-client.js, at the end of the SHARED section) ...

/**
 * Selects a random item from an array.
 */
export function randChoice(arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Calculates segment lengths and total length for a path.
 * @param {Array<{x, y}>} path
 * @returns {{segLengths: Array<number>, total: number}}
 */
export function computePathLengths(path) {
  const segLengths = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x;
    const dy = path[i + 1].y - path[i].y;
    const l = Math.hypot(dx, dy);
    segLengths.push(l);
    total += l;
  }
  return { segLengths, total };
}

/**
 * Gets the unit tangent vector for a path segment.
 * @param {Array<{x, y}>} path
 * @param {number} idx
 * @returns {{x: number, y: number}}
 */
export function tangentOfSegment(path, idx) {
  const a = path[Math.max(0, Math.min(idx, path.length - 2))];
  const b = path[Math.max(1, Math.min(idx + 1, path.length - 1))];
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Samples a point and its tangent at a normalized (0-1) distance along a path.
 * @param {Array<{x, y}>} path
 * @param {number} t - Normalized distance (0 to 1)
 * @param {Array<number>} segLengths
 * @param {number} totalLength
 * @returns {{p: {x, y}, tangent: {x, y}}}
 */
export function samplePointAndTangent(path, t, segLengths, totalLength) {
  if (t <= 0) return { p: { ...path[0] }, tangent: tangentOfSegment(path, 0) };
  if (t >= 1)
    return {
      p: { ...path[path.length - 1] },
      tangent: tangentOfSegment(path, path.length - 2),
    };
  const target = t * totalLength;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const l = segLengths[i];
    if (acc + l >= target) {
      const localT = l > 0 ? (target - acc) / l : 0;
      const a = path[i],
        b = path[i + 1];
      const px = a.x + (b.x - a.x) * localT;
      const py = a.y + (b.y - a.y) * localT;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { p: { x: px, y: py }, tangent: { x: dx / len, y: dy / len } };
    }
    acc += l;
  }
  return {
    p: { ...path[path.length - 1] },
    tangent: tangentOfSegment(path, path.length - 2),
  };
}

/**
 * Checks if a simple polygon self-intersects.
 * Assumes vertices are {x, y} objects.
 * @param {Array<{x, y}>} poly - Array of vertices
 * @returns {boolean}
 */
export function polygonSelfIntersects(poly) {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n]; // Edge A
    // Check against all non-adjacent segments
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent segments
      if (j === (i + 1) % n || (i === 0 && j === n - 1)) {
        continue;
      }
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n]; // Edge B
      if (segmentsIntersect(a1, a2, b1, b2)) {
        console.warn(
          "Self-intersection detected between edges:",
          [a1, a2],
          [b1, b2],
        );
        return true;
      }
    }
  }
  return false;
}

// --- ADD THESE FUNCTIONS TO utils-client.js ---

const EPS = 1e-9;

/**
 * Clamps a value between a min and max.
 */
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Clamps a point to be within the canvas boundaries.
 */
export function clampToCanvasPoint(p, w, h) {
  if (!p) return { x: 0, y: 0 };
  return { x: clamp(p.x, 0, w), y: clamp(p.y, 0, h) };
}

/**
 * build a per-segment polygon (rectangle + semicircular caps).
 * returns a closed ring: [ [x,y], ... ]
 */
export function buildSegmentBlob(
  a,
  b,
  halfWidth,
  capSteps = 12,
  canvasW = Infinity,
  canvasH = Infinity,
) {
  const v = { x: b.x - a.x, y: b.y - a.y };
  const L = Math.hypot(v.x, v.y);

  // If segment degenerate (point), return a full circle polygon centered at a
  if (L < 1e-6) {
    const ring = [];
    for (let i = 0; i <= capSteps; i++) {
      const phi = (i / capSteps) * Math.PI * 2;
      const px = a.x + Math.cos(phi) * halfWidth;
      const py = a.y + Math.sin(phi) * halfWidth;
      ring.push([clamp(px, 0, canvasW), clamp(py, 0, canvasH)]);
    }
    return dedupeAndCloseRing(ring);
  }

  const theta = Math.atan2(v.y, v.x);
  // normal (left side) unit vector
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);

  const leftA = { x: a.x + nx * halfWidth, y: a.y + ny * halfWidth };
  const leftB = { x: b.x + nx * halfWidth, y: b.y + ny * halfWidth };
  const rightB = { x: b.x - nx * halfWidth, y: b.y - ny * halfWidth };
  const rightA = { x: a.x - nx * halfWidth, y: a.y - ny * halfWidth };

  // Arc at B: from (theta + PI/2) down to (theta - PI/2)
  const arcB = [];
  for (let i = 0; i <= capSteps; i++) {
    const t = i / capSteps;
    const phi = theta + Math.PI / 2 + -1 * t * Math.PI; // from +90 to -90
    const px = b.x + Math.cos(phi) * halfWidth;
    const py = b.y + Math.sin(phi) * halfWidth;
    arcB.push([clamp(px, 0, canvasW), clamp(py, 0, canvasH)]);
  }

  // Arc at A: from (theta - PI/2) up to (theta + PI/2)
  const arcA = [];
  for (let i = 0; i <= capSteps; i++) {
    const t = i / capSteps;
    const phi = theta - Math.PI / 2 + t * Math.PI; // from -90 to +90
    const px = a.x + Math.cos(phi) * halfWidth;
    const py = a.y + Math.sin(phi) * halfWidth;
    arcA.push([clamp(px, 0, canvasW), clamp(py, 0, canvasH)]);
  }

  const ring = [];
  ring.push([clamp(leftA.x, 0, canvasW), clamp(leftA.y, 0, canvasH)]);
  ring.push([clamp(leftB.x, 0, canvasW), clamp(leftB.y, 0, canvasH)]);
  for (const p of arcB) ring.push(p);
  ring.push([clamp(rightB.x, 0, canvasW), clamp(rightB.y, 0, canvasH)]);
  ring.push([clamp(rightA.x, 0, canvasW), clamp(rightA.y, 0, canvasH)]);
  for (const p of arcA) ring.push(p);

  return dedupeAndCloseRing(ring);
}

/**
 * Format a polygon ring to polygon-clipping MultiPolygon shape: [ [ ring ] ]
 */
export function ringToMultiPolygon(ring) {
  return [[ring]];
}

/**
 * Calculates signed area of a ring.
 */
export function signedArea(ring) {
  if (!ring) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length];
    if (!p || !q) continue;
    a += p[0] * q[1] - p[1] * q[0];
  }
  return 0.5 * a;
}

/**
 * Ensure ring is closed and has no near-duplicate consecutive points
 */
export function dedupeAndCloseRing(pts, eps = 0.5) {
  if (!pts || pts.length === 0) return [];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    if (
      out.length === 0 ||
      Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) >
        eps
    ) {
      out.push([p[0], p[1]]);
    }
  }
  if (out.length >= 3) {
    const first = out[0],
      last = out[out.length - 1];
    if (
      Math.abs(first[0] - last[0]) > EPS ||
      Math.abs(first[1] - last[1]) > EPS
    ) {
      out.push([first[0], first[1]]);
    }
  }
  return out;
}

/**
 * Raycast helper used in hole-stitching.
 */
export function intersectRayRightWithSegment(hx, hy, a, b) {
  if (!a || !b) return null;
  if ((a[1] < hy && b[1] < hy) || (a[1] > hy && b[1] > hy)) return null;
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-9) return null;
  const t = (hy - a[1]) / dy;
  if (t < 0 || t > 1) return null;
  const ix = a[0] + t * (b[0] - a[0]);
  if (ix <= hx + 1e-9) return null;
  return ix;
}

/**
 * Stitches a hole into an outer polygon ring.
 */
export function stitchHoleIntoOuter(outer, hole) {
  const out = outer.slice(
    0,
    outer[outer.length - 1][0] === outer[0][0] &&
      outer[outer.length - 1][1] === outer[0][1]
      ? -1
      : outer.length,
  );
  const hl = hole.slice(
    0,
    hole[hole.length - 1][0] === hole[0][0] &&
      hole[hole.length - 1][1] === hole[0][1]
      ? -1
      : hole.length,
  );

  // rightmost point of hole
  let hi = 0;
  for (let i = 1; i < hl.length; i++) {
    if (
      hl[i][0] > hl[hi][0] ||
      (Math.abs(hl[i][0] - hl[hi][0]) < 1e-9 && hl[i][1] < hl[hi][1])
    )
      hi = i;
  }
  const hv = hl[hi];

  let best = null;
  for (let j = 0; j < out.length; j++) {
    const a = out[j];
    const b = out[(j + 1) % out.length];
    const ix = intersectRayRightWithSegment(hv[0], hv[1], a, b);
    if (ix !== null) {
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t =
        Math.abs(dx) > Math.abs(dy)
          ? (ix - a[0]) / (dx || 1)
          : (hv[1] - a[1]) / (dy || 1);
      const dist = ix - hv[0];
      if (dist > 0 && (!best || dist < best.dist)) {
        best = { edgeIndex: j, px: a[0] + t * dx, py: a[1] + t * dy, dist };
      }
    }
  }

  if (!best) {
    // fallback: connect to nearest vertex
    let nearestIdx = 0,
      bestD = Infinity;
    for (let j = 0; j < out.length; j++) {
      const d = Math.hypot(out[j][0] - hv[0], out[j][1] - hv[1]);
      if (d < bestD) {
        bestD = d;
        nearestIdx = j;
      }
    }
    const part1 = out.slice(0, nearestIdx + 1);
    const part2 = out.slice(nearestIdx + 1);
    const holeSeq = hl.slice(hi).concat(hl.slice(0, hi + 1));
    return part1.concat(holeSeq, part2, [part1[0]]);
  }

  const j = best.edgeIndex;
  const interPt = [best.px, best.py];
  const newOuter = [];
  for (let k = 0; k <= j; k++) newOuter.push(out[k]);
  newOuter.push(interPt);
  for (let k = j + 1; k < out.length; k++) newOuter.push(out[k]);

  const outerInsertIdx = j + 1;
  const prefix = newOuter.slice(0, outerInsertIdx + 1);
  const suffix = newOuter.slice(outerInsertIdx);
  const holeTraversal = hl.slice(hi).concat(hl.slice(0, hi + 1));

  const stitched = prefix.concat(holeTraversal, suffix, [prefix[0]]);

  return stitched;
}

export const areaOfRing = (ring) => Math.abs(signedArea(ring));

export const dedupeRing = (ring, eps = EPS_DEDUPE) => {
  if (!ring || ring.length < 3) return ring;

  const out = [ring[0]];

  for (let i = 1; i < ring.length; i++) {
    const a = ring[i],
      b = out[out.length - 1];

    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > eps) out.push(a);
  }

  if (out.length >= 3) {
    const f = out[0],
      l = out[out.length - 1];

    if (Math.abs(f[0] - l[0]) > EPS || Math.abs(f[1] - l[1]) > EPS)
      out.push([f[0], f[1]]);
  }

  return out;
};

/**
 * Rotates a point around a pivot by a specific angle.
 */
export function rotateAround(point, pivot, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/**
 * Calculates the geometric center of a list of selected objects.
 */
export function getGroupCentroid(objects) {
  let sx = 0,
    sy = 0,
    count = 0;
  objects.forEach((o) => {
    if (o.type === "line") {
      // For lines, use the midpoint
      sx += (o.start.x + o.end.x) / 2;
      sy += (o.start.y + o.end.y) / 2;
    } else if (o.c) {
      // For polys and circles, use their center 'c'
      sx += o.c.x;
      sy += o.c.y;
    }
    count++;
  });
  return count > 0 ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
}

export function handleGroupRotation(selectedObjects, angleDelta) {
  if (!selectedObjects || selectedObjects.length === 0) return;
  const centroid = getGroupCentroid(selectedObjects);
  const allObjects = State.get("objects");
  const updatedObjects = allObjects.map((o) => ({ ...o }));

  selectedObjects.forEach((obj) => {
    const stateObj = updatedObjects.find((x) => x.id === obj.id);
    if (!stateObj) return;

    if (obj.type === "poly" || obj.type === "circle") {
      stateObj.c = rotateAround(obj.c, centroid, angleDelta);
      stateObj.a = (obj.a || 0) + angleDelta;
    } else if (obj.type === "line") {
      const newStart = rotateAround(obj.start, centroid, angleDelta);
      const newEnd = rotateAround(obj.end, centroid, angleDelta);
      stateObj.start = newStart;
      stateObj.end = newEnd;
      stateObj.angle =
        (Math.atan2(newEnd.y - newStart.y, newEnd.x - newStart.x) * 180) /
        Math.PI;
    }
  });

  State.set("objects", updatedObjects);

  if (window._groupRotTimeout) clearTimeout(window._groupRotTimeout);
  window._groupRotTimeout = setTimeout(() => {
    if (window.saveMapSnapshot) window.saveMapSnapshot();
    const latestObjs = State.get("objects");
    const batchPayloads = selectedObjects
      .map((obj) => {
        const stateObj = latestObjs.find((x) => x.id === obj.id);
        if (!stateObj) return null;
        if (stateObj.type === "line") {
          return {
            id: stateObj.id,
            start: stateObj.start,
            end: stateObj.end,
            angle: stateObj.angle,
          };
        }
        return { id: stateObj.id, c: stateObj.c, a: stateObj.a };
      })
      .filter(Boolean);
    LocalStore.updateObjectsBatch(batchPayloads);
  }, 300);
}

export function handleGroupScaling(selectedObjects, scaleDelta) {
  if (!selectedObjects || selectedObjects.length === 0) return;

  const centroid = getGroupCentroid(selectedObjects);
  const allObjects = State.get("objects");
  const updatedObjects = allObjects.map((o) => ({ ...o }));
  const multiplier = scaleDelta > 0 ? 1.05 : 1 / 1.05;

  selectedObjects.forEach((obj) => {
    const stateObj = updatedObjects.find((x) => x.id === obj.id);
    if (!stateObj) return;

    if (obj.type === "poly" || obj.type === "circle") {
      const dx = obj.c.x - centroid.x;
      const dy = obj.c.y - centroid.y;
      stateObj.c = {
        x: centroid.x + dx * multiplier,
        y: centroid.y + dy * multiplier,
      };
      if (obj.type === "poly") stateObj.scale = (obj.scale || 1) * multiplier;
      if (obj.type === "circle")
        stateObj.radius = (obj.radius || 50) * multiplier;
    } else if (obj.type === "line") {
      const dx1 = obj.start.x - centroid.x;
      const dy1 = obj.start.y - centroid.y;
      const dx2 = obj.end.x - centroid.x;
      const dy2 = obj.end.y - centroid.y;
      stateObj.start = {
        x: centroid.x + dx1 * multiplier,
        y: centroid.y + dy1 * multiplier,
      };
      stateObj.end = {
        x: centroid.x + dx2 * multiplier,
        y: centroid.y + dy2 * multiplier,
      };
      stateObj.height = (obj.height || 4) * multiplier;
      stateObj.width = Math.hypot(
        stateObj.end.x - stateObj.start.x,
        stateObj.end.y - stateObj.start.y,
      );
      stateObj.angle =
        (Math.atan2(
          stateObj.end.y - stateObj.start.y,
          stateObj.end.x - stateObj.start.x,
        ) *
          180) /
        Math.PI;
    }
  });

  State.set("objects", updatedObjects);

  if (window._groupScaleTimeout) clearTimeout(window._groupScaleTimeout);
  window._groupScaleTimeout = setTimeout(() => {
    if (window.saveMapSnapshot) window.saveMapSnapshot();
    const latestObjs = State.get("objects");
    const batchPayloads = selectedObjects
      .map((obj) => {
        const stateObj = latestObjs.find((x) => x.id === obj.id);
        if (!stateObj) return null;
        if (stateObj.type === "line") {
          return {
            id: stateObj.id,
            start: stateObj.start,
            end: stateObj.end,
            height: stateObj.height,
            width: stateObj.width,
            angle: stateObj.angle,
          };
        } else if (stateObj.type === "poly") {
          return { id: stateObj.id, scale: stateObj.scale, c: stateObj.c };
        } else if (stateObj.type === "circle") {
          return { id: stateObj.id, radius: stateObj.radius, c: stateObj.c };
        }
      })
      .filter(Boolean);
    LocalStore.updateObjectsBatch(batchPayloads);
  }, 300);
}

export function getSpatialShade(
  rgbStr,
  obj,
  style = "left-to-right",
  variation = 30,
) {
  if (!rgbStr || typeof rgbStr !== "string") return rgbStr;
  const match = rgbStr.match(/\d+/g);
  if (!match || match.length < 3) return rgbStr;

  let x = 500,
    y = 300;
  if (obj.c) {
    x = obj.c.x;
    y = obj.c.y;
  } else if (obj.start && obj.end) {
    x = (obj.start.x + obj.end.x) / 2;
    y = (obj.start.y + obj.end.y) / 2;
  }

  const nx = Math.max(0, Math.min(1, x / 1000));
  const ny = Math.max(0, Math.min(1, y / 600));

  let factor = 0;
  switch (style) {
    case "left-to-right":
      factor = nx * 2 - 1;
      break;
    case "right-to-left":
      factor = 1 - nx * 2;
      break;
    case "top-to-bottom":
      factor = ny * 2 - 1;
      break;
    case "bottom-to-top":
      factor = 1 - ny * 2;
      break;
    case "diagonal-nw-se":
      factor = ((nx + ny) / 2) * 2 - 1;
      break;
    case "diagonal-ne-sw":
      factor = ((1 - nx + ny) / 2) * 2 - 1;
      break;
    case "radial-out":
      factor = Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2) * 2 - 1;
      break;
    case "radial-in":
      factor = 1 - Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2) * 2;
      break;
    default:
      factor = 0;
  }

  // Multiply the normalized direction factor by the user's custom Range
  const shift = Math.floor(factor * variation);
  const [r, g, b] = match.map(Number);
  const clamp = (v) => Math.max(0, Math.min(255, v));

  return `rgb(${clamp(r + shift)}, ${clamp(g + shift)}, ${clamp(b + shift)})`;
}
// ==========================================
// MAP HISTORY TRACKING ENGINE (UNDO/REDO)
// ==========================================
export const MapHistory = {
  history: [],
  currentIndex: -1,
  isRestoring: false,
  pendingSave: null,

  init(State, LocalStore) {
    this.State = State;
    this.LocalStore = LocalStore;
    setTimeout(() => this.saveSnapshot(), 1000);
  },

  saveSnapshot() {
    if (this.isRestoring || !this.State) return;

    // Upgraded state payload to capture environmental bounds
    const currentState = {
      objects: JSON.parse(JSON.stringify(this.State.get("objects") || [])),
      spawnCircle: JSON.parse(
        JSON.stringify(this.State.get("spawnCircle") || null),
      ),
      capZone: JSON.parse(JSON.stringify(this.State.get("capZone") || null)),
    };

    if (this.currentIndex >= 0) {
      const last = this.history[this.currentIndex];
      if (JSON.stringify(last) === JSON.stringify(currentState)) return;
    }

    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push(currentState);

    if (this.history.length > 200) this.history.shift();
    this.currentIndex = this.history.length - 1;
  },

  debouncedSave() {
    if (this.pendingSave) return;
    this.saveSnapshot();
    this.pendingSave = setTimeout(() => {
      this.pendingSave = null;
    }, 400);
  },

  undo() {
    if (this.currentIndex > 0) {
      const current = {
        objects: this.State.get("objects") || [],
        spawnCircle: this.State.get("spawnCircle") || null,
        capZone: this.State.get("capZone") || null,
      };
      if (
        JSON.stringify(current) !==
        JSON.stringify(this.history[this.currentIndex])
      ) {
        this.saveSnapshot();
      }
      this.currentIndex--;
      this.restore(this.history[this.currentIndex]);
    } else {
      showToast("Nothing to undo", true);
    }
  },

  redo() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      this.restore(this.history[this.currentIndex]);
    } else {
      showToast("Nothing to redo", true);
    }
  },

  restore(targetState) {
    this.isRestoring = true;

    // Handle retro-compatibility for pre-upgrade array-based histories
    const targetObjects = Array.isArray(targetState)
      ? targetState
      : targetState.objects || [];
    const targetSpawn = Array.isArray(targetState)
      ? null
      : targetState.spawnCircle;
    const targetCap = Array.isArray(targetState) ? null : targetState.capZone;

    const current = this.State.get("objects") || [];

    const toDelete = current.filter(
      (c) => !targetObjects.some((t) => t.id === c.id),
    );
    toDelete.forEach((o) => this.LocalStore.deleteObject(o.id));

    const toAdd = targetObjects.filter(
      (t) => !current.some((c) => c.id === t.id),
    );

    const toUpdate = targetObjects.filter((t) => {
      const c = current.find((x) => x.id === t.id);
      return c && JSON.stringify(c) !== JSON.stringify(t);
    });

    if (toUpdate.length > 0) {
      this.LocalStore.updateObjectsBatch(toUpdate);
    }

    if (toAdd.length > 0) {
      const objectsToCreate = toAdd.map((obj) => ({
        ...obj,
        _historyOldId: obj.id,
        id: undefined,
      }));
      this.LocalStore.createObjectsBatch({
        objects: objectsToCreate,
        isAutoGeneration: false,
      });
    }

    // Restore environment locations seamlessly
    if (targetSpawn && targetSpawn.x !== null) {
      this.LocalStore.setSpawnCircle({ x: targetSpawn.x, y: targetSpawn.y });
    }
    if (targetCap && targetCap.x !== null) {
      this.LocalStore.setCapZone({ x: targetCap.x, y: targetCap.y });
    }

    showToast(
      `Restored version ${this.currentIndex + 1}/${this.history.length}`,
    );
    setTimeout(() => {
      this.isRestoring = false;
    }, 500);
  },

  handleNewObjects(newObjects) {
    if (!newObjects || !Array.isArray(newObjects)) return;
    newObjects.forEach((newObj) => {
      if (newObj._historyOldId) {
        const oldId = newObj._historyOldId;
        const newId = newObj.id;
        this.history.forEach((snapshot) => {
          const objs = Array.isArray(snapshot) ? snapshot : snapshot.objects;
          const obj = objs.find(
            (o) => o.id === oldId || o._historyOldId === oldId,
          );
          if (obj) {
            obj.id = newId;
            delete obj._historyOldId;
          }
        });
      } else {
        this.history.forEach((snapshot) => {
          const objs = Array.isArray(snapshot) ? snapshot : snapshot.objects;
          const obj = objs.find(
            (o) =>
              o.type === newObj.type &&
              o.id !== newObj.id &&
              JSON.stringify(o.c || o.start) ===
                JSON.stringify(newObj.c || newObj.start),
          );
          if (obj && !newObjects.find((x) => x.id === obj.id)) {
            obj.id = newObj.id;
          }
        });
      }
    });
  },
};
