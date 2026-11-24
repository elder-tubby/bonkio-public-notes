import { normalizeAngle, getLineProps } from "./utils-client.js"; // <-- MODIFIED
import State from "./state.js";
import * as LocalStore from "./local-store.js";

// Keep selectors for DOM querying
const SELECTORS = {
  home: "#homeScreen",
  canvasWrap: "#canvasWrapper",
  startDrawingBtn: "#startDrawingBtn",
  canvas: "#canvas",
  copyMapBtn: "#copyMapBtn",
  optionsPanel: ".options-panel",
  controlBox: ".control-box", // Selector for the main container
  autoGenerateBtn: "#autoGenerateBtn",
  changeColorsBtn: "#changeColorsBtn",
  autoGenerateBtn: "#autoGenerateBtn",
  autoGeneratePopup: "#autoGeneratePopup",
  agpCloseBtn: "#agpCloseBtn",
  agpForm: "#agpForm",
  agpThickness: "#agpThickness",
  agpDrawBtn: "#agpDrawBtn",
  agpAiSimBtn: "#agpAiSimBtn",
  drawingThicknessSlider: "#drawingThicknessSlider",
  drawingThicknessVal: "#drawingThicknessVal",
};

class UI {
  constructor() {
    this.elems = {};
  }

  init() {
    for (const key in SELECTORS) {
      this.elems[key] = document.querySelector(SELECTORS[key]);
    }
    if (this.elems.canvas) {
      this.elems.ctx = this.elems.canvas.getContext("2d");
    }

    // Populate the local editor's More Options panel.
    const optionsPanel = document.querySelector(".options-panel");
    if (optionsPanel) {
      optionsPanel.innerHTML = `
        <style>
          #moreOptionsTabContent::-webkit-scrollbar { width: 6px; }
          #moreOptionsTabContent::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
          #moreOptionsTabContent::-webkit-scrollbar-track { background: transparent; }
          #moreOptionsTabContent { font-family: 'Lexend', sans-serif; }
        </style>

        <h3>More Options</h3>
        <div id="moreOptionsTabContent" style="flex: 1; overflow-y: auto; padding-right: 5px; font-family: 'Lexend', sans-serif;">
           <div class="options-column-left" style="display: flex; flex-direction: column; gap: 15px;">
                <h4 style="margin: 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Tool Configuration</h4>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="cbShowZone" style="cursor: pointer;">
                    <label for="cbShowZone" style="font-size: 13px; color: #ccc; cursor: pointer; user-select: none;">Show zone indicator</label>
                </div>
				
				<div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="cbHideZoneShapes" checked style="cursor: pointer;">
                    <label for="cbHideZoneShapes" style="font-size: 13px; color: #ccc; cursor: pointer; user-select: none;">Hide zone shapes</label>
                </div>


                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                  <input type="checkbox" id="cbUseShades" style="cursor: pointer;">
                  <label for="cbUseShades" style="font-size: 13px; color: #ccc; cursor: pointer; user-select: none;">Shade normal shapes</label>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                  <input type="checkbox" id="cbShadeDeath" style="cursor: pointer;">
                  <label for="cbShadeDeath" style="font-size: 13px; color: #ccc; cursor: pointer; user-select: none;">Shade death shapes</label>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                  <input type="checkbox" id="cbShadeBouncy" style="cursor: pointer;">
                  <label for="cbShadeBouncy" style="font-size: 13px; color: #ccc; cursor: pointer; user-select: none;">Shade bouncy shapes</label>
                </div>

                <div style="margin-top: 5px; border-top: 1px solid #333; padding-top: 15px;">
                    <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Shading Intensity</h4>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label for="shadingRangeSlider" style="font-size: 12px; display: flex; justify-content: space-between; color: #ccc;">
                            <span>Gradient Range:</span>
                            <span id="shadingRangeVal" style="font-weight: bold; color: #4ade80;">30</span>
                        </label>
                        <input type="range" id="shadingRangeSlider" min="0" max="100" value="30" style="width: 100%; cursor: pointer;">
                    </div>
                </div>

                <div style="border-top: 1px solid #333; padding-top: 15px; display: flex; flex-direction: column; gap: 12px;">
                  <button id="agpDrawBtn" type="button" class="btn" style="width: 100%; font-size: 12px; font-weight: bold; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;" title="Toggle continuous drawing mode (Ctrl+D)">
                    Toggle Drawing: OFF (Ctrl+D)
                  </button>
                  <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label for="drawingThicknessSlider" style="font-size: 13px; display: flex; justify-content: space-between; color: #ccc;">
                      <span>Stroke Thickness:</span>
                      <span id="drawingThicknessVal" style="font-weight: bold; color: #4ade80;">20</span>
                    </label>
                    <input type="range" id="drawingThicknessSlider" min="5" max="150" value="20" style="width: 100%; cursor: pointer; margin: 5px 0;">
                  </div>
                </div>
            </div>

            <div class="options-column-right" style="margin-top: 15px; border-top: 1px solid #222; padding-top: 15px;">
                  <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Map Modifiers</h4>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                      <button id="btnFixY" class="btn" style="font-size: 11px; padding: 6px;">Fix Y Slants</button>
                      <button id="btnFixX" class="btn" style="font-size: 11px; padding: 6px;">Fix X Slants</button>
                      <button id="btnStraightenLines" class="btn" style="font-size: 11px; padding: 6px;">Straighten (2°)</button>
                      <button id="btnLinesToCurvedPolys" class="btn" style="font-size: 11px; padding: 6px;">Round Lines</button>
                      <button id="btnCurvePolygons" class="btn" style="font-size: 11px; padding: 6px;">Curve Polygons</button>
                      <button id="btnAddFrames" class="btn" style="font-size: 11px; padding: 6px;">Add Frames</button>
                      <button id="btnLinesToPolys" class="btn" style="font-size: 11px; padding: 6px;">Lines to Polys</button>
                      <button id="btnDelOOB" class="btn" style="font-size: 11px; padding: 6px;">Delete OOB</button>
                      <button id="btnMergePolys" class="btn" style="font-size: 11px; padding: 6px;">Merge Polys</button>
                      <button id="btnToggleZone" class="btn" style="font-size: 11px; padding: 6px;">Toggle Zone</button>
                      <button id="btnSplitShape" class="btn" style="font-size: 11px; padding: 6px;">Split Shape</button>
                      <button id="btnRemoveOverlap" class="btn" style="font-size: 11px; padding: 6px; background: #3b82f6; color: white;">Remove Overlap</button>
                      <button id="btnMirrorMap" class="btn" style="font-size: 11px; padding: 6px; grid-column: span 2;">Mirror Map</button>
                  </div>

                <div style="margin-top: 15px; border-top: 1px solid #333; padding-top: 15px;">
                      <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Select By Type</h4>
                      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                          <button id="btnSelectNormal" class="btn" style="font-size: 11px; padding: 6px;">Normal</button>
                          <button id="btnSelectBouncy" class="btn" style="font-size: 11px; padding: 6px;">Bouncy</button>
                          <button id="btnSelectDeath" class="btn" style="font-size: 11px; padding: 6px;">Death</button>
                      </div>
                  </div>

                  <div style="margin-top: 15px; border-top: 1px solid #333; padding-top: 15px;">
                      <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Bulk Convert Types</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center;">
                        <select id="bulkConvertFrom" style="font-size: 11px; padding: 4px; background: #222; color: #fff; border: 1px solid #444;">
                            <option value="all">All Types</option>
                            <option value="none">Normal</option>
                            <option value="bouncy">Bouncy</option>
                            <option value="death">Death</option>
                        </select>
                        <select id="bulkConvertTo" style="font-size: 11px; padding: 4px; background: #222; color: #fff; border: 1px solid #444;">
                            <option value="none">Normal</option>
                            <option value="bouncy">Bouncy</option>
                            <option value="death">Death</option>
                        </select>
                        <button id="btnBulkConvert" class="btn" style="font-size: 11px; padding: 6px;">Convert</button>
                    </div>
                </div>
				
				<div style="margin-top: 15px; border-top: 1px solid #333; padding-top: 15px;">
    <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Add Grid of Shapes</h4>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="gridRowsInput" style="font-size: 11px; color: #ccc;">Rows</label>
            <input type="number" id="gridRowsInput" min="1" value="10" style="font-size: 12px; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 3px; width: 100%; box-sizing: border-box;">
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="gridColsInput" style="font-size: 11px; color: #ccc;">Columns</label>
            <input type="number" id="gridColsInput" min="1" value="10" style="font-size: 12px; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 3px; width: 100%; box-sizing: border-box;">
        </div>
    </div>
    <button id="btnAddGrid" class="btn" style="width: 100%; font-size: 11px; padding: 6px;">Add Grid of Shapes</button>
</div>

      <div style="margin-top: 20px; border-top: 1px solid #333; padding-top: 15px;">
                    <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Generate Death Tunnel</h4>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label for="tunnelPaddingSlider" style="font-size: 12px; display: flex; justify-content: space-between; color: #ccc;">
                            <span>Tunnel Padding (px):</span>
                            <span id="tunnelPaddingVal" style="font-weight: bold; color: #4ade80;">30</span>
                        </label>
                        <input type="range" id="tunnelPaddingSlider" min="5" max="100" value="30" style="width: 100%; cursor: pointer;">
                        <button id="btnGenerateTunnel" class="btn" style="width: 100%; background-color: #dc2626; color: white; font-weight: bold; height: 34px; border: none; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;" title="Generate death polygons around pasted path">
                            Paste & Generate
                        </button>
                    </div>
                </div>

                <!-- NEW: Dynamic Vertex Counter -->
                <div style="margin-top: 20px; border-top: 1px solid #333; padding-top: 15px; padding-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); padding: 10px 15px; border-radius: 6px; border: 1px solid #444;">
                        <span style="font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">Polygon Vertices</span>
                        <span id="totalVertexCount" style="font-family: monospace; font-size: 16px; color: #4ade80; font-weight: bold; text-shadow: 0 0 5px rgba(74, 222, 128, 0.3);">0</span>
                    </div>
                </div>

            </div>
        </div>
      `;

      // Attach Shading Range client-side logic
      const rangeSlider = document.getElementById("shadingRangeSlider");
      const rangeVal = document.getElementById("shadingRangeVal");
      State.set("shadingRange", parseInt(rangeSlider.value));
      rangeSlider.addEventListener("input", (e) => {
        rangeVal.innerText = e.target.value;
        State.set("shadingRange", parseInt(e.target.value));
      });

      // Dynamic Vertex Counter Observer
      const updateVertexCount = () => {
        const objs = State.get("objects") || [];
        // Only sum vertices if the object is a polygon
        const vCount = objs.reduce(
          (sum, o) =>
            sum + (o.type === "poly" && Array.isArray(o.v) ? o.v.length : 0),
          0,
        );
        const vEl = document.getElementById("totalVertexCount");
        if (vEl) vEl.innerText = vCount.toLocaleString();
      };

      // Listen for map changes and update real-time
      State.onChange((key) => {
        if (key === "objects") updateVertexCount();
      });

      // Initial call to populate the counter on page load
      setTimeout(updateVertexCount, 500);
    }

    this._createUnifiedObjectEditor();
    this.setObjectEditorVisible([]);

    // Hover Tooltip Initialization
    const tooltip = document.createElement("div");
    tooltip.id = "hoverTooltip";
    Object.assign(tooltip.style, {
      position: "fixed",
      display: "none",
      background: "rgba(0, 0, 0, 0.75)",
      color: "white",
      padding: "5px 8px",
      borderRadius: "4px",
      fontSize: "11px",
      fontFamily: "monospace",
      pointerEvents: "none",
      zIndex: 1001,
      whiteSpace: "pre",
    });
    document.body.appendChild(tooltip);
    this.elems.tooltip = tooltip;
  }

