
// ==UserScript==
// @name         pkrGeneratorX
// @version      0.1.1
// @description  A mod to select maps and control a timer in Bonk.io using BonkHUD
// @author       You
// @match        https://bonk.io/gameframe-release.html
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/elder-tubby/bonkio-public-notes/main/pkrGeneratorX.user.js
// @downloadURL  https://raw.githubusercontent.com/elder-tubby/bonkio-public-notes/main/pkrGeneratorX.user.js

// ==/UserScript==

("use strict");

// Constants
const CONFIG = {
    WINDOW_NAME: "pkrGeneratorX",
    WINDOW_ID: "pkr_generator_x_window",
    MOD_VERSION: "0.1.0",
    BONK_LIB_VERSION: "1.1.3",
    BONK_VERSION: "49",
    API_BASE_URL: "https://raw.githubusercontent.com/elder-tubby/bonkio-public-notes/main/map-data",
    MAP_LOAD_DELAY: 2000,
    BATCH_SIZE: 100,
    COUNTDOWN_ALERTS: [10, 3, 2, 1],
    MAP_SIZE_MAPPING: {
        1: 30, 2: 24, 3: 20, 4: 17, 5: 15, 6: 13,
        7: 12, 8: 10, 9: 9, 10: 8, 11: 7, 12: 6, 13: 5
    }
};

// Utility functions
const Utils = {
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
        const secs = (seconds % 60).toString().padStart(2, "0");
        return `${minutes}:${secs}`;
    },

    getCacheQuery() {
        return `?t=${Math.random() * 1000000}`;
    },

    safeParseJSON(data) {
        try {
            return typeof data === "string" ? JSON.parse(data) : data;
        } catch (error) {
            console.error("Error parsing JSON:", error);
            return null;
        }
    },

    showNotification(message, duration = 3000) {
        const note = document.createElement('div');
        note.textContent = message;
        Object.assign(note.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#222',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '6px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            fontSize: '14px',
            zIndex: 9999,
            opacity: 0,
            transition: 'opacity 0.3s ease-in-out'
        });

        document.body.appendChild(note);
        requestAnimationFrame(() => {
            note.style.opacity = 1;
        });

        setTimeout(() => {
            note.style.opacity = 0;
            note.addEventListener('transitionend', () => {
                note.remove();
            }, { once: true });
        }, duration);
    }

};

// Add styles
const style = document.createElement("style");
style.textContent = `
.pkr-select {
    width: 100%;
    padding: 2px 4px;
    background-color: #1e1e1e;
    color: white;
    border: 1px solid #666;
    border-radius: 4px;
    font-size: 10px;
}
`;
document.head.appendChild(style);

// Main application object
window.pkrGeneratorX = {
    // Application state
    state: {
        chatAlerts: false,
        keepPositions: false,
        linearMapSelection: false,
        selectedGroup: null,
        selectedMapId: null,
        type: 1,
        mapsStructureData: {}
    },

    // Window configuration
    windowConfigs: {
        windowName: CONFIG.WINDOW_NAME,
        windowId: CONFIG.WINDOW_ID,
        modVersion: CONFIG.MOD_VERSION,
        bonkLIBVersion: CONFIG.BONK_LIB_VERSION,
        bonkVersion: CONFIG.BONK_VERSION,
        windowContent: null
    },

    // Cached DOM elements
    domCache: {},

    // Get and cache DOM elements
    getElement(id) {
        if (!this.domCache[id]) {
            this.domCache[id] = document.getElementById(id);
        }
        return this.domCache[id];
    },

    // Clear DOM cache
    clearDOMCache() {
        this.domCache = {};
    }
};

