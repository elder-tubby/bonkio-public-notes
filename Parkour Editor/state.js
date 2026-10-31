// A tiny event emitter + central state store

class Emitter {
  constructor() {
    this.listeners = new Set();
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(...args) {
    this.listeners.forEach((fn) => fn(...args));
  }
}

class State {
  constructor() {
    this._state = {
      colors: {
        background: "rgb(0, 0, 0)",
        none: "rgb(255, 255, 255)",
        bouncy: "rgb(167, 196, 190)",
        death: "rgb(255, 0, 0)",
      },

      editorActive: false,

      objects: [],
      selectedObjectIds: [],
      draggingPreview: null,
      selectionBox: null,

      // NEW: Drawing mode state
      drawingMode: "line", // can be 'line', 'poly', or 'select'

      // State for drawing new shapes
      drawingShape: null, // { type: 'line', ... } or { type: 'poly', ... }

      // Canvas interaction state
      mouse: { x: 0, y: 0 },
      startPt: null,

      // Game object state
      spawnCircle: { x: 365, y: 450, diameter: 18 },
      capZone: { x: null, y: null, width: 30, height: 18.5 },

      // Settings
      mapSize: 9,
      generatedPath: null,
      isDrawingPath: false, // <-- ADD THIS
      simulationPreview: null, // <-- ADD THIS
      cameraMode: false,
      cameraOffset: { x: 0, y: 0 },
      cameraZoom: 1,
    };
    this.emitter = new Emitter();
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    // Deprecated: Handle single vs multiple selection seamlessly
    if (key === "selectedObjectId") {
      this.set("selectedObjectIds", value ? [value] : []);
      return;
    }
    // Deprecated: isDrawingPoly is now managed by drawingMode
    if (key === "isDrawingPoly") {
      this.set("drawingMode", value ? "poly" : "line");
      return;
    }
    this._state[key] = value;
    this.emitter.emit(key, value);
  }

  // --- Helpers for multi-selection ---
  addSelectedObjectId(id) {
    if (!this._state.selectedObjectIds.includes(id)) {
      this.set("selectedObjectIds", [...this._state.selectedObjectIds, id]);
    }
  }

  removeSelectedObjectId(id) {
    this.set(
      "selectedObjectIds",
      this._state.selectedObjectIds.filter((oid) => oid !== id),
    );
  }

  clearSelectedObjects() {
    this.set("selectedObjectIds", []);
  }

  isSelected(id) {
    return this._state.selectedObjectIds.includes(id);
  }

  onChange(fn) {
    return this.emitter.on(fn);
  }
}

export default new State();