  createSliderHandlerFactory(elems) {
    return (propName, type) => {
      const uiProp = propName === "a" ? "angle" : propName;
      const capitalized = uiProp.charAt(0).toUpperCase() + uiProp.slice(1);
      const prefix = `${type}${capitalized}`;
      const sliderKey = `${prefix}Slider`;
      const valueKey = `${prefix}Value`;

      const slider = elems[sliderKey];
      const valueLabel = elems[valueKey];
      if (!slider) return;

      slider.step = "0.001"; // Support decimals via edit popup

      const handleInput = () => {
        // Enforce pure integers when sliding manually
        let intVal = Math.round(parseFloat(slider.value));
        slider.value = intVal;

        if (valueLabel) valueLabel.innerText = Number(intVal).toFixed(3);

        const selectedIds = State.get("selectedObjectIds");
        if (selectedIds.length === 0) return;

        let parsed = parseFloat(intVal);
        if (propName === "scale") parsed = parsed / 100.0;

        const objects = State.get("objects");
        let changed = false;
        objects.forEach((obj) => {
          if (selectedIds.includes(obj.id) && obj.type === type) {
            if (propName === "a") obj.a = parsed;
            else if (propName === "angle") obj.angle = parsed;
            else if (propName === "width") obj.width = parsed;
            else if (propName === "height") obj.height = parsed;
            else if (propName === "scale") obj.scale = parsed;
            else if (propName === "radius") obj.radius = parsed;
            changed = true;
          }
        });

        if (changed) State.set("objects", objects);
      };

      const handleChange = () => {
        const selectedIds = State.get("selectedObjectIds");
        if (selectedIds.length === 0) return;

        let parsed = Math.round(parseFloat(slider.value));
        if (propName === "scale") parsed = parsed / 100.0;

        const payload = {};
        payload[propName] = parsed;

        selectedIds.forEach((id) => {
          LocalStore.updateObject({ id, ...payload });
        });
      };

      slider.addEventListener("input", handleInput);
      slider.addEventListener("change", handleChange);
    };
  }