// Timer Module
pkrGeneratorX.timerModule = {
    currentTime: 0,
    isRunning: false,
    loopDuration: null,
    intervalId: null,

    formatTime(seconds) {
        return Utils.formatTime(seconds);
    },

    updateDisplay() {
        const display = pkrGeneratorX.getElement("pkr-timer-display");
        if (display) {
            display.textContent = this.formatTime(this.currentTime);
        }
    },

    startLoop() {
        this.stopLoop();

        this.intervalId = setInterval(async () => {
            if (!this.isRunning) return;

            this.currentTime = Math.max(0, this.currentTime - 1);
            this.updateDisplay();

            // Send countdown alerts
            if (CONFIG.COUNTDOWN_ALERTS.includes(this.currentTime)) {
                const message = this.currentTime === 10
                ? "Next map in 10 seconds"
                : String(this.currentTime);
                pkrGeneratorX.chatManager.sendChatMessage(message);
            }

            // Timer reached zero
            if (this.currentTime === 0) {
                await this.handleTimerEnd();
            }
        }, 1000);
    },

    async handleTimerEnd() {
        try {
            await pkrGeneratorX.mapManager.selectAndStartNextMap();

            if (this.loopDuration) {
                this.isRunning = false;
                this.stopLoop();

                setTimeout(() => {
                    this.currentTime = this.loopDuration;
                    this.updateDisplay();
                    this.isRunning = true;
                    this.startLoop();
                }, CONFIG.MAP_LOAD_DELAY);
            } else {
                this.stop();
            }
        } catch (error) {
            console.error("Error handling timer end:", error);
            this.stop();
        }
    },

    stopLoop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    },

    toggleStartPause() {
        this.isRunning = !this.isRunning;
        this.updateButtonText();

        if (this.isRunning) {
            this.startLoop();
        }
    },

    updateButtonText() {
        const button = pkrGeneratorX.getElement("pkr-startpause-btn");
        if (button) {
            button.textContent = this.isRunning ? "Pause" : "Start";
        }
    },

    addTime(delta) {
        this.currentTime = Math.max(0, this.currentTime + delta);
        this.updateDisplay();
    },

    reset() {
        this.isRunning = false;
        this.stopLoop();
        this.currentTime = 0;
        this.updateDisplay();
        this.updateButtonText();
    },

    stop() {
        this.isRunning = false;
        this.stopLoop();
        this.updateButtonText();
    },

    setLoopDuration() {
        if (this.currentTime > 0) {
            this.loopDuration = this.currentTime;
            // console.log("Loop duration set to", this.formatTime(this.loopDuration));
        } else {
            Utils.showNotification("Cannot set loop duration to 0.");
        }
    }
};

// Chat Manager
pkrGeneratorX.chatManager = {
    sendChatMessage(message) {
        if (!pkrGeneratorX.state.chatAlerts) return;

        try {
            window.bonkHost?.toolFunctions?.networkEngine?.chatMessage(message);
        } catch (error) {
            console.error("Error sending chat message:", error);
        }
    }
};

// Map Fetcher
pkrGeneratorX.mapFetcher = {
    async fetchMapsStructure() {
        const url = `${CONFIG.API_BASE_URL}/groups.json${Utils.getCacheQuery()}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to load groups`);
            }

            const data = await response.json();
            // console.log("[MapFetcher] Loaded maps structure:", data);
            pkrGeneratorX._mapsStructure = data;
            return data;
        } catch (error) {
            const message = "Failed to load group data. Please check your connection.";
            Utils.showNotification(message);
            console.error("[MapFetcher] Error:", error);
            return null;
        }
    },

async fetchCurrentMapData() {
        const mapId = pkrGeneratorX.state.selectedMapId;
        if (!mapId) {
            console.warn("[MapFetcher] No map ID selected");
            return null;
        }

        // --- NEW: Handle Local Maps ---
        if (pkrGeneratorX.localMapsData && pkrGeneratorX.localMapsData[mapId]) {
            return pkrGeneratorX.localMapsData[mapId];
        }

        const url = `${CONFIG.API_BASE_URL}/${mapId}.json${Utils.getCacheQuery()}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to fetch map`);
            }

            return await response.json();
        } catch (error) {
            const message = "Failed to load map. Please try again.";
            Utils.showNotification(message);
            console.error("[MapFetcher] Error loading map:", error);
            return null;
        }
    },
    async fetchRandomMapAndAuthorNames() {
        const url = `${CONFIG.API_BASE_URL}/mapAndAuthorNames.json${Utils.getCacheQuery()}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to fetch names`);
            }

            const data = await response.json();
            const keys = Object.keys(data);

            if (keys.length === 0) {
                throw new Error("No map names available");
            }

            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            return { key: randomKey, value: data[randomKey] };
        } catch (error) {
            console.error("[MapFetcher] Error fetching map/author names:", error);
            return null;
        }
    }
};

