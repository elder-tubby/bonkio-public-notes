// Canvas drawing logic
import State from "./state.js";
import UI from "./ui.js";
import { getSpatialShade } from "./utils-client.js";
function computeAbsoluteVerticesForCanvas(obj) {
  const a = obj.a || 0;
  const s = obj.scale || 1;
  return (obj.v || []).map((lv) => {
    const scaled = { x: lv.x * s, y: lv.y * s };
    const r = (a * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const rotatedX = scaled.x * cos - scaled.y * sin;
    const rotatedY = scaled.x * sin + scaled.y * cos;
    return { x: obj.c.x + rotatedX, y: obj.c.y + rotatedY };
  });
}

class Canvas {
  static draw() {
    const { canvas, ctx } = UI.elems;
    const colorState = State.get("colors") || {};
    const stateColors = colorState.colors || colorState;

    // Change cursor dynamically when in Camera Mode
    canvas.style.cursor = State.get("cameraMode") ? "move" : "crosshair";

    ctx.fillStyle = stateColors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save(); // --- START CAMERA TRANSFORM ---

    const zoom = State.get("cameraZoom") || 1;
    const offset = State.get("cameraOffset") || { x: 0, y: 0 };
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Apply transform globally so users can edit the map while zoomed/panned
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx + offset.x, -cy + offset.y);

    if (State.get("cameraMode")) {
      // Draw the boundaries of the original map/canvas to help the user orient themselves
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 3 / zoom;
      ctx.setLineDash([15 / zoom, 15 / zoom]);
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
      ctx.setLineDash([]);
    }

    ctx.lineWidth = 4.452;
    ctx.strokeStyle = "white";
    ctx.font = "12px Lexend";
    ctx.fillStyle = "white";
    ctx.textAlign = "left";

    const objects = State.get("objects");
    const preview = State.get("draggingPreview");

    // --- Draw all objects (Lines and Polygons) ---
    objects.forEach((obj) => {
      if (preview && preview.originalObjects?.some((p) => p.id === obj.id)) {
        return; // Skip drawing the original object while its preview is being dragged
      }

      const isSelected = State.isSelected(obj.id);

      // Type colors are the live palette. Object colors are snapshots from when
      // the shape was created, so only use one if no palette color is available.
      const t = obj.lineType || obj.polyType || obj.circleType || "none";
      let baseColor = stateColors[t] || obj.color || "white";
      let drawColor = baseColor;

      // 2. Client-Side Dynamic Shading Application
      const shadingStyles = stateColors.shadingStyles || {};
      let shouldShade = false;
      let style = "";

      if (t === "none" && stateColors.useShades) {
        shouldShade = true;
        style = shadingStyles.none;
      }
      if (t === "death" && stateColors.shadeDeath) {
        shouldShade = true;
        style = shadingStyles.death;
      }
      if (t === "bouncy" && stateColors.shadeBouncy) {
        shouldShade = true;
        style = shadingStyles.bouncy;
      }

      if (shouldShade && style) {
        const range =
          State.get("shadingRange") !== undefined
            ? State.get("shadingRange")
            : 30;
        drawColor = getSpatialShade(baseColor, obj, style, range);
      }

      ctx.fillStyle = drawColor;
      ctx.strokeStyle = drawColor; // For lines

      if (obj.type === "poly") {
        const { v, c, a, polyType, scale } = obj;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((a * Math.PI) / 180);
        ctx.scale(scale || 1, scale || 1);
        console.log("Scale value in canvas:", scale);

        ctx.beginPath();
        ctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) {
          ctx.lineTo(v[i].x, v[i].y);
        }
        ctx.closePath();

        // Only fill if it's NOT a zone
        if (!obj.isZone) {
          ctx.fill();
        }

        if (isSelected) {
          ctx.strokeStyle = "yellow";
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        if (obj.isZone) {
          ctx.strokeStyle = "white"; // Solid white outline
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();

      } else if (obj.type === "circle") {
        const { c, radius, circleType } = obj;
        const isSelected = State.isSelected(obj.id);

        ctx.save();

        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, 2 * Math.PI);

        if (!obj.isZone) {
          ctx.fill();
        }

        if (isSelected) {
          ctx.strokeStyle = "yellow";
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        if (obj.isZone) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.stroke();
        }
        ctx.restore();

      } else if (obj.type === "line") {
        const { start, end, width, height, angle } = obj;
        const computeEnd = (line) => {
          if (
            typeof line.width === "number" &&
            typeof line.angle === "number"
          ) {
            const r = (line.angle * Math.PI) / 180;
            return {
              x: line.start.x + Math.cos(r) * line.width,
              y: line.start.y + Math.sin(r) * line.width,
            };
          }
          return line.end;
        };

        const drawEnd = computeEnd({ start, end, width, angle });

        const visualThickness = Math.max(1, Math.round(height ?? 4));

        ctx.save();
        if (isSelected) {
          ctx.lineWidth = Math.max(visualThickness + 4, 6);
          ctx.strokeStyle = "yellow";
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(drawEnd.x, drawEnd.y);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(drawEnd.x, drawEnd.y);

        if (obj.isZone) {
          // Creates a hollow "see-through" line effect
          ctx.lineWidth = visualThickness;
          ctx.strokeStyle = "white";
          ctx.stroke();
          ctx.lineWidth = Math.max(1, visualThickness - 4);
          ctx.strokeStyle = stateColors.background;
          ctx.stroke();
        } else {
          ctx.lineWidth = visualThickness;
          ctx.strokeStyle = drawColor;
          ctx.stroke();
        }

        ctx.restore();
      }
    });

    // Draw vertex handles for selec  ted polygons (use draggingPreview objects if present)
    const selectedIds = State.get("selectedObjectIds") || [];
    const vertexDragState = State.get("vertexDrag");

    selectedIds.forEach((selId) => {
      // Prefer preview object for live feedback if available
      let obj = State.get("objects").find((o) => o.id === selId);
      if (preview && preview.objects) {
        const pObj = preview.objects.find((po) => po.id === selId);
        if (pObj) obj = pObj;
      }
      if (!obj || obj.type !== "poly") return;

      // Compute absolute vertices to draw handles
      const absVerts = computeAbsoluteVerticesForCanvas(obj);

      ctx.save();
      for (let i = 0; i < absVerts.length; i++) {
        const pt = absVerts[i];

        // If there is a vertexDrag state, and this is the object being dragged, highlight appropriately
        let isActive = false;
        if (vertexDragState && vertexDragState.objectId === selId) {
          // If the vertexDragState contains currentAbsVerts, prefer that (live)
          if (
            vertexDragState.currentAbsVerts &&
            vertexDragState.currentAbsVerts[i]
          ) {
            // override pt with live computed position
            const live = vertexDragState.currentAbsVerts[i];
            ctx.beginPath();
            ctx.arc(live.x, live.y, 7, 0, Math.PI * 2);
          } else {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
          }
          isActive = vertexDragState.vertexIndex === i;
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        }

        // Fill + stroke for visibility
        ctx.fillStyle = isActive ? "yellow" : "white";
        ctx.fill();
        ctx.lineWidth = isActive ? 2 : 1.5;
        ctx.strokeStyle = "black";
        ctx.stroke();
      }
      ctx.restore();
    });

    // --- Draw Dragging Previews ---
    if (preview && preview.objects) {
      preview.objects.forEach((p_obj) => {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = "yellow";

        if (p_obj.type === "line") {
          const { start, end, height } = p_obj;
          ctx.lineWidth = Math.max(1, Math.round(height ?? 4));
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        } else if (p_obj.type === "circle") {
          const { c, radius } = p_obj;
          ctx.lineWidth = 3;
          ctx.fillStyle = "rgba(255, 255, 0, 0.5)";
          ctx.beginPath();
          ctx.arc(c.x, c.y, radius, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        } else if (p_obj.type === "poly") {
          const { v, c, a, scale } = p_obj;
          ctx.translate(c.x, c.y);
          ctx.rotate((a * Math.PI) / 180);
          ctx.scale(scale || 1, scale || 1);
          ctx.lineWidth = 3;
          ctx.fillStyle = "rgba(255, 255, 0, 0.5)";

          ctx.beginPath();
          ctx.moveTo(v[0].x, v[0].y);
          for (let i = 1; i < v.length; i++) {
            ctx.lineTo(v[i].x, v[i].y);
          }
          ctx.closePath();

          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    // Works for: Auto-Gen (drawing), User Sim (recording), AI Sim (post-run).
    const generatedPath = State.get("generatedPath");
    if (
      generatedPath &&
      Array.isArray(generatedPath) &&
      generatedPath.length > 0
    ) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";

      ctx.beginPath();
      ctx.moveTo(generatedPath[0].x, generatedPath[0].y);
      for (let i = 1; i < generatedPath.length; i++) {
        ctx.lineTo(generatedPath[i].x, generatedPath[i].y);
      }
      ctx.stroke();

      // Optional: Draw nodes at the recorded points to visualize density
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      // Optimization: Don't draw circles if path is huge
      if (generatedPath.length < 500) {
        for (let i = 0; i < generatedPath.length; i++) {
          ctx.beginPath();
          ctx.arc(generatedPath[i].x, generatedPath[i].y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // --- Draw Physics Simulation Preview ---
    const simPreview = State.get("simulationPreview");
    if (simPreview) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(simPreview.x, simPreview.y, simPreview.radius, 0, 2 * Math.PI);

      // Draw a pulsing/glowing effect
      const pulse = Math.abs(Math.sin(Date.now() / 200));
      ctx.fillStyle = `rgba(0, 255, 255, ${0.6 + pulse * 0.3})`; // Cyan fill
      ctx.fill();

      ctx.strokeStyle = "rgba(0, 255, 255, 0.9)"; // Solid cyan border
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    }

    // --- Draw new shape in progress ---
    const drawingShape = State.get("drawingShape");
    if (drawingShape) {
      if (drawingShape.type === "line") {
        ctx.save();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(drawingShape.start.x, drawingShape.start.y);
        ctx.lineTo(drawingShape.end.x, drawingShape.end.y);
        ctx.stroke();
        ctx.restore();
      } else if (drawingShape.type === "circle") {
        ctx.save();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(
          drawingShape.c.x,
          drawingShape.c.y,
          drawingShape.radius,
          0,
          2 * Math.PI,
        );
        ctx.stroke();
        ctx.restore();
      } else if (
        drawingShape.type === "poly" &&
        drawingShape.vertices.length > 0
      ) {
        const { vertices } = drawingShape;
        ctx.save();
        ctx.strokeStyle = "cyan";
        ctx.lineWidth = 2;

        // Draw existing segments
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.stroke();

        const previewPt = drawingShape.preview || State.get("mouse");
        ctx.beginPath();
        ctx.moveTo(
          vertices[vertices.length - 1].x,
          vertices[vertices.length - 1].y,
        );
        ctx.lineTo(previewPt.x, previewPt.y);
        ctx.stroke();

        // Draw starting point circle
        ctx.fillStyle = "cyan";
        ctx.beginPath();
        ctx.arc(vertices[0].x, vertices[0].y, 5, 0, 2 * Math.PI);
        ctx.fill();

        ctx.restore();
      }
    }

    // --- Draw Marquee Selection Box ---
    const selectionBox = State.get("selectionBox");
    if (selectionBox) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 150, 255, 0.2)";
      ctx.strokeStyle = "rgba(0, 150, 255, 0.8)";
      ctx.lineWidth = 1;
      ctx.fillRect(
        selectionBox.x,
        selectionBox.y,
        selectionBox.width,
        selectionBox.height,
      );
      ctx.strokeRect(
        selectionBox.x,
        selectionBox.y,
        selectionBox.width,
        selectionBox.height,
      );
      ctx.restore();
    }

    // --- Draw Map Objects ---
    const spawnCircle = State.get("spawnCircle");
    if (spawnCircle) {
      const { x, y, diameter } = spawnCircle;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, diameter / 2, 0, 2 * Math.PI);

      // Draw a thick black outline first for contrast
      ctx.strokeStyle = "black";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Then draw a thinner white line on top
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      // For the text, draw a black outline and a white fill
      ctx.font = "9px Lexend";
      ctx.textAlign = "center";
      const textY = y + diameter / 2 + 12;

      ctx.strokeStyle = "black";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round"; // Makes text outline look better
      ctx.strokeText("spawn", x, textY);
      ctx.fillStyle = "white";
      ctx.fillText("spawn", x, textY);

      ctx.restore();
    }

    const capZone = State.get("capZone");
    if (capZone && capZone.x !== null) {
      const { x, y, width, height } = capZone;

      ctx.save();

      // Draw a thick black outline first
      ctx.strokeStyle = "black";
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, width, height);

      // Then draw a thinner yellow line on top
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // Draw the text with a black outline
      ctx.font = "9px Lexend";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textX = x + width / 2;
      const textY = y + height / 2;

      ctx.strokeStyle = "black";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.strokeText("CZ", textX, textY);

      ctx.fillStyle = "yellow";
      ctx.fillText("CZ", textX, textY);

      ctx.restore();
    }

    // --- Draw Zone Indicator (Topmost) ---
    const zoneIndicator = State.get("zoneIndicator");
    if (zoneIndicator && zoneIndicator.show) {
      const spawnCircle = State.get("spawnCircle");
      const { x, y } = zoneIndicator;
      const diameter = spawnCircle ? spawnCircle.diameter : 18;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, diameter / 2, 0, 2 * Math.PI);

      // Thick black outline first for contrast
      ctx.strokeStyle = "black";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Thinner, dashed white line on top
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.stroke();

      // Text label
      ctx.font = "9px Lexend";
      ctx.textAlign = "center";
      const textY = y + diameter / 2 + 12;

      ctx.strokeStyle = "black";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.strokeText("zone", x, textY);

      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillText("zone", x, textY);

      ctx.restore();
    }
    ctx.restore();
  }
}

export default Canvas;