  _createUnifiedObjectEditor() {
    const controlBox = this.elems.controlBox;
    if (!controlBox) return;

    controlBox.innerHTML = ""; // Clear existing content

    // --- Status Text ---
    const status = document.createElement("div");
    status.id = "status";
    controlBox.appendChild(status);
    this.elems.statusText = status;

    /// --- IN ui.js, inside _createUnifiedObjectEditor() ---
    // Replace the colorIndicators block with this:

    const colorIndicators = document.createElement("div");
    colorIndicators.id = "colorIndicators";
    colorIndicators.className = "color-indicators-container";

    // Updated to use elegant <button> tags with the 'btn' class
    colorIndicators.innerHTML = `
        <div style="display:flex; align-items:center; gap: 6px; margin-right: 15px; border-right: 1px solid #444; padding-right: 15px;">
          <span style="font-size: 11px; font-weight: bold; letter-spacing: 1px; color: #ccc;">ZOOM</span>
          <button id="btnZoomOut" class="btn" style="padding: 2px 8px; font-size: 14px; min-width: 28px;">-</button>
          <button id="btnZoomIn" class="btn" style="padding: 2px 8px; font-size: 14px; min-width: 28px;">+</button>
          <button id="btnCameraMode" class="btn" title="Toggle Camera Navigation" style="padding: 2px 8px; font-size: 11px; min-width: 28px;">Nav</button>
          <!-- NEW: Reset Camera Button -->
          <button id="btnResetCamera" class="btn" title="Reset Camera" style="padding: 2px 8px; font-size: 11px; min-width: 28px;">Reset</button>
        </div>

        <button id="btnColor-none" class="btn" title="Randomize Normal Color" style="padding: 4px 8px; font-size: 11px; background: transparent; border: 1px solid #444; display: flex; align-items: center; gap: 6px;">
          <span id="colorIndicator-none" class="color-square"></span> Normal
        </button>
        <button id="btnColor-bouncy" class="btn" title="Randomize Bouncy Color" style="padding: 4px 8px; font-size: 11px; background: transparent; border: 1px solid #444; display: flex; align-items: center; gap: 6px;">
          <span id="colorIndicator-bouncy" class="color-square"></span> Bouncy
        </button>
        <button id="btnColor-death" class="btn" title="Randomize Death Color" style="padding: 4px 8px; font-size: 11px; background: transparent; border: 1px solid #444; display: flex; align-items: center; gap: 6px;">
          <span id="colorIndicator-death" class="color-square"></span> Death
        </button>
        <button id="btnColor-background" class="btn" title="Randomize Background Color" style="padding: 4px 8px; font-size: 11px; background: transparent; border: 1px solid #444; display: flex; align-items: center; gap: 6px;">
          <span id="colorIndicator-background" class="color-square"></span> BG
        </button>
    `;
    controlBox.appendChild(colorIndicators);

    // --- Main Editor Container ---
    const container = document.createElement("div");
    container.className = "editor-container";

    // --- Left Column ---
    const leftCol = document.createElement("div");
    leftCol.className = "editor-col editor-col-left";

    // Row 1: Draw Mode, Paste Map
    const leftRow1 = document.createElement("div");
    leftRow1.className = "editor-row";
    const drawModeBtn = this._createButton("drawModeBtn", "Mode: Line (M)");
    const changeColorsBtn = this._createButton(
      "changeColorsBtn", // Changed from autoGenerateBtn
      "Change Colors",
      "Randomize color scheme",
    );
    const pasteBtn = this._createButton(
      "pasteMapBtn",
      "Paste Map",
      "Paste map from clipboard",
    );
    leftRow1.append(drawModeBtn, pasteBtn, changeColorsBtn);

    // Row 2: Delete, Type Select, Duplicate
    const leftRow2 = document.createElement("div");
    leftRow2.className = "editor-row";
    leftRow2.id = "selectionActionsRow";
    const duplicateBtn = this._createButton(
      "duplicateBtn",
      "Duplicate",
      "Duplicate selected object(s)",
      false,
    );
    const deleteBtn = this._createButton(
      "deleteBtn",
      "Delete",
      "Delete selected object(s)",
      false,
    );
    const typeSelect = this._createSelect("typeSelect", "Object type", false);
    leftRow2.append(duplicateBtn, deleteBtn, typeSelect);

    // Row 3: Z-order
    const leftRow3 = document.createElement("div");
    leftRow3.className = "editor-row";
    leftRow3.id = "zOrderActionsRow"; // Add this ID
    const toFrontBtn = this._createButton(
      "toFrontBtn",
      "Front",
      "Bring to front",
      false,
    );
    const toBackBtn = this._createButton(
      "toBackBtn",
      "Back",
      "Send to back",
      false,
    );
    leftRow3.append(toFrontBtn, toBackBtn);

    leftCol.append(leftRow1, leftRow2, leftRow3);

    // --- Right Column ---
    const rightCol = document.createElement("div");
    rightCol.className = "editor-col editor-col-right";

    const mapSizeRow = this._createSlider(
      "spawnSizeSlider",
      "Map Size",
      1,
      13,
      9,
    );
    // Line sliders
    const lineWidth = this._createSlider(
      "lineWidthSlider",
      "Width",
      1,
      1000,
      100,
      "line-controls",
    );
    const lineHeight = this._createSlider(
      "lineHeightSlider",
      "Height",
      1,
      1000,
      4,
      "line-controls",
    );
    const lineAngle = this._createSlider(
      "lineAngleSlider",
      "Angle",
      0,
      360,
      0,
      "line-controls",
    );
    // Poly sliders
    const polyAngle = this._createSlider(
      "polyAngleSlider",
      "Angle",
      0,
      360,
      0,
      "poly-controls",
    );
    const polyScale = this._createSlider(
      "polyScaleSlider",
      "Scale",
      10,
      500,
      100,
      "poly-controls",
    );

    const circleRadius = this._createSlider(
      "circleRadiusSlider",
      "Radius",
      1,
      1000,
      50,
      "circle-controls",
    );

    rightCol.append(
      mapSizeRow,
      lineWidth,
      lineHeight,
      lineAngle,
      polyAngle,
      polyScale,
      circleRadius, // Add circle radius slider to the DOM
    );

    container.append(leftCol, rightCol);
    controlBox.appendChild(container);

    // Re-query all dynamically created elements to store them in this.elems
    this._queryDynamicElements();
  }
  setObjectEditorVisible(selectedObjects) {
    const count = Array.isArray(selectedObjects) ? selectedObjects.length : 0;
    const controlBox = this.elems.controlBox;
    if (!controlBox) return;

    const indicators = document.getElementById("colorIndicators");
    if (indicators) {
      indicators.style.display = count > 0 ? "none" : "flex";
    }

    let mode = "none";
    let statusText = ""; // Default to empty
    const drawingMode = State.get("drawingMode");

    if (count === 0) {
      mode = "none";
      if (drawingMode === "poly")
        statusText = "Click to start drawing a polygon.";
      else if (drawingMode === "circle")
        statusText = "Click and drag to draw a circle.";
      else statusText = "Draw by dragging on canvas.";
    } else if (count === 1) {
      const object = selectedObjects[0];
      mode = object.type; // "line", "poly", or "circle"

      if (mode === "line") this.updateLineEditorValues(object);
      if (mode === "poly") this.updatePolygonEditorValues(object);
      if (mode === "circle") this.updateCircleEditorValues(object);
    } else {
      mode = "multi";
      statusText = `${count} objects selected. Use hotkeys to edit.`;
    }

    controlBox.dataset.editorMode = mode;
    this.setStatus(statusText);

    const isSelection = count > 0;
    if (this.elems.selectionActionsRow) {
      this.elems.selectionActionsRow.classList.toggle("hidden", !isSelection);
    }
    if (this.elems.zOrderActionsRow) {
      this.elems.zOrderActionsRow.classList.toggle("hidden", !isSelection);
    }
  }