// Map Manager
pkrGeneratorX.mapManager = {
    async createMap() {
        const mapId = pkrGeneratorX.state.selectedMapId;
        if (!mapId) {
            Utils.showNotification("No map selected.");
            return;
        }

        try {
            // console.log("[MapManager] Creating map for ID:", mapId);

            const [mapData, nameData] = await Promise.all([
                pkrGeneratorX.mapFetcher.fetchCurrentMapData(),
                pkrGeneratorX.mapFetcher.fetchRandomMapAndAuthorNames()
            ]);

            if (!mapData) {
                throw new Error("Failed to fetch map data");
            }

            await this.buildAndSetMap(mapData, nameData);
            // console.log("[MapManager] Map created successfully");
        } catch (error) {
            console.error("[MapManager] Error creating map:", error);
            Utils.showNotification("Failed to create map. Check console for details.");
        }
    },

    async buildAndSetMap(inputData, nameData) {
        const parsedData = Utils.safeParseJSON(inputData);
        if (!parsedData) {
            throw new Error("Invalid map data format");
        }

        const window = parent.frames[0];
        const bonkHost = window.bonkHost;

        if (!bonkHost) {
            throw new Error("BonkHost not available");
        }

        const gameSettings = bonkHost.toolFunctions.getGameSettings();
        const map = bonkHost.bigClass.mergeIntoNewMap(bonkHost.bigClass.getBlankMap());

        // Set map metadata
        this.setMapMetadata(map, nameData);

        // Build map geometry
        this.buildMapGeometry(map, parsedData, window);

        // Set spawn point
        this.setSpawnPoint(map, parsedData);

        // Configure map settings
        this.configureMapSettings(map, parsedData);

        // Apply to game
        gameSettings.map = map;
        bonkHost.menuFunctions.setGameSettings(gameSettings);
        bonkHost.menuFunctions.updateGameSettings();
    },

    setMapMetadata(map, nameData) {
        const currentPlayer = window.bonkHost?.players?.[
            window.bonkHost.toolFunctions.networkEngine.getLSID()
        ];

        map.m.a = currentPlayer?.userName || "Unknown";
        map.m.n = "Generated Parkour";

        if (nameData) {
            map.m.n = nameData.key;
            map.m.a = nameData.value;
        }
    },

buildMapGeometry(map, inputData, window) {
        const allShapes = inputData.objects || inputData.lines || [];
        const isOldFormat = !inputData.objects && inputData.lines;

        if (allShapes.length === 0) {
            console.warn("No shapes found in map data");
        }

        // Create shapes
        map.physics.shapes = allShapes.map(r => {
            let shape;
            const objType = isOldFormat ? "line" : r.type;

            if (objType === "poly") {
                shape = window.bonkHost.bigClass.getNewPolyShape();
                let verts = (r.vertices || []).map(v => {
                    if (Array.isArray(v)) return [Number(v[0]), Number(v[1])];
                    return [Number(v.x ?? v.X ?? 0), Number(v.y ?? v.Y ?? 0)];
                });

                const maxCoord = Math.max(...verts.flat().map(Math.abs), 0);
                if (maxCoord > 1000) {
                    verts = verts.map(([vx, vy]) => [vx - (r.x || 0), vy - (r.y || 0)]);
                }

                shape.v = verts;
                shape.s = Number(r.scale || 1);
            } else if (objType === "circle") {
                shape = window.bonkHost.bigClass.getNewCircleShape();
                shape.r = Number(r.radius || 0);
            } else {
                shape = window.bonkHost.bigClass.getNewBoxShape();
                shape.w = Number(r.width || 0);
                shape.h = Number(r.height || 0);
            }

            shape.c = [Number(r.x || 0), Number(r.y || 0)];
            shape.a = (Number(r.angle || 0)) * Math.PI / 180;
            shape.color = Number(r.color || 0);
            shape.d = true;
            return shape;
        });

        // Create bodies in batches
        const numBatches = Math.ceil(map.physics.shapes.length / CONFIG.BATCH_SIZE);
        for (let i = 0; i < numBatches; i++) {
            const body = window.bonkHost.bigClass.getNewBody();
            body.p = [-935, -350];

            const startIndex = i * CONFIG.BATCH_SIZE;
            const endIndex = Math.min(CONFIG.BATCH_SIZE, map.physics.shapes.length - startIndex);
            body.fx = Array.from({ length: endIndex }, (_, j) => startIndex + j);

            map.physics.bodies.unshift(body);
        }

        // Create fixtures
        map.physics.fixtures = allShapes.map((r, i) => {
            const fixture = window.bonkHost.bigClass.getNewFixture();
            fixture.sh = i;
            fixture.d = !!r.isDeath;
            fixture.re = r.isBouncy ? null : -1;
            fixture.fr = r.friction || 0;
            fixture.np = !!r.noPhysics;
            fixture.ng = !!r.noGrapple;
            fixture.f = Number(r.color || 0);

            if (r.isCapzone) fixture.n = `${r.id}. CZ`;
            else if (r.isNoJump) fixture.n = `${r.id}. NoJump`;
            else if (r.noPhysics) fixture.n = `${r.id}. NoPhysics`;
            else fixture.n = `${r.id}. Shape`;

            return fixture;
        });

        map.physics.bro = map.physics.bodies.map((_, index) => index);

        // Add cap zones natively (Replaces the external this.addCapZones call)
        allShapes.forEach((line) => {
            if (line.isCapzone) {
                map.capZones.push({ n: `${line.id}. Cap Zone`, ty: 1, l: 0.01, i: line.id });
            }
            if (line.isNoJump) {
                map.capZones.push({ n: `${line.id}. No Jump`, ty: 2, l: 10, i: line.id });
            }
        });
    },




setSpawnPoint(map, inputData) {
        const spawnObj = inputData.spawn || {};
        const spawnX = Number(spawnObj.spawnX ?? spawnObj.x ?? 0);
        const spawnY = Number(spawnObj.spawnY ?? spawnObj.y ?? 0);

        if (spawnX > 10000 || spawnY > 10000) {
            return;
        }

        map.spawns = [{
            b: true,
            f: true,
            gr: false,
            n: "Spawn",
            priority: 5,
            r: true,
            x: spawnX,
            xv: 0,
            y: spawnY,
            ye: false,
            yv: 0,
        }];
    },

    configureMapSettings(map, inputData) {
        map.s.nc = true;
        map.s.re = true;
        map.physics.ppm = this.getProcessedMapSize(inputData);
    },

    getProcessedMapSize(inputData) {
        const mapSize = inputData.mapSize;
        if (mapSize === undefined) return 9;

        if (!inputData.version) {
            return mapSize;
        }

        return CONFIG.MAP_SIZE_MAPPING[Math.floor(mapSize)] || 9;
    },

    async createAndStartMap() {
        await this.createMap();

        try {
            const bonkHost = window.bonkHost;
            const keepPositions = pkrGeneratorX.state.keepPositions;

            const originalKeepState = bonkHost.keepState;
            bonkHost.keepState = keepPositions;
            bonkHost.startGame();
            bonkHost.keepState = originalKeepState;

            // console.log("[MapManager] Game started with keepPositions:", keepPositions);
        } catch (error) {
            console.error("[MapManager] Error starting game:", error);
        }
    },

    async selectAndStartNextMap() {
        try {
            const state = pkrGeneratorX.state;
            const typeKey = `Type ${state.type}`;
            const groupMaps = (pkrGeneratorX._mapsStructure[typeKey] || {})[state.selectedGroup] || [];

            if (groupMaps.length === 0) {
                console.warn("[MapManager] No maps available in group");
                return;
            }

            let nextMap = null;

            if (state.linearMapSelection) {
                const currentIndex = groupMaps.findIndex(m => m.mapId === state.selectedMapId);
                const nextIndex = (currentIndex + 1) % groupMaps.length;

                if (groupMaps[nextIndex].mapId === state.selectedMapId && groupMaps.length > 1) {
                    // In case all maps are the same or only one map, avoid infinite loop
                    nextMap = groupMaps[(nextIndex + 1) % groupMaps.length];
                } else {
                    nextMap = groupMaps[nextIndex];
                }

                console.log("[MapManager] Linear next map:", nextMap);
            } else {
                const available = groupMaps.filter(m => m.mapId !== state.selectedMapId);
                if (!available.length) {
                    console.warn("[MapManager] No alternate maps available.");
                    return;
                }
                nextMap = available[Math.floor(Math.random() * available.length)];
                // console.log("[MapManager] Random map:", nextMap);
            }

            state.selectedMapId = nextMap.mapId;
            this.updateMapDropdown();
            await this.createAndStartMap();
        } catch (error) {
            console.error("[MapManager] Error selecting next map:", error);
        }
    },

    updateMapDropdown() {
        const dropdown = pkrGeneratorX.getElement("pkr-map-select");
        if (dropdown) {
            dropdown.value = pkrGeneratorX.state.selectedMapId || "";
        }
    }
};

