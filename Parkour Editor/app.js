import UI from "./ui.js";
import State from "./state.js";
import Canvas from "./canvas.js";
import * as LocalStore from "./local-store.js";
import { bindUIEvents } from "./handlers.js";
import { getSpawnDiameter, MapHistory } from "./utils-client.js";

window.LocalStore = LocalStore;
MapHistory.init(State, LocalStore);
window.saveMapSnapshot = () => MapHistory.debouncedSave();
window.undoMap = () => MapHistory.undo();
window.redoMap = () => MapHistory.redo();

function bindLocalEvents() {
  LocalStore.onObjectCreated((object) => {
    MapHistory.handleNewObjects([object]);
    State.set("objects", [...(State.get("objects") || []), object]);
    State.set("selectedObjectIds", [object.id]);
  });

  LocalStore.onObjectsCreatedBatch((objects) => {
    if (!Array.isArray(objects) || objects.length === 0) return;
    MapHistory.handleNewObjects(objects);
    State.set("objects", [...(State.get("objects") || []), ...objects]);
    State.set(
      "selectedObjectIds",
      objects.map((object) => object.id),
    );
  });

  LocalStore.onObjectUpdated((updatedObject) => {
    State.set(
      "objects",
      (State.get("objects") || []).map((object) =>
        object.id === updatedObject.id ? updatedObject : object,
      ),
    );

    const selectedIds = State.get("selectedObjectIds") || [];
    if (selectedIds.length !== 1 || selectedIds[0] !== updatedObject.id) return;
    if (updatedObject.type === "line") UI.updateLineEditorValues(updatedObject);
    if (updatedObject.type === "poly") UI.updatePolygonEditorValues(updatedObject);
    if (updatedObject.type === "circle") UI.updateCircleEditorValues(updatedObject);
  });

  LocalStore.onObjectDeleted(({ id }) => {
    State.set(
      "objects",
      (State.get("objects") || []).filter((object) => object.id !== id),
    );
    State.removeSelectedObjectId(id);
  });

  LocalStore.onObjectsReordered((objects) => {
    State.set("objects", objects || []);
  });

  LocalStore.onSpawnCircleUpdate((spawnCircle) =>
    State.set("spawnCircle", spawnCircle),
  );
  LocalStore.onCapZoneUpdate((capZone) => State.set("capZone", capZone));
  LocalStore.onMapSizeUpdate((mapSize) => {
    State.set("mapSize", mapSize);
    if (UI.elems.spawnSizeSlider) UI.elems.spawnSizeSlider.value = mapSize;
    if (UI.elems.spawnSizeValue) UI.elems.spawnSizeValue.innerText = mapSize;
  });
  LocalStore.onColorsUpdated((colors) => State.set("colors", colors));
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
      "selectionBox",
      "colors",
      "simulationPreview",
      "generatedPath",
      "isDrawingPath",
      "zoneIndicator",
      "cameraMode",
      "cameraOffset",
      "cameraZoom",
    ];
    if (visualKeys.includes(key)) scheduleDraw();

    if (key === "selectedObjectIds") {
      const selectedIds = State.get(key);
      const selectedObjects = (State.get("objects") || []).filter((object) =>
        selectedIds.includes(object.id),
      );
      UI.setObjectEditorVisible(selectedObjects);
    }

    if (key === "mapSize") {
      const spawn = State.get("spawnCircle");
      if (spawn) {
        State.set("spawnCircle", {
          ...spawn,
          diameter: getSpawnDiameter(State.get(key)),
        });
      }
    }

    if (key === "colors") UI.updateColorIndicators(State.get(key));
  });
}

function main() {
  UI.init();
  LocalStore.loadSavedDraft();
  bindUIEvents();
  bindLocalEvents();
  watchStateChanges();
  UI.updateColorIndicators(State.get("colors"));
  Canvas.draw();
}

document.addEventListener("DOMContentLoaded", main);