  updateColorIndicators(colors) {
    if (!colors) return;
    const noneIndicator = document.getElementById("colorIndicator-none");
    const bouncyIndicator = document.getElementById("colorIndicator-bouncy");
    const deathIndicator = document.getElementById("colorIndicator-death");
    const bgIndicator = document.getElementById("colorIndicator-background"); // <-- ADD THIS

    if (noneIndicator) noneIndicator.style.backgroundColor = colors.none;
    if (bouncyIndicator) bouncyIndicator.style.backgroundColor = colors.bouncy;
    if (deathIndicator) deathIndicator.style.backgroundColor = colors.death;
    if (bgIndicator) bgIndicator.style.backgroundColor = colors.background; // <-- ADD THIS
  }

  show(selectorKey) {
    this.elems[selectorKey]?.classList.remove("hidden");
  }
  hide(selectorKey) {
    this.elems[selectorKey]?.classList.add("hidden");
  }

  updateLineEditorValues(line) {
    const { width, height, angle } = getLineProps(line);
    this._updateSlider("lineWidth", width);
    this._updateSlider("lineHeight", height);
    this._updateSlider("lineAngle", normalizeAngle(angle));
    if (this.elems.typeSelect)
      this.elems.typeSelect.value = line.lineType || "none";
  }

  updatePolygonEditorValues(poly) {
    const angle = poly.a ?? 0;
    const scale = (poly.scale ?? 1) * 100;
    this._updateSlider("polyAngle", angle);
    this._updateSlider("polyScale", scale);
    if (this.elems.typeSelect)
      this.elems.typeSelect.value = poly.polyType || "none";
  }