// Bonk API setup
window.bonkAPI = window.bonkAPI || {};

// THE FIX: Only build the event handler if BonkLIB hasn't already built it!
if (!window.bonkAPI.events) {
    bonkAPI.addEventListener = function (event, method, scope, context) {
        bonkAPI.events.addEventListener(event, method, scope, context);
    };

    bonkAPI.EventHandler = function () {
        this.hasEvent = [];
    };

    bonkAPI.EventHandler.prototype = {
        addEventListener: function (event, method, scope, context) {
            let listeners = this.listeners;
            if (!listeners) {
                listeners = this.listeners = {};
            }

            let handlers = listeners[event];
            if (!handlers) {
                handlers = listeners[event] = [];
                this.hasEvent[event] = true;
            }

            scope = scope || window;
            handlers.push({
                method: method,
                scope: scope,
                context: context || scope,
            });
        },

        fireEvent: function (event, data, context) {
            const listeners = this.listeners;
            if (!listeners) return;

            const handlers = listeners[event];
            if (!handlers) return;

            for (let i = 0; i < handlers.length; i++) {
                const handler = handlers[i];
                if (typeof context !== "undefined" && context !== handler.context) {
                    continue;
                }
                try {
                    handler.method.call(handler.scope, data);
                } catch (error) {
                    console.error("Error in event handler:", error);
                }
            }
        },
    };

    bonkAPI.events = new bonkAPI.EventHandler();
}

