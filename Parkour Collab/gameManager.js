/**
 * gameManager.js - Authoritative Server-Side Game State Manager
 */
const { v4: uuidv4 } = require("uuid");
const { EVENTS } = require("./config");
const {
  getSpawnDiameter,
  generateNewColorScheme,
  getDistinctColor,
  hslToRgbStr,
  getShade,
  generateBeautifulColorScheme,
  generateDistinctColor,
  getSpatialShade,
  getRandomShadingStyle,
} = require("./utils");

class GameManager {
  constructor(io, lobby) {
    this.io = io;
    this.lobby = lobby;
    this.reset();
  }
  reset() {
    this.active = false;
    this.objects = [];
    this.participants = [];
    this.votes = {};
    this.capZone = { x: 375, y: 200, width: 30, height: 18.5 };
    this.mapSize = 9;
    this.spawnCircle = {
      x: 375,
      y: 250,
      diameter: getSpawnDiameter(this.mapSize),
    };
    this.colors = {
      background: "rgb(0, 0, 0)",
      none: "rgb(255, 255, 255)",
      bouncy: "rgb(167, 196, 190)",
      death: "rgb(255, 0, 0)",
      shadingStyles: {
        none: getRandomShadingStyle(),
        bouncy: getRandomShadingStyle(),
        death: getRandomShadingStyle()
      },
      useShades: false,
      shadeDeath: false,
      shadeBouncy: false
    };
    this._lastEventTs = new Map();
  }