  updateCircleEditorValues(circle) {
    const radius = circle.radius ?? 50;
    this._updateSlider("circleRadius", radius);
    if (this.elems.typeSelect) {
      this.elems.typeSelect.value = circle.circleType || "none";
    }
  }

  setStatus(text) {
    if (this.elems.statusText) this.elems.statusText.innerText = text;
  }
  // --- PRIVATE HELPER METHODS ---

  _queryDynamicElements() {
    const dynamicIds = [
      "status",
      "drawModeBtn",
      "pasteMapBtn",
      "changeColorsBtn",
      "deleteBtn",
      "typeSelect",
      "toFrontBtn",
      "toBackBtn",
      "selectionActionsRow",
      "zOrderActionsRow",
      "spawnSizeSlider",
      "spawnSizeValue",
      "lineWidthSlider",
      "lineWidthValue",
      "lineHeightSlider",
      "lineHeightValue",
      "lineAngleSlider",
      "lineAngleValue",
      "polyAngleSlider",
      "polyAngleValue",
      "polyScaleSlider",
      "polyScaleValue",
      "circleRadiusSlider",
      "circleRadiusValue",
      "btnZoomIn",
      "btnZoomOut",
      "moreOptionsMenuContainer",
      "moreOptionsTrigger",
      "btnFixY",
      "btnFixX",
      "btnStraightenLines",
      "btnLinesToCurvedPolys",
      "btnCurvePolygons",
      "btnDelOOB",
      "btnMergePolys",
      "btnToggleZone",
      "btnSplitShape",
      "btnRemoveOverlap",
      "btnSelectNormal",
      "btnSelectBouncy",
      "btnSelectDeath",
      "btnMirrorMap",
      "totalVertexCount",
      "bulkConvertFrom",
      "bulkConvertTo",
      "btnBulkConvert",
      "duplicateBtn",
      "btnAddFrames",
      "btnLinesToPolys",
      "tunnelPaddingSlider",
      "tunnelPaddingVal",
      "btnGenerateTunnel",
      "cbShowZone",
	  "cbHideZoneShapes",
      "cbUseShades",
      "cbShadeDeath",
      "cbShadeBouncy",
      // CRITICAL REGISTRATION FIXES FOR THE DRAWING BUTTONS AND SIMULATORS:
      "agpDrawBtn",
      "drawingThicknessSlider",
      "drawingThicknessVal",
      "btnColor-none",
      "btnColor-bouncy",
      "btnColor-death",
      "btnColor-background",
      "btnCameraMode",
      "btnResetCamera",
	  "gridRowsInput",
"gridColsInput",
"btnAddGrid",

    ];

    dynamicIds.forEach((id) => {
      this.elems[id] = document.getElementById(id);
    });
    this.elems.statusText = this.elems.status;
  }