// Code injection for events
bonkAPI.injector = function (src) {
    let newSrc = src;

    // Inject capZoneEvent
    const orgCapCode = `K$h[9]=K$h[0][0][K$h[2][138]]()[K$h[2][115]];`;
    const newCapCode = `
        K$h[9]=K$h[0][0][K$h[2][138]]()[K$h[2][115]];

        bonkAPI_capZoneEventTry: try {
            let inputState = z0M[0][0];
            let currentFrame = inputState.rl;
            let playerID = K$h[0][0].m_userData.arrayID;
            let capID = K$h[1];

            let sendObj = { capID: capID, playerID: playerID, currentFrame: currentFrame };

            if (window.bonkAPI.events.hasEvent["capZoneEvent"]) {
                window.bonkAPI.events.fireEvent("capZoneEvent", sendObj);
            }
        } catch(err) {
            console.error("ERROR: capZoneEvent", err);
        }`;

    newSrc = newSrc.replace(orgCapCode, newCapCode);

    // Inject stepEvent
    const orgStepCode = `return z0M[720];`;
    const newStepCode = `
        bonkAPI_stepEventTry: try {
            let inputStateClone = JSON.parse(JSON.stringify(z0M[0][0]));
            let currentFrame = inputStateClone.rl;
            let gameStateClone = JSON.parse(JSON.stringify(z0M[720]));

            let sendObj = { inputState: inputStateClone, gameState: gameStateClone, currentFrame: currentFrame };

            if (window.bonkAPI.events.hasEvent["stepEvent"]) {
                window.bonkAPI.events.fireEvent("stepEvent", sendObj);
            }
        } catch(err) {
            console.error("ERROR: stepEvent", err);
        }

        return z0M[720];`;

    newSrc = newSrc.replace(orgStepCode, newStepCode);

    return newSrc;
};