  start() {
    this.active = true;
    this.objects = [];
    this.participants = Object.keys(this.lobby.players).filter(
      (id) => this.lobby.players[id]?.ready,
    );
    if (this.participants.length < 1) {
      this.active = false;
      return;
    }
    this.participants.forEach((id) => {
      if (this.lobby.players[id]) this.lobby.players[id].inGame = true;
      this.io.to(id).emit(EVENTS.CLEAR_CHAT);
    });
    const payload = this.getStartPayload();
    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.START_GAME, payload),
    );
    this.broadcastGameState();
    this.lobby.broadcastLobby();
  }

  endGame(reason = "unknown") {
    this.io.emit(EVENTS.END_GAME, { reason });
    Object.values(this.lobby.players).forEach((p) => {
      if (p) p.inGame = false;
    });
    this.lobby.resetReady();
    this.reset();
    this.lobby.broadcastLobby();
  }

  addParticipant(playerId) {
    if (
      !this.active ||
      this.participants.includes(playerId) ||
      !this.lobby.players[playerId]
    )
      return;

    this.participants.push(playerId);
    this.votes[playerId] = false;
    if (this.lobby.players[playerId])
      this.lobby.players[playerId].inGame = true;

    this.io
      .to(playerId)
      .emit(EVENTS.GAME_SNAPSHOT, this.getSnapshotFor(playerId));

    this.broadcastGameState();
    this.lobby.broadcastLobby();
  }

  handleDisconnect(playerId) {
    const wasParticipant = this.participants.includes(playerId);
    if (!this.active || !wasParticipant) return;

    this.participants = this.participants.filter((id) => id !== playerId);
    delete this.votes[playerId];

    if (this.participants.length < 1 && this.active) {
      this.endGame("player_left");
    } else {
      this.broadcastGameState();
    }
  }

  voteFinish(playerId, vote) {
    if (!this.active || !this.participants.includes(playerId)) return;
    this.votes[playerId] = !!vote;

    const total = this.participants.length;
    const yesVotes = Object.values(this.votes).filter(Boolean).length;

    if (total > 0 && yesVotes === total) {
      this.endGame("voted");
    } else {
      this.broadcastGameState();
    }
  }

  broadcastGameState() {
    if (!this.active) return;
    const players = this.getGamePlayers();
    const votesCount = Object.values(this.votes).filter(Boolean).length;

    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.GAME_UPDATE, {
        players,
        votes: votesCount,
        totalParticipants: this.participants.length,
      });
    });
  }

  getGamePlayers() {
    return this.participants
      .map((id) => this.lobby.players[id])
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, symbol: p.symbol }));
  }
  getStartPayload() {
    return {
      objects: this.objects,
      players: this.getGamePlayers(),
      capZone: this.capZone,
      spawnCircle: this.spawnCircle,
      mapSize: this.mapSize,
      colors: this.colors,
      useShades: this.useShades,
    };
  }
  getSnapshotFor(playerId) {
    return {
      ...this.getStartPayload(),
      votesCount: Object.values(this.votes).filter(Boolean).length,
      totalParticipants: this.participants.length,
      lobbyPayload: this.lobby.getLobbyPayload(),
    };
  }

  // --- Authoritative Action Handlers ---

  handleObjectCreation(playerId, objectData) {
    if (!this._canPlayerAct(playerId) || !this._allow(playerId, "create", 200))
      return;
    if (!objectData || !objectData.type) return;

    const player = this.lobby.players[playerId];
    // Determine color based on type
    const subType =
      objectData.lineType ||
      objectData.polyType ||
      objectData.circleType ||
      "none";
    let objColor = this.colors[subType] || this.colors.none;

    const baseObj = {
      id: uuidv4(),
      playerId,
      username: player.name,
      symbol: player.symbol,
      color: objColor,
      createdAt: Date.now(),
      isZone: !!objectData.isZone,
    };

    let newObject = null;

    if (objectData.type === "line") {
      if (
        !this._validPoint(objectData.start) ||
        !this._validPoint(objectData.end)
      )
        return;
      const dx = objectData.end.x - objectData.start.x;
      const dy = objectData.end.y - objectData.start.y;
      if (dx * dx + dy * dy < 25) return; // Ignore tiny lines

      newObject = {
        ...baseObj,
        type: "line",
        start: objectData.start,
        end: objectData.end,
        lineType: objectData.lineType || "none", // Keep type for logic
        height: 4,
        width: Math.hypot(
          objectData.end.x - objectData.start.x,
          objectData.end.y - objectData.start.y,
        ),
        angle: this._computeAngle(objectData.start, objectData.end),
      };
    } else if (objectData.type === "circle") {
      if (
        !this._validPoint(objectData.c) ||
        !(typeof objectData.radius === "number" && objectData.radius > 0)
      )
        return;

      newObject = {
        ...baseObj,
        type: "circle",
        c: objectData.c,
        radius: objectData.radius,
        circleType: objectData.circleType || "none",
      };
    }

    if (newObject) {
      if (this._shouldShade(subType)) {
        newObject.color = getSpatialShade(objColor, newObject, this.colors.shadingStyle);
      }

      this.objects.push(newObject);
      this.participants.forEach((id) => {
        this.io.to(id).emit(EVENTS.OBJECT_CREATED, newObject);
      });
    }
  }

  handleObjectsCreationBatch(playerId, batchData) {
    if (
      !this._canPlayerAct(playerId) ||
      !this._allow(playerId, "createBatch", 500)
    )
      return;
    if (!batchData || !Array.isArray(batchData.objects)) return;

    const player = this.lobby.players[playerId];
    const newObjects = [];

    for (const objData of batchData.objects) {
      if (!objData || !objData.type) continue;

      const subType =
        objData.lineType || objData.polyType || objData.circleType || "none";
      let objColor = this.colors[subType] || this.colors.none;

      const baseObj = {
        id: uuidv4(),
        playerId,
        username: player.name,
        symbol: player.symbol,
        color: objColor,
        createdAt: Date.now(),
        isZone: !!objData.isZone,
      };

      let newObj = null;

      if (objData.type === "poly") {
        if (
          Array.isArray(objData.v) &&
          objData.v.length >= 3 &&
          this._validPoint(objData.c)
        ) {
          newObj = {
            ...baseObj,
            type: "poly",
            v: objData.v,
            c: objData.c,
            a: objData.a || 0,
            scale: objData.scale || 1,
            polyType: objData.polyType || "none",
          };
        }
      } else if (objData.type === "line") {
        if (this._validPoint(objData.start) && this._validPoint(objData.end)) {
          newObj = {
            ...baseObj,
            type: "line",
            start: objData.start,
            end: objData.end,
            lineType: objData.lineType || "none",
            height: objData.height || 4,
            width: Math.hypot(
              objData.end.x - objData.start.x,
              objData.end.y - objData.start.y,
            ),
            angle: this._computeAngle(objData.start, objData.end),
          };
        }
      } else if (objData.type === "circle") {
        if (
          this._validPoint(objData.c) &&
          typeof objData.radius === "number" &&
          objData.radius > 0
        ) {
          newObj = {
            ...baseObj,
            type: "circle",
            c: objData.c,
            radius: objData.radius,
            circleType: objData.circleType || "none",
          };
        }
      }

      if (newObj) {
        if (this._shouldShade(subType)) {
          newObj.color = getSpatialShade(objColor, newObj, this.colors.shadingStyle);
        }
        newObjects.push(newObj);
      }
       
    }  

    if (newObjects.length > 0) {
      this.objects.push(...newObjects);
      this.participants.forEach((id) => {
        this.io.to(id).emit(EVENTS.OBJECTS_CREATED_BATCH, newObjects);
      });
    }
  }

  // Add this new handler in GameManager
  handleObjectsUpdateBatch(playerId, payloads) {
    if (
      !this._canPlayerAct(playerId) ||
      !this._allow(playerId, "updateBatch", 100)
    )
      return;
    if (!Array.isArray(payloads)) return;

    payloads.forEach((payload) => {
      if (!this._canModifyObject(playerId, payload.id)) return;

      const objIndex = this.objects.findIndex((o) => o.id === payload.id);
      if (objIndex === -1) return;
      const object = this.objects[objIndex];

      // Route to your existing update logic
      if (object.type === "line") this._updateLine(object, payload);
      else if (object.type === "poly") this._updatePolygon(object, payload);
      else if (object.type === "circle") this._updateCircle(object, payload);
    });

    // Broadcast the entire state once instead of per-object
    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.OBJECTS_REORDERED, this.objects),
    );
  }

  handleObjectDeletion(playerId, objectId) {
    if (!this._canModifyObject(playerId, objectId)) return;
    this.objects = this.objects.filter((o) => o.id !== objectId);
    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.OBJECT_DELETED, { id: objectId }),
    );
  }

  handleObjectUpdate(playerId, payload) {
    if (
      !payload?.id ||
      !this._canModifyObject(playerId, payload.id) ||
      !this._allow(playerId, `update:${payload.id}`, 50)
    )
      return;

    // Allow color updates via payload if needed, though usually done via ChangeColors
    if (payload.color) this.objects[objIndex].color = payload.color;

    const objIndex = this.objects.findIndex((o) => o.id === payload.id);
    if (objIndex === -1) return;

    const object = this.objects[objIndex];
    if (object.type === "line") {
      this._updateLine(object, payload);
    } else if (object.type === "poly") {
      this._updatePolygon(object, payload);
    } else if (object.type === "circle") {
      this._updateCircle(object, payload);
    }
  }

  _updateLine(currentLine, payload) {
    // 1. Get derived properties from the *current* line state
    const currentProps = {
      dx: currentLine.end.x - currentLine.start.x,
      dy: currentLine.end.y - currentLine.start.y,
    };
    const currentWidth = Math.hypot(currentProps.dx, currentProps.dy);
    const currentAngle = this._computeAngle(currentLine.start, currentLine.end);
    const currentHeight =
      typeof currentLine.height === "number" ? currentLine.height : 4;

    // 2. Initialize updatedLine with these guaranteed-to-be-correct values
    let updatedLine = {
      ...currentLine,
      width: currentWidth,
      height: currentHeight,
      angle: currentAngle,
    };
    const isMoving =
      (payload.nudge && (payload.nudge.x || payload.nudge.y)) ||
      (this._validPoint(payload.start) && this._validPoint(payload.end));
    const isResizing =
      typeof payload.width === "number" ||
      typeof payload.height === "number" ||
      typeof payload.angle === "number" ||
      payload.widthDelta ||
      payload.heightDelta ||
      payload.angleDelta;

    if (payload.nudge && (payload.nudge.x || payload.nudge.y)) {
      const dx = (payload.nudge.x || 0) * 2;
      const dy = (payload.nudge.y || 0) * 2;
      updatedLine.start = {
        x: updatedLine.start.x + dx,
        y: updatedLine.start.y + dy,
      };
      updatedLine.end = {
        x: updatedLine.end.x + dx,
        y: updatedLine.end.y + dy,
      };
    }
    if (this._validPoint(payload.start) && this._validPoint(payload.end)) {
      updatedLine.start = payload.start;
      updatedLine.end = payload.end;
    }

    // --- This block now safely modifies the pre-populated values ---
    if (payload.widthDelta)
      updatedLine.width = updatedLine.width + payload.widthDelta;
    if (payload.heightDelta)
      updatedLine.height = updatedLine.height + payload.heightDelta;
    if (payload.angleDelta)
      updatedLine.angle = updatedLine.angle + payload.angleDelta;
    if (typeof payload.width === "number") updatedLine.width = payload.width;
    if (typeof payload.height === "number") updatedLine.height = payload.height;
    if (typeof payload.angle === "number") updatedLine.angle = payload.angle;
    if (typeof payload.lineType === "string") {
      updatedLine.lineType = payload.lineType;
      updatedLine.color = this.colors[updatedLine.lineType] || this.colors.none;
    }
    if (payload.isZone !== undefined) updatedLine.isZone = !!payload.isZone;

    // --- Safely clamp values ---
    updatedLine.width = Math.max(1, Math.min(10000, updatedLine.width));
    updatedLine.height = Math.max(1, Math.min(1000, updatedLine.height));
    updatedLine.angle = ((updatedLine.angle % 360) + 360) % 360;

    if (isMoving && !isResizing) {
      // This logic is fine, it recalculates from start/end
      const dx = updatedLine.end.x - updatedLine.start.x;
      const dy = updatedLine.end.y - updatedLine.start.y;
      updatedLine.width = Math.hypot(dx, dy);
      updatedLine.angle = this._computeAngle(
        updatedLine.start,
        updatedLine.end,
      );
    } else if (isResizing) {
      // FIX: Use updatedLine instead of currentLine so new start/end from move operations are preserved
      const center = {
        x: (updatedLine.start.x + updatedLine.end.x) / 2, 
        y: (updatedLine.start.y + updatedLine.end.y) / 2,
      };
      const w = updatedLine.width;
      const aRad = (updatedLine.angle * Math.PI) / 180;
      const halfX = Math.cos(aRad) * (w / 2);
      const halfY = Math.sin(aRad) * (w / 2);
      updatedLine.start = { x: center.x - halfX, y: center.y - halfY };
      updatedLine.end = { x: center.x + halfX, y: center.y + halfY };
    }

    const objIndex = this.objects.findIndex((o) => o.id === updatedLine.id);
    if (objIndex !== -1) this.objects[objIndex] = updatedLine;
    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.OBJECT_UPDATED, updatedLine),
    );
  }
  // Replace your existing _updatePolygon with the snippet below

  _updatePolygon(currentPoly, payload) {
    let updatedPoly = { ...currentPoly };

    // Nudges / center / angle / type / scale handling (preserve existing behavior)
    if (payload.nudge) {
      updatedPoly.c = {
        x: updatedPoly.c.x + (payload.nudge.x || 0) * 2,
        y: updatedPoly.c.y + (payload.nudge.y || 0) * 2,
      };
    }
    if (this._validPoint(payload.c)) updatedPoly.c = payload.c;
    if (payload.angleDelta)
      updatedPoly.a = (updatedPoly.a || 0) + payload.angleDelta;
    if (typeof payload.a === "number") updatedPoly.a = payload.a;
    // Find this block:
    if (typeof payload.polyType === "string") {
      updatedPoly.polyType = payload.polyType;
      updatedPoly.color = this.colors[updatedPoly.polyType] || this.colors.none;
    }
    if (payload.isZone !== undefined) updatedPoly.isZone = !!payload.isZone;

    updatedPoly.a = (((updatedPoly.a || 0) % 360) + 360) % 360;

    if (payload.scaleDelta) {
      const currentScale =
        typeof updatedPoly.scale === "number" ? updatedPoly.scale : 1;
      updatedPoly.scale = currentScale + payload.scaleDelta;
    }
    if (typeof payload.scale === "number") updatedPoly.scale = payload.scale;
    updatedPoly.scale = Math.max(0.1, Math.min(10, updatedPoly.scale || 1));

    // ---- NEW: accept and validate incoming vertex array payload.v ----
    // Expect payload.v to be an array of {x,y} local vertices (same shape your clients send).
    if (Array.isArray(payload.v)) {
      // sanitize & validate each vertex
      const cleanedVerts = payload.v
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => this._validPoint(p));

      // If too few verts -> treat as invalid and delete the polygon to avoid corrupt state
      if (cleanedVerts.length < 3) {
        // remove locally and notify participants
        this.objects = this.objects.filter((o) => o.id !== updatedPoly.id);
        this.participants.forEach((id) =>
          this.io.to(id).emit(EVENTS.OBJECT_DELETED, { id: updatedPoly.id }),
        );
        return;
      }

      // Accept the cleaned vertices
      updatedPoly.v = cleanedVerts;
    }

    // Persist updated polygon in server state and broadcast
    const objIndex = this.objects.findIndex((o) => o.id === updatedPoly.id);
    if (objIndex !== -1) this.objects[objIndex] = updatedPoly;

    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.OBJECT_UPDATED, updatedPoly),
    );
  }

  _updateCircle(currentCircle, payload) {
    let updatedCircle = { ...currentCircle };

    if (payload.nudge) {
      updatedCircle.c = {
        x: updatedCircle.c.x + (payload.nudge.x || 0) * 2,
        y: updatedCircle.c.y + (payload.nudge.y || 0) * 2,
      };
    }
    if (this._validPoint(payload.c)) updatedCircle.c = payload.c;
    if (payload.radiusDelta)
      updatedCircle.radius = (updatedCircle.radius || 0) + payload.radiusDelta;
    if (typeof payload.radius === "number")
      updatedCircle.radius = payload.radius;
    if (typeof payload.circleType === "string") {
      updatedCircle.circleType = payload.circleType;
      updatedCircle.color =
        this.colors[updatedCircle.circleType] || this.colors.none;
    }
    if (payload.isZone !== undefined) updatedCircle.isZone = !!payload.isZone;

    updatedCircle.radius = Math.max(
      1,
      Math.min(1000, updatedCircle.radius || 0),
    );

    const objIndex = this.objects.findIndex((o) => o.id === updatedCircle.id);
    if (objIndex !== -1) this.objects[objIndex] = updatedCircle;

    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.OBJECT_UPDATED, updatedCircle),
    );
  }

  handleObjectsReorder(playerId, { ids, toBack }) {
    if (!this._canPlayerAct(playerId) || !this._allow(playerId, "reorder", 250))
      return;
    if (!Array.isArray(ids) || ids.length === 0) return;

    // Remove selected objects from current list
    const moving = [];
    this.objects = this.objects.filter((o) => {
      if (ids.includes(o.id)) {
        moving.push(o);
        return false;
      }
      return true;
    });

    // Preserve relative order according to ids array
    const orderedMoving = ids
      .map((id) => moving.find((o) => o.id === id))
      .filter(Boolean);

    if (toBack) {
      this.objects = [...orderedMoving, ...this.objects];
    } else {
      this.objects = [...this.objects, ...orderedMoving];
    }

    // Broadcast the new full order to all clients
    this.participants.forEach((pid) => {
      this.io.to(pid).emit(EVENTS.OBJECTS_REORDERED, this.objects);
    });
  }

  setSpawnCircle(playerId, { x, y }) {
    if (
      !this._canPlayerAct(playerId) ||
      !this._validCoord(x) ||
      !this._validCoord(y)
    )
      return;
    this.spawnCircle = { ...this.spawnCircle, x, y };
    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.SPAWN_CIRCLE_UPDATED, this.spawnCircle);
    });
  }

  setCapZone(playerId, { x, y, width, height }) {
    if (!this._canPlayerAct(playerId)) return;
    if (this._validCoord(x) && this._validCoord(y)) {
      this.capZone = { ...this.capZone, x, y };
    }
    if (this._validCoord(width) && this._validCoord(height)) {
      this.capZone = { ...this.capZone, width, height };
    }
    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.CAP_ZONE_UPDATED, this.capZone);
    });
  }

  setMapSize(playerId, size) {
    if (!this._canPlayerAct(playerId)) return;
    const clampedSize = Math.max(1, Math.min(13, Math.trunc(size)));
    this.mapSize = clampedSize;
    this.spawnCircle.diameter = getSpawnDiameter(this.mapSize);
    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.MAP_SIZE_UPDATED, clampedSize);
      // Also update spawn circle since its diameter changed
      this.io.to(id).emit(EVENTS.SPAWN_CIRCLE_UPDATED, this.spawnCircle);
    });
  }

  // in gameManager.js

  handlePasteLines(playerId, pasteData) {
    if (!this._canPlayerAct(playerId) || !this._allow(playerId, "paste", 3000))
      return;

    if (!pasteData || !Array.isArray(pasteData.objects)) return;

    const player = this.lobby.players[playerId];
    const newObjects = [];

    // Safely merge pasted colors while protecting internal shading structures
    this.colors = {
      ...this.colors,
      ...(pasteData.colors || {})
    };

    if (!this.colors.shadingStyles) {
        this.colors.shadingStyles = { 
            none: getRandomShadingStyle(), 
            death: getRandomShadingStyle(), 
            bouncy: getRandomShadingStyle() 
        };
    }
    this.participants.forEach((id) =>
      this.io.to(id).emit(EVENTS.COLORS_UPDATED, this.colors),
    );

    // 2. Create objects using their specific colors from paste data
    for (const objData of pasteData.objects) {
      if (!objData) continue;
      if (objData.isBgLine) continue; // Don't create BG as an object

      const base = {
        id: uuidv4(),
        playerId: "",
        username: player.name,
        symbol: " ",
        color: objData.color || this.colors.none, // Use pasted color or fallback
        createdAt: Date.now(),
        isZone: !!objData.isZone,
      };

      if (
        objData.type === "line" &&
        this._validPoint(objData.start) &&
        this._validPoint(objData.end)
      ) {
        const dx = objData.end.x - objData.start.x;
        const dy = objData.end.y - objData.start.y;
        newObjects.push({
          ...base,
          type: "line",
          start: objData.start,
          end: objData.end,
          lineType: objData.lineType || "none",
          width: Math.hypot(dx, dy),
          height: objData.height || 4,
          angle: this._computeAngle(objData.start, objData.end),
        });
      } else if (
        objData.type === "poly" &&
        this._validPoint(objData.c) &&
        Array.isArray(objData.v)
      ) {
        newObjects.push({
          ...base,
          type: "poly",
          c: objData.c,
          v: objData.v,
          a: objData.a || 0,
          scale: objData.scale || 1,
          polyType: objData.polyType || "none",
        });
      } else if (
        objData.type === "circle" &&
        this._validPoint(objData.c) &&
        typeof objData.radius === "number"
      ) {
        const circleType = objData.circleType || "none";
        newObjects.push({
          ...base,
          type: "circle",
          c: objData.c, // CHANGED: Use the 'c' object directly
          radius: objData.radius,
          circleType: circleType,
        });
      }
    }

      if (newObjects.length > 0) {
        // FIX: Append new pasted objects instead of completely overwriting the map
        this.objects = [...this.objects, ...newObjects]; 

        let colorsUpdated = false;

        if (pasteData.mapSize) this.setMapSize(playerId, pasteData.mapSize);
      if (pasteData.spawn && this._validPoint(pasteData.spawn))
        this.setSpawnCircle(playerId, pasteData.spawn);
      // --- FIX: Only pass x and y from pasted capZone data ---
      if (pasteData.capZone && this._validPoint(pasteData.capZone)) {
        this.setCapZone(playerId, {
          x: pasteData.capZone.x,
          y: pasteData.capZone.y,
        });
      }
      this.participants.forEach((id) => {
        this.io.to(id).emit(EVENTS.OBJECTS_REORDERED, this.objects);
        if (colorsUpdated) {
          this.io.to(id).emit(EVENTS.COLORS_UPDATED, this.colors);
        }
      });
    }
  }

  handleToggleShades(playerId, payload) {
    if (!this._canPlayerAct(playerId)) return;
    if (!payload || !payload.type) return;

    // Isolate shading toggles so one doesn't affect another
    if (payload.type === 'none') this.colors.useShades = payload.state;
    else if (payload.type === 'death') this.colors.shadeDeath = payload.state;
    else if (payload.type === 'bouncy') this.colors.shadeBouncy = payload.state;

    // Only roll a new direction for the specific type that was toggled on
    if (payload.state) {
        this.colors.shadingStyles[payload.type] = getRandomShadingStyle();
    }

    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.COLORS_UPDATED, this.colors);
    });
  }

  handleChangeSpecificColor(playerId, type) {
    if (!this._canPlayerAct(playerId) || !this._allow(playerId, "changeSpecificColor", 400)) return;
    if (!["none", "bouncy", "death", "background"].includes(type)) return;

    this.colors[type] = generateDistinctColor(this.colors, type, hslToRgbStr);

    if (type !== 'background') {
        this.colors.shadingStyles[type] = getRandomShadingStyle();
    }

    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.COLORS_UPDATED, this.colors);
    });
  }

  handleChangeColors(playerId) {
    if (!this._canPlayerAct(playerId) || !this._allow(playerId, "changeColor", 1000)) return;

    const scheme = generateBeautifulColorScheme();
    scheme.useShades = this.colors.useShades;
    scheme.shadeDeath = this.colors.shadeDeath;
    scheme.shadeBouncy = this.colors.shadeBouncy;
    scheme.shadingStyles = {
        none: getRandomShadingStyle(),
        death: getRandomShadingStyle(),
        bouncy: getRandomShadingStyle()
    };
    this.colors = scheme;

    this.participants.forEach((id) => {
      this.io.to(id).emit(EVENTS.COLORS_UPDATED, this.colors);
    });
  }
  
  // --- Helpers & Validation ---
  _allow(playerId, actionKey, minMs = 50) {
    const key = `${playerId}:${actionKey}`;
    const now = Date.now();
    const last = this._lastEventTs.get(key) || 0;
    if (now - last < minMs) return false;
    this._lastEventTs.set(key, now);
    return true;
  }

  _canPlayerAct(playerId) {
    return this.active && this.participants.includes(playerId);
  }

  _canModifyObject(playerId, objectId) {
    if (!this._canPlayerAct(playerId)) return false;
    const object = this.objects.find((o) => o.id === objectId);
    if (!object) return false;
    // Pasted maps are owned by no one initially, so anyone can edit.
    if (object.symbol === " ") return true;
    const ownerIsPresent = this.participants.includes(object.playerId);
    return object.playerId === playerId || !ownerIsPresent;
  }

  _validCoord(c) {
    return typeof c === "number" && isFinite(c);
  }

  _validPoint(pt) {
    return pt && this._validCoord(pt.x) && this._validCoord(pt.y);
  }

  _computeAngle(start, end) {
    const angle =
      Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    return ((angle % 360) + 360) % 360;
  }

  _shouldShade(subType) {
    if (!this.colors.shadingStyle) return false;
    // FIX: Make all 3 shading options completely independent
    if (subType === "none" && this.useShades) return true;
    if (subType === "death" && this.shadeDeath) return true;
    if (subType === "bouncy" && this.shadeBouncy) return true;
    return false;
  }
}


module.exports = { GameManager };