  _createButton(id, text, title = "", disabled = false) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "btn";
    btn.textContent = text;
    if (title) btn.title = title;
    if (disabled) btn.disabled = true;
    return btn;
  }

  _createSelect(id, title = "", disabled = false) {
    const select = document.createElement("select");
    select.id = id;
    select.innerHTML = `<option value="none">None</option><option value="bouncy">Bouncy</option><option value="death">Death</option>`;
    if (title) select.title = title;
    if (disabled) select.disabled = true;
    return select;
  }

  _createSlider(id, labelText, min, max, defaultVal, className = "") {
    const row = document.createElement("div");
    row.className = "slider-row";
    if (className) row.classList.add(className);

    const valueId = id.replace("Slider", "Value"); // Correctly generate the value ID

    row.innerHTML = `
        <label for="${id}">${labelText}</label>
        <input type="range" id="${id}" min="${min}" max="${max}" value="${defaultVal}">
        <span id="${valueId}" class="slider-value">${defaultVal}</span>
    `;
    return row;
  }

  _updateSlider(baseId, value) {
    const slider = this.elems[`${baseId}Slider`];
    const valueEl = this.elems[`${baseId}Value`];
    if (slider) slider.value = String(value);
    if (valueEl) valueEl.innerText = Number(value).toFixed(3);
  }
}

const AUTO_GEN_LIMITS = {
  maxPolygons: { min: 1, max: 200, default: 50 },
  minDistance: { min: 0, max: 200, default: 10 },
  maxVertices: { min: 3, max: 30, default: 12 },
  minArea: { min: 200, max: 50000, default: 8000 },
  maxArea: { min: 300, max: 50000, default: 30000 },
  skipChance: { min: 0, max: 1, default: 0, step: 0.1 },
  tunnelPadding: { min: 10, max: 100, default: 30 },
};

export default new UI();