// Keep positions injector
pkrGeneratorX.keepPositionsInjector = function (str) {
    let newStr = str;

    try {
        const BIGVAR = newStr.match(/[A-Za-z0-9$_]+\[[0-9]{6}\]/)[0].split("[")[0];
        let stateCreationString = newStr.match(/[A-Za-z]\[...(\[[0-9]{1,4}\]){2}\]\(\[\{/)[0];
        let stateCreationStringIndex = stateCreationString.match(/[0-9]{1,4}/g);
        stateCreationStringIndex = stateCreationStringIndex[stateCreationStringIndex.length - 1];

        let stateCreation = newStr.match(
            `[A-Za-z0-9\$_]{3}\[[0-9]{1,3}\]=[A-Za-z0-9\$_]{3}\\[[0-9]{1,4}\\]\\[[A-Za-z0-9\$_]{3}\\[[0-9]{1,4}\\]\\[${stateCreationStringIndex}\\]\\].+?(?=;);`
        )[0];
        stateCreationString = stateCreation.split("]")[0] + "]";

        const SET_STATE = `
              if (
                  ${BIGVAR}.bonkHost.state &&
                  !window.bonkHost.keepState &&
                  window.pkrGeneratorX.state.keepPositions &&
                  window.bonkHost.toolFunctions.getGameSettings().ga === "b"
                  ) {
                  ${stateCreationString}.discs = [];
                  for(let i = 0; i < ${BIGVAR}.bonkHost.state.discs.length; i++) {
                      if(${BIGVAR}.bonkHost.state.discs[i] != undefined) {
                          ${stateCreationString}.discs[i] = ${BIGVAR}.bonkHost.state.discs[i];
                          if(window.bonkHost.toolFunctions.getGameSettings().mo=='sp') {
                              ${stateCreationString}.discs[i].a1a -= Math.min(2*30, 2*30 - ${BIGVAR}.bonkHost.state.ftu)*3;
                          }
                      }
                  }
                  for(let i = 0; i < ${BIGVAR}.bonkHost.state.discDeaths.length; i++) {
                      if(${BIGVAR}.bonkHost.state.discDeaths[i] != undefined) {
                          ${stateCreationString}.discDeaths[i] = ${BIGVAR}.bonkHost.state.discDeaths[i];
                      }
                  }
                  ${stateCreationString}.seed=${BIGVAR}.bonkHost.state.seed;
                  ${stateCreationString}.rc=${BIGVAR}.bonkHost.state.rc + 1;
                  ${stateCreationString}.rl=0;
                  ${stateCreationString}.ftu=60;
                  ${stateCreationString}.shk=${BIGVAR}.bonkHost.state.shk;
              };
              `;

        const stateSetRegex = newStr.match(
            /\* 999\),[A-Za-z0-9\$_]{3}\[[0-9]{1,3}\],null,[A-Za-z0-9\$_]{3}\[[0-9]{1,3}\],true\);/
        )[0];
        newStr = newStr.replace(stateSetRegex, stateSetRegex + SET_STATE);
    } catch (error) {
        console.error("Error in keepPositionsInjector:", error);
    }

    return newStr;
};

// Register code injectors
if (!window.bonkCodeInjectors) window.bonkCodeInjectors = [];

window.bonkCodeInjectors.push((bonkCode) => {
    try {
        console.log("pkrGeneratorX: Injecting bonkAPI code");
        return bonkAPI.injector(bonkCode);
    } catch (error) {
        console.error("bonkAPI injection failed:", error);
        throw error;
    }
});

window.bonkCodeInjectors.push((bonkCode) => {
    try {
        console.log("pkrGeneratorX: Injecting keepPositions code");
        return pkrGeneratorX.keepPositionsInjector(bonkCode);
    } catch (error) {
        console.error("keepPositions injection failed:", error);
        throw error;
    }
});

// Event listeners
window.bonkAPI.events.addEventListener("capZoneEvent", function (data) {
    const { capID, playerID, currentFrame } = data;
    // console.log(`Player ${playerID} touched cap zone ${capID} at frame ${currentFrame}`);
});

// UI Creation and Management
pkrGeneratorX.createWindow = function () {
    const modIndex = bonkHUD.createMod(this.windowConfigs.windowName, this.windowConfigs);
    bonkHUD.loadUISetting(modIndex);

    // Button creation helper
    const insertButton = (id, label, onClick) => {
        const button = bonkHUD.generateButton(label);
        button.id = id;
        button.style.marginBottom = "5px";
        button.style.height = "25px";

        const container = document.getElementById(`${id}-container`);
        if (container) {
            container.appendChild(button);
            button.addEventListener("click", onClick);
        } else {
            console.warn(`Button container #${id}-container not found`);
        }
    };

    // Insert all buttons
    insertButton("pkr-create-map-btn", "Create map", () => {
        // console.log("Create map clicked");
        this.mapManager.createMap();
    });

    insertButton("pkr-add-group-btn", "Add new group", () => {
        const fileInput = document.getElementById("pkr-add-group-file");
        if (fileInput) fileInput.click();
    });

    insertButton("pkr-add-3-btn", "+3 Sec", () => this.timerModule.addTime(3));
    insertButton("pkr-sub-3-btn", "-3 Sec", () => this.timerModule.addTime(-3));
    insertButton("pkr-startpause-btn", "Start", () => this.timerModule.toggleStartPause());
    insertButton("pkr-reset-btn", "Reset", () => this.timerModule.reset());
    insertButton("pkr-set-loop-btn", "Set loop duration", () => this.timerModule.setLoopDuration());
};

pkrGeneratorX.setWindowContent = function () {
    const chatAlertsChecked = this.state.chatAlerts ? "checked" : "";
    const keepPositionsChecked = this.state.keepPositions ? "checked" : "";
    const linearMapSelectionChecked = this.state.linearMapSelection ? 'checked' : '';

    const container = document.createElement("div");
    container.innerHTML = `
        <table class="bonkhud-background-color bonkhud-border-color" style="width:100%; margin-top:10px;">
            <caption class="bonkhud-header-color">
                <span class="bonkhud-title-color">Map Selection</span>
            </caption>
            <tr>
                <td class="bonkhud-text-color">Group</td>
                <td>
                    <select id="pkr-group-select" class="pkr-select">
                        <option value="">Select map group</option>
                    </select>
                </td>
            </tr>
            <tr>
                <td class="bonkhud-text-color">Map</td>
                <td>
                    <select id="pkr-map-select" class="pkr-select">
                        <option value="">Select map</option>
                    </select>
                </td>
            </tr>
            <tr>
                <td colspan="2" style="text-align:center; padding-top:5px;">
                    <div id="pkr-create-map-btn-container" style="width:100%;"></div>
                    <div id="pkr-add-group-btn-container" style="width:100%; margin-top:5px;"></div>
                    <input type="file" id="pkr-add-group-file" multiple accept=".json,.txt" style="display: none;" />
                </td>
            </tr>
        </table>

        <table class="bonkhud-background-color bonkhud-border-color" style="margin-top:10px; width:100%;">
            <caption class="bonkhud-header-color">
                <span class="bonkhud-title-color">Timer</span>
            </caption>
            <tr>
                <td colspan="2">
                    <div id="pkr-timer-display" class="bonkhud-text-color" style="text-align:center; font-size:1.2em; padding: 5px 0;">
                        00:00
                    </div>
                </td>
            </tr>
            <tr>
                <td><div id="pkr-add-3-btn-container"></div></td>
                <td><div id="pkr-sub-3-btn-container"></div></td>
            </tr>
            <tr>
                <td><div id="pkr-startpause-btn-container"></div></td>
                <td><div id="pkr-reset-btn-container"></div></td>
            </tr>
            <tr>
                <td colspan="2">
                    <div id="pkr-set-loop-btn-container" style="text-align:center;"></div>
                </td>
            </tr>
        </table>

        <table class="bonkhud-background-color bonkhud-border-color" style="margin-top:10px;">
            <tr>
                <td class="bonkhud-text-color">
                    <label>
                        <input type="checkbox" id="pkr-chat-alerts" ${chatAlertsChecked}/> Chat alerts
                    </label>
                </td>
            </tr>
            <tr>
                <td class="bonkhud-text-color">
                    <label>
                        <input type="checkbox" id="pkr-keep-positions" ${keepPositionsChecked}/> Keep positions
                    </label>
                </td>
            </tr>
            <tr>
                <td class="bonkhud-text-color">
                    <label>
                        <input type="checkbox" id="pkr-linear-selection" ${linearMapSelectionChecked}/> Linear map selection
                    </label>
                </td>
            </tr>
        </table>
    `;

    this.windowConfigs.windowContent = container;
};

pkrGeneratorX.populateGroupDropdown = function () {
    const groupSelect = this.getElement("pkr-group-select");
    if (!groupSelect) return;

    const groups = Object.keys(this._mapsStructure["Type 1"] || {});
    // console.log("[UI] Available groups:", groups);

    groupSelect.innerHTML = [
        '<option value="">Select map group</option>',
        ...groups.map(group => `<option value="${group}">${group}</option>`)
    ].join("");
};

pkrGeneratorX.bindUI = function () {
    const groupSelect = this.getElement("pkr-group-select");
    const mapSelect = this.getElement("pkr-map-select");
    const createButton = this.getElement("pkr-create-map-btn");

    if (!groupSelect || !mapSelect || !createButton) {
        console.error("Required UI elements not found");
        return;
    }

    this.populateGroupDropdown();

    const updateCreateButton = () => {
        const isEnabled = !!(groupSelect.value && mapSelect.value);
        createButton.disabled = !isEnabled;
        // console.log(`[UI] Create button ${isEnabled ? 'enabled' : 'disabled'}`);
    };

    // Group selection handler
    groupSelect.addEventListener("change", () => {
        const selectedGroup = groupSelect.value;
        this.state.selectedGroup = selectedGroup;
        // console.log("[UI] Group selected:", selectedGroup);

        const groupMaps = (this._mapsStructure["Type 1"] || {})[selectedGroup] || [];
        // console.log("[UI] Maps for group:", groupMaps);

        mapSelect.innerHTML = [
            '<option value="">Select map</option>',
            ...groupMaps.map(map => `<option value="${map.mapId}">${map.mapName}</option>`)
        ].join("");

        this.state.selectedMapId = null;
        updateCreateButton();
    });

    // Map selection handler
    mapSelect.addEventListener("change", () => {
        const selectedMapId = mapSelect.value;
        this.state.selectedMapId = selectedMapId;
        // console.log("[UI] Map selected:", selectedMapId);
        updateCreateButton();
    });

    // Settings handlers
    const keepPositionsCheckbox = this.getElement("pkr-keep-positions");
    if (keepPositionsCheckbox) {
        keepPositionsCheckbox.addEventListener("change", (event) => {
            this.state.keepPositions = event.target.checked;
            // console.log("Keep positions:", this.state.keepPositions);
        });
    }

    const chatAlertsCheckbox = this.getElement("pkr-chat-alerts");
    if (chatAlertsCheckbox) {
        chatAlertsCheckbox.addEventListener("change", (event) => {
            this.state.chatAlerts = event.target.checked;
            // console.log("Chat alerts:", this.state.chatAlerts);
        });
    }

    const linearSelectionCheckbox = this.getElement("pkr-linear-selection");
    if (linearSelectionCheckbox) {
        linearSelectionCheckbox.addEventListener("change", (event) => {
            this.state.linearMapSelection = event.target.checked;
            // console.log("linearSelectionCheckbox:", this.state.linearSelectionCheckbox);
        });
    }


// Add New Group file upload handler
    const fileInput = document.getElementById("pkr-add-group-file");
    if (fileInput) {
        fileInput.addEventListener("change", async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            pkrGeneratorX.localGroupCount = (pkrGeneratorX.localGroupCount || 0) + 1;
            const groupName = `Local Group ${pkrGeneratorX.localGroupCount}`;
            const groupMaps = [];

            // Initialize local storage cache for session
            pkrGeneratorX.localMapsData = pkrGeneratorX.localMapsData || {};

            for (const file of files) {
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);

                    // Simple validation logic identical to clipboard paste validations
                    if (data.objects || data.lines) {
                        const localMapId = "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
                        pkrGeneratorX.localMapsData[localMapId] = data;

                        groupMaps.push({
                            mapId: localMapId,
                            mapName: file.name.replace(/\.[^/.]+$/, "") // Set name as filename without extension
                        });
                    }
                } catch (err) {
                    console.error(`Failed to parse ${file.name}`);
                }
            }

            if (groupMaps.length > 0) {
                if (!pkrGeneratorX._mapsStructure["Type 1"]) {
                    pkrGeneratorX._mapsStructure["Type 1"] = {};
                }

                pkrGeneratorX._mapsStructure["Type 1"][groupName] = groupMaps;
                pkrGeneratorX.populateGroupDropdown();
                Utils.showNotification(`Added ${groupMaps.length} map(s) to ${groupName}`);
            } else {
                Utils.showNotification("No valid maps found in selected files.");
            }

            e.target.value = ""; // Reset input so the same files can be re-uploaded if necessary
        });
    }

    updateCreateButton();
};

// Initialization
pkrGeneratorX.initMod = async function () {
    if (!window.bonkHUD) {
        Utils.showNotification("BonkHUD not loaded.");
        return;
    }

    try {
        // console.log("Initializing pkrGeneratorX...");

        await this.mapFetcher.fetchMapsStructure();
        this.setWindowContent();
        this.createWindow();
        this.bindUI();
        this.timerModule.updateDisplay();

        // console.log(this.windowConfigs.windowName, "initialized successfully");
    } catch (error) {
        console.error("Failed to initialize pkrGeneratorX:", error);
        Utils.showNotification("Failed to initialize mod. Check console for details.");
    }
};

pkrGeneratorX.onDocumentReady = function () {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        this.initMod();
    } else {
        document.addEventListener("DOMContentLoaded", () => this.initMod());
    }
};

// Start the application
pkrGeneratorX.onDocumentReady();
