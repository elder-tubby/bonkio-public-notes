// ==UserScript==
// @name         pkrGenerator
// @namespace    http://tampermonkey.net/
// @version      0.3.7
// @description  Converts elder-tubby's parkour generator data to bonk.io maps. Contains a modified version of Clarifi's pkrUtils. Records and outputs player position. Requires 'BonkLIB' mod.
// @author       eldertubby + Salama + Clarifi
// @license      MIT
// @match        https://bonkisback.io/gameframe-release.html
// @match        https://bonk.io/gameframe-release.html
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/elder-tubby/bonkio-public-notes/main/pkrGenerator.user.js
// @downloadURL  https://raw.githubusercontent.com/elder-tubby/bonkio-public-notes/main/pkrGenerator.user.js
// ==/UserScript==


window.posRecorder = {}; // Namespace for encapsulating the UI functions and variables

// Use 'strict' mode for safer code by managing silent errors
'use strict';

posRecorder.windowConfigs = {
    windowName: "pkrGenerator",
    windowId: "parkour_generator_window",
    modVersion: "0.3",
    bonkLIBVersion: "1.1.3",
    bonkVersion: "49",
};
window.parkourGenerator = {
    keepPositions: false,
};

posRecorder.currentData = {};
posRecorder.scale = 1;
posRecorder.currentPlayerID = 0;
posRecorder.positionData = [];
posRecorder.isRecording = false;
posRecorder.recordingIntervalId = null;
posRecorder.inputState = null;
posRecorder.mapList = []; // Array of {name, data}
posRecorder.currentMapIndex = -1;

// Utility functions
const Utils = {

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

// Event listener function to change the player selected in the player selector
posRecorder.select_player = () => {
    let player_selector = document.getElementById("posRecorder_player_selector");
    let player_id = player_selector.options[player_selector.selectedIndex].value;
    posRecorder.currentPlayerID = player_id;
    //console.log("current Player ID: " + player_id);
};

// Create a new option in the player selector
posRecorder.create_option = (userID) => {
    //console.log("userID:" + userID);
    let playerName = bonkAPI.getPlayerNameByID(userID);
    let player_selector = document.getElementById("posRecorder_player_selector");
    let newOption = document.createElement("option");
    newOption.innerText = playerName;
    newOption.value = userID;
    newOption.id = "selector_option_" + userID;
    player_selector.appendChild(newOption);
    //console.log("selector_option_" + userID + " added to player_selector");
};

// Remove an option from the player selector
posRecorder.remove_option = (userID) => {
    let player_selector = document.getElementById("posRecorder_player_selector");
    let option = document.getElementById("selector_option_" + userID);
    player_selector.removeChild(option);
};

// Reset the player selector to the default state
posRecorder.reset_selector = () => {
    // Remove all options except the default one
    let player_selector = document.getElementById("posRecorder_player_selector");
    Array.from(player_selector.options).forEach((option) => {
        if (option.id !== "posRecorder_selector_option_user") {
            player_selector.removeChild(option);
        }
        // Reset the current player ID
        posRecorder.currentPlayerID = bonkAPI.getMyID();
        // Set the selector to the first option as default
        player_selector.selectedIndex = bonkAPI.getMyID();
    });
};

// Update the player list in the player selector
posRecorder.update_players = () => {
    // Get the list of players and the current player ID
    let playerList = bonkAPI.getPlayerList();
    let myID = bonkAPI.getMyID();
    // Reset the player selector
    posRecorder.reset_selector();
    // Add all player to the player selector
    playerList.forEach((player, id) => {
        if (player && id !== myID) {
            posRecorder.create_option(id);
        }
    });
};

bonkAPI.addEventListener('gameStart', (e) => {
    try {
        posRecorder.scale = e.mapData.physics.ppm;
    } catch (er) {
        console.log(er)
    }
});

// Event listener for when a user joins the game
bonkAPI.addEventListener("userJoin", (e) => {
    //console.log("User join event received", e);
    //console.log("User ID", e.userID);
    // Add the player to the player selector
    posRecorder.create_option(e.userID);
});

// Event listener for when a user leaves the game
bonkAPI.addEventListener("userLeave", (e) => {
    //console.log("User Leave event received", e);
    //console.log("User ID", e.userID);
    // Remove the player from the player selector
    let playerName = bonkAPI.getPlayerNameByID(e.userID);
    let player_selector = document.getElementById("posRecorder_player_selector");
    // If the player is the current player, set the current player to 0 and reset the selector
    if (player_selector.options[player_selector.selectedIndex].value === playerName) {
        posRecorder.currentPlayerID = bonkAPI.getMyID();
        // Set the selector to the first option as default
        player_selector.selectedIndex = 0;
    }

    posRecorder.remove_option(e.userID);
});

// Event listener for when user(mod user) creates a room
bonkAPI.addEventListener("createRoom", (e) => {
    //console.log("create Room event received", e);
    //console.log("User ID", e);
    // Set the player name in the player selector to the current user
    let option = document.getElementById("posRecorder_selector_option_user");
    let playerName = bonkAPI.getPlayerNameByID(e.userID);
    option.innerText = playerName;
    option.value = e.userID;
    posRecorder.currentPlayerID = e.userID;
    // Reset the player selector to the default state
    posRecorder.reset_selector();
});

// Event listener for when user(mod user) joins a room
bonkAPI.addEventListener("joinRoom", (e) => {
    //console.log("on Join event received", e);
    //console.log("User ID", e.userID);
    // Set the player name in the player selector to the current user
    let option = document.getElementById("posRecorder_selector_option_user");
    let playerName = bonkAPI.getPlayerNameByID(bonkAPI.getMyID());
    option.innerText = playerName;
    option.value = bonkAPI.getMyID();
    posRecorder.currentPlayerID = bonkAPI.getMyID();
    // Update the player list in the player selector
    posRecorder.update_players();
});

const startRecording = (e) => {

    try {

        posRecorder.recordingIntervalId = setInterval(() => {

            // posRecorder.inputState = e.inputState;
            posRecorder.currentData = posRecorder.inputState.discs[posRecorder.currentPlayerID];

            let currentX = window.posRecorder.currentData.x * posRecorder.scale - 365;
            let currentY = window.posRecorder.currentData.y * posRecorder.scale - 250;

            if (currentX !== undefined && currentY !== undefined) {
                // Round the positions to 2 decimal points
                currentX = currentX.toFixed(2);
                currentY = currentY.toFixed(2);

                posRecorder.positionData.push({
                    x: parseFloat(currentX),
                    y: parseFloat(currentY)
                });
                // console.log("In interval");
                // console.log("posData inside interval: ", posRecorder.positionData);
            }
        }, 10); // 100ms

    } catch (err) {
        console.error("Error during position recording:", err);

    }
};

bonkAPI.addEventListener("stepEvent", (e) => {
    if (posRecorder.isRecording) {
        posRecorder.inputState = e.inputState;

        if (!posRecorder.recordingIntervalId) {
            startRecording(e);
        } else {
            console.log("Recording is already in progress...");
        }

    }
});

posRecorder.xVel = null;
posRecorder.yVel = null;
posRecorder.isListeningToVelocity = false;
bonkAPI.addEventListener("stepEvent", (e) => {
    // Check if posRecorder and its necessary properties exist

    if (posRecorder.isListeningToVelocity) {

        posRecorder.inputState = e.inputState;
        posRecorder.currentData = posRecorder.inputState.discs[bonkAPI.getMyID()];


        // Null check for posRecorder.currentData and posRecorder.scale
        if (posRecorder.currentData && typeof posRecorder.currentData.xv !== 'undefined' && typeof posRecorder.currentData.yv !== 'undefined' && typeof posRecorder.scale !== 'undefined') {
            // Safely assign the velocity values after null checks
            posRecorder.xVel = posRecorder.currentData.xv * posRecorder.scale;
            posRecorder.yVel = posRecorder.currentData.yv * posRecorder.scale;

            // console.log(`xVel: ${posRecorder.xVel}, yVel: ${posRecorder.yVel}`);

        } else {
            console.warn('posRecorder.currentData or posRecorder.scale is null or undefined');
        }
    }

});

// --- NEW: Auto Next Map on CapZone Listener ---
posRecorder.isSwitchingMap = false; // Debounce flag to prevent overlapping triggers

bonkAPI.addEventListener("capZoneEvent", async (data) => {
    const autoNextCb = document.getElementById("pkr_autoNextMap_check");

    // Check if the toggle is checked, maps are loaded, and we aren't already switching
    if (autoNextCb && autoNextCb.checked && posRecorder.mapList.length > 0 && !posRecorder.isSwitchingMap) {
        posRecorder.isSwitchingMap = true;

        // 1. Advance to the next map in the array
        posRecorder.currentMapIndex = (posRecorder.currentMapIndex + 1) % posRecorder.mapList.length;

        // 2. Update UI manually (since updateMapUI is locally scoped in addPkrDiv)
        const nameDiv = document.getElementById('pkr_map_name');
        if (nameDiv) {
            nameDiv.textContent = `[${posRecorder.currentMapIndex + 1}/${posRecorder.mapList.length}] ${posRecorder.mapList[posRecorder.currentMapIndex].name}`;
        }

        try {
            // 3. Create the map
            await createAndSetMap(posRecorder.mapList[posRecorder.currentMapIndex].data);

            if (document.getElementById("newbonklobby").style.display === "none") {
                window.parkourGenerator.keepPositions = false;
            }

            // 4. Start the game
            if (window.bonkHost && typeof window.bonkHost.startGame === 'function') {
                window.bonkHost.startGame();
            }
        } catch (err) {
            console.error("Auto start next map failed:", err);
        }

        // 5. Cooldown to prevent multiple triggers from a single multi-player cap frame
        setTimeout(() => {
            posRecorder.isSwitchingMap = false;
        }, 2000);
    }
});


// Function to stop recording positions
const stopRecording = () => {
    // console.log("posData in stopRec: ", posRecorder.positionData);

    posRecorder.isRecording = false;
    copyPositionData();
    clearInterval(posRecorder.recordingIntervalId);
    posRecorder.recordingIntervalId = null;

    console.log("Recording stopped.");
};

function removeDuplicates(positionData) {
    return positionData.filter((value, index, self) =>
                               index === self.findIndex((t) => (
        t.x === value.x && t.y === value.y)));
}

// Function to copy position data to clipboard
const copyPositionData = () => {
    posRecorder.positionData = removeDuplicates(posRecorder.positionData);
    if (posRecorder.positionData && posRecorder.positionData.length > 0) {
        // Convert position data to JSON string
        const positionDataJson = JSON.stringify(posRecorder.positionData, null, 2);

        const textarea = document.createElement("textarea");
        textarea.value = positionDataJson;
        document.body.appendChild(textarea);

        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);

        console.log("Position data copied to clipboard!");

    } else {
        console.log("No position data to copy.");
        // alert("No position data to copy!");
    }
};

const addPkrDiv = () => {
    let pkrDiv = document.createElement("div");
    pkrDiv.innerHTML = `
    <div class="bonkhud-settings-row">
        <div id="pasteButtonContainer"></div>
        <div style="display: flex; align-items: center; margin-top: 5px;">
            <input type="checkbox" id="pkr_autoStart_check" />
            <label for="pkr_autoStart_check" class="bonkhud-settings-label" style="margin-left: 5px;">Auto Start</label>
        </div>
    </div>



    <div class="bonkhud-settings-row">
        <select id="posRecorder_player_selector">
            <option id="posRecorder_selector_option_user">......</option>
        </select>
    </div>
    <div class="bonkhud-settings-row">
        <div id="recordButtonContainer"></div>
    </div>
    <div class="bonkhud-settings-row">
        <div id="copyMapButtonContainer"></div>
    </div>

    <div class="bonkhud-settings-row" style="background: rgba(0,0,0,0.1);">
        <div class="bonkhud-settings-label" style="margin-bottom: 5px; text-align: center;">Stored Maps</div>
        <div style="display: flex; justify-content: center; align-items: center; gap: 10px;">
            <div id="pkr_map_prev" style="cursor:pointer; font-size: 20px; font-weight:bold;">&lt;</div>
            <div id="pkr_map_name" class="bonkhud-text-color" style="flex: 1; text-align: center; font-size: 12px; overflow: hidden; white-space: nowrap;">No Maps Loaded</div>
            <div id="pkr_map_next" style="cursor:pointer; font-size: 20px; font-weight:bold;">&gt;</div>
        </div>
        <div id="mapActionButtons" style="display: flex; gap: 5px; margin-top: 8px;">
            <div id="pkr_load_files_btn" style="flex: 1;"></div>
            <div id="pkr_create_selected_btn" style="flex: 1;"></div>
        </div>
        <div id="pkr_clear_maps_btn" style="margin-top: 5px;"></div>

        <div style="display: flex; align-items: center; justify-content: center; margin-top: 5px; margin-bottom: 5px;">
            <input type="checkbox" id="pkr_autoNextMap_check" style="cursor: pointer;" />
            <label for="pkr_autoNextMap_check" class="bonkhud-settings-label" style="margin-left: 5px; font-size: 11px; cursor: pointer;">Auto Next Map on Cap</label>
        </div>

        <input type="file" id="pkr_file_input" multiple accept=".json,.txt" style="display: none;" />
    </div>
    `;

    let pkrIndex = bonkHUD.createWindow(posRecorder.windowConfigs.windowName, pkrDiv, posRecorder.windowConfigs);
    bonkHUD.loadUISetting(pkrIndex);

    // --- Button Generators ---
    const fileBtn = bonkHUD.generateButton("Load Files");
    fileBtn.onclick = () => document.getElementById('pkr_file_input').click();
    document.getElementById('pkr_load_files_btn').appendChild(fileBtn);

    const createSelBtn = bonkHUD.generateButton("Create Selected");
    createSelBtn.onclick = () => {
        if (posRecorder.currentMapIndex !== -1) {
            createAndSetMap(posRecorder.mapList[posRecorder.currentMapIndex].data);
        }
    };
    document.getElementById('pkr_create_selected_btn').appendChild(createSelBtn);

    const clearBtn = bonkHUD.generateButton("Clear All Maps");
    clearBtn.onclick = () => {
        posRecorder.mapList = [];
        posRecorder.currentMapIndex = -1;
        updateMapUI();
    };
    document.getElementById('pkr_clear_maps_btn').appendChild(clearBtn);

    // Now that pkrDiv is in the DOM, find the container and append the buttons
    let recordButton = bonkHUD.generateButton("Start Recording");
    recordButton.style.marginBottom = "5px";
    recordButton.style.height = "25px";
    recordButton.id = "startRecordingButton";

    let recordButtonContainer = document.getElementById("recordButtonContainer");
    recordButtonContainer.appendChild(recordButton);

    let pasteButton = bonkHUD.generateButton("Paste Data");
    pasteButton.style.marginBottom = "5px";
    pasteButton.style.height = "25px";
    pasteButton.id = "pasteDataButton";

    let pasteButtonContainer = document.getElementById("pasteButtonContainer");
    pasteButtonContainer.appendChild(pasteButton);

    let copyMapButton = bonkHUD.generateButton("Copy Map Data");
    copyMapButton.style.marginBottom = "5px";
    copyMapButton.style.height = "25px";
    copyMapButton.id = "copyMapButton";

    let copyMapButtonContainer = document.getElementById("copyMapButtonContainer");
    copyMapButtonContainer.appendChild(copyMapButton);
    copyMapButton.addEventListener("click", convertGameDataToJSON);

    // Function to toggle recording
    const toggleRecording = () => {
        if (!posRecorder.isRecording && bonkAPI.isInGame()) {
            posRecorder.isRecording = true;
            posRecorder.positionData = [];
            console.log("Recording started...");
            recordButton.textContent = "Stop and copy";
            recordButton.style.backgroundColor = "#4d0004";
        } else if (posRecorder.isRecording) {
            stopRecording();
            recordButton.textContent = "Start Recording";
            recordButton.style.backgroundColor = "#0B161C";
        }
    };

    recordButton.addEventListener("click", toggleRecording);

    document.addEventListener("keydown", (event) => {
        if (event.altKey && event.code === "Digit3") {
            toggleRecording();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.altKey && event.code === "Digit1") {
            pasteData();
        }
    });

    document.getElementById('pkr_file_input').onchange = handleFileUpload;
    document.getElementById('pkr_map_prev').onclick = () => switchMap(-1);
    document.getElementById('pkr_map_next').onclick = () => switchMap(1);

    function updateMapUI() {
        const nameDiv = document.getElementById('pkr_map_name');
        if (posRecorder.mapList.length === 0) {
            nameDiv.textContent = "No Maps Loaded";
        } else {
            nameDiv.textContent = `[${posRecorder.currentMapIndex + 1}/${posRecorder.mapList.length}] ${posRecorder.mapList[posRecorder.currentMapIndex].name}`;
        }
    }

    function switchMap(dir) {
        if (posRecorder.mapList.length === 0) return;
        posRecorder.currentMapIndex = (posRecorder.currentMapIndex + dir + posRecorder.mapList.length) % posRecorder.mapList.length;
        updateMapUI();
    }

    async function handleFileUpload(e) {
        const files = Array.from(e.target.files);
        for (const file of files) {
            const text = await file.text();
            try {
                const data = JSON.parse(text);
                // Simple validity check matching pasteData logic
                if (data.objects || data.lines) {
                    posRecorder.mapList.push({ name: file.name, data: data });
                }
            } catch (err) { console.error(`Failed to parse ${file.name}`); }
        }
        if (posRecorder.mapList.length > 0 && posRecorder.currentMapIndex === -1) {
            posRecorder.currentMapIndex = 0;
        }
        updateMapUI();
        e.target.value = ""; // Reset for re-uploading same file
    }



    // Function to handle pasting data and starting the game
    const pasteData = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const autoStart = document.getElementById("pkr_autoStart_check").checked;
            if (text.trim()) {
                await createAndSetMap(text);
                if (autoStart) {
                    if (document.getElementById("newbonklobby").style.display === "none") {
                        window.parkourGenerator.keepPositions = false;
                    }
                    window.bonkHost.startGame();
                }
            } else {
                Utils.showNotification("Clipboard is empty.");
            }
        } catch (err) {
            console.error("Paste failed: ", err);
            Utils.showNotification("Failed to read clipboard.");
        }
    };

    pasteButton.addEventListener("click", pasteData);
};

async function fetchRandomMapAndAuthorNames() {
    const url = `https://raw.githubusercontent.com/elder-tubby/bonkio-public-notes/main/map-data/mapAndAuthorNames.json?t=${Math.random() * 1000000}`;

    try {
        const response = await fetch(url);
        const mapAndAuthorNames = await response.json();

        // Get a random key from the map
        const keys = Object.keys(mapAndAuthorNames);
        const randomKey = keys[Math.floor(Math.random() * keys.length)];

        return {
            key: randomKey,
            value: mapAndAuthorNames[randomKey]
        };
    } catch (error) {
        console.error('Error fetching the JSON file:', error);
        return null; // Return null if an error occurs
    }
}

async function createAndSetMap(inputText) {
    try {
        const randomMapAndAuthor = await fetchRandomMapAndAuthorNames();
        const w = parent.frames[0];
        let gs = w.bonkHost.toolFunctions.getGameSettings();
        let map = w.bonkHost.bigClass.mergeIntoNewMap(
            w.bonkHost.bigClass.getBlankMap());
        // Parse the JSON input
        let inputData;
        try {
            if (typeof inputText === 'string') {
                inputData = JSON.parse(inputText);
            } else {
                inputData = inputText; // If it's already an object, just use it
            }
        } catch (error) {
            console.error('Error parsing JSON:', error);
            inputData = {}; // fallback to empty obj

        }
        // Extract spawn values
        const spawnObj = inputData.spawn || {};

        const spawnX = Number(spawnObj.spawnX ?? spawnObj.x ?? 0);  // default 0
        const spawnY = Number(spawnObj.spawnY ?? spawnObj.y ?? 0);  // default 0
        let mapSize = 7; // default


        try {
            const processed = getProcessedMapSize(inputData);
            if (processed && !isNaN(processed)) {
                mapSize = processed;
            }
        } catch (e) {
            console.warn("Map size fallback to default (7).");
        }
        map.m.a =
            w.bonkHost.players[
            w.bonkHost.toolFunctions.networkEngine.getLSID()
        ].userName;
        map.m.n = 'Generated Parkour';

        if (randomMapAndAuthor) {
            map.m.n = randomMapAndAuthor.key; // Assign the random key to map.m.n
            map.m.a = randomMapAndAuthor.value; // Assign the random value to map.m.a
        }

        // --- NEW: Handle old format ---
        const allShapes = inputData.objects || inputData.lines || [];
        const isOldFormat = !inputData.objects && inputData.lines;
        // --- End new logic ---

        // Convert shapes into physics shapes
        map.physics.shapes = allShapes.map(r => {
            let shape;

            // --- NEW: Force type to 'line' if old format ---
            const objType = isOldFormat ? "line" : r.type;

            if (objType === "poly") {
                shape = w.bonkHost.bigClass.getNewPolyShape();

                let verts = (r.vertices || []).map(v => {

                    if (Array.isArray(v)) return [Number(v[0]), Number(v[1])];
                    return [Number(v.x ?? v.X ?? 0), Number(v.y ?? v.Y ?? 0)];
                });

                shape.v = verts;

                shape.v = verts;
                shape.s = Number(r.scale || 1);
            } else
                if (objType === "circle") {
                    // --- NEW: Handle circle type ---
                    shape = w.bonkHost.bigClass.getNewCircleShape();
                    shape.r = Number(r.radius || 0);
                } else {
                    // This now correctly handles both 'line' type and all old format items
                    shape = w.bonkHost.bigClass.getNewBoxShape();
                    shape.w = Number(r.width || 0);
                    shape.h = Number(r.height || 0);
                }

            shape.c = [Number(r.x || 0), Number(r.y || 0)];
            shape.a = (Number(r.angle || 0)) * Math.PI / 180;
            // Old format doesn't have color, so Number(r.color || 0) will correctly default to 0
            shape.color = Number(r.color || 0);
            shape.d = true;
            return shape;
        });
        // Add bodies in batches of 100
        // ... (rest of function is unchanged) ...
        for (let i = 0; i < Math.ceil(map.physics.shapes.length / 100); i++) {
            let body = w.bonkHost.bigClass.getNewBody();
            body.p = [-935, -350];
            body.fx = Array.from(
                { length: Math.min(100, map.physics.shapes.length - i * 100) },
                (_, j) => i * 100 + j
            );
            map.physics.bodies.unshift(body);
        }

        // Create fixtures from shapes
        map.physics.fixtures = allShapes.map((r, i) => {
            let fixture = w.bonkHost.bigClass.getNewFixture();
            fixture.sh = i;
            fixture.d = r.isDeath;
            fixture.re = r.isBouncy ? null : -1;
            fixture.fr
                = r.friction;
            fixture.np = r.noPhysics;
            fixture.ng = r.noGrapple;
            // Old format doesn't have color, so Number(r.color || 0) will correctly default to 0
            fixture.f = Number(r.color || 0);

            if (r.isCapzone) {
                fixture.n = r.id + '. CZ';
            } else if (r.isNoJump) {

                fixture.n = r.id + '. NoJump';
            } else if (r.noPhysics) {
                fixture.n = r.id + '. NoPhysics';
            } else {
                fixture.n = r.id + '. Shape';
            }


            return fixture;
        });

        map.physics.bro = map.physics.bodies.map((_, i) => i);

        // Capzones
        allShapes.forEach(line => {
            if (line.isCapzone) {
                map.capZones.push({
                    n: line.id + '. Cap Zone',
                    ty: 1,
                    l: 0.01,
                    i: line.id,
                });
            }

            if (line.isNoJump) {
                map.capZones.push({
                    n: line.id + '. NoJump',
                    ty: 2,
                    l: 10,
                    i: line.id,
                });
            }
        });

        map.spawns = [{
            b: true,
            f: true,
            gr: false,
            n: 'Spawn',
            priority: 5,
            r: true,
            x: spawnX,
            xv: 0,
            y: spawnY,
            ye: false,
            yv: 0,
        }];

        map.s.nc = true;
        map.s.re = true;
        map.physics.ppm = mapSize;

        gs.map = map;
        w.bonkHost.menuFunctions.setGameSettings(gs);
        w.bonkHost.menuFunctions.updateGameSettings();

        Utils.showNotification('Map created successfully!');
    } catch (e) {
        console.error('An error occurred while creating the map:', e);
        // showNotification("Failed to create the map. Check the console for errors.");
    }
}

('use strict');

function transformMapSize(mapSize) {
    const mapSizeMapping = {
        1: 30,
        2: 24,
        3: 20,
        4: 17,
        5: 15,
        6: 13,
        7: 12,
        8: 10,
        9: 9,
        10: 8,
        11: 7,
        12: 6,
        13: 5
    };

    return mapSizeMapping[Math.floor(mapSize)] || 9; // Default to 9 if no match
}

function getProcessedMapSize(inputData) {
    if (!inputData.version) {
        // No version present, return mapSize as is
        return inputData.mapSize !== undefined ? inputData.mapSize : 9;
    }

    // If version exists, transform the mapSize
    return transformMapSize(inputData.mapSize);
}

function convertGameDataToJSON() {
    // Get the game settings’ map from the bonkHost.
    const w = parent.frames[0];
    if (!w || !w.bonkHost || !w.bonkHost.toolFunctions) {
        console.error("Game environment not found.");
        return;
    }
    const gameMap = w.bonkHost.toolFunctions.getGameSettings().map;
    const shapes = gameMap.physics.shapes;
    const fixtures = gameMap.physics.fixtures;
    const capZones = gameMap.capZones || [];

    // Store raw objects by original fixture index first
    const rawObjects = [];

    const xOffsetForPkrGenrator = 935;
    const yOffsetForPkrGenrator = 350;

    // Create a map of capZones for quick lookup
    const capZoneMap = new Map();
    capZones.forEach(zone => {
        // ty: 1 is capzone, ty: 2 is nojump
        const zoneType = zone.ty === 1 ? 'capzone' : (zone.ty === 2 ? 'nojump' : 'unknown');
        capZoneMap.set(zone.i, zoneType);
    });

    // Create a map to find the body's position for each fixture
    const bodyMap = new Map();
    gameMap.physics.bodies.forEach(body => {
        if (body.fx) {
            body.fx.forEach(fixtureIndex => {
                bodyMap.set(fixtureIndex, body.p); // Store body's position [x, y]
            });
        }
    });

    // Create a map to find the body a fixture belongs to and store its bounciness
    const bodyBouncinessMap = new Map();
    gameMap.physics.bodies.forEach(body => {
        body.fx.forEach(fixtureIndex => {
            bodyBouncinessMap.set(fixtureIndex, body.s.re);
        });
    });

    // Loop through each fixture to process its corresponding shape (ORIGINAL LOGIC)
    for (let i = 0; i < fixtures.length; i++) {
        const fixture = fixtures[i];
        const shape = shapes[fixture.sh];

        if (!shape) {
            rawObjects.push(null); // Keep array length/indices aligned
            continue;
        }

        const bodyPos = bodyMap.get(i) || [0, 0];
        const id = i; // Will be updated later during sorting

        // Get the body's bounciness or default to 0 if not found
        const bodyBounciness = bodyBouncinessMap.get(i) ?? 0;
        let isBouncy = false;

        // Determine isBouncy based on body and fixture bounciness
        if (bodyBounciness > -0.95) {
            if (fixture.re === null || fixture.re === undefined) {
                isBouncy = true;
            } else {
                isBouncy = fixture.re > -0.95;
            }
        } else {
            if (fixture.re === null || fixture.re === undefined) {
                isBouncy = false;
            } else {
                isBouncy = fixture.re > -0.95;
            }
        }

        const isDeath = !!fixture.d;

        if (isDeath) {
            isBouncy = false;
        }

        const bounciness = isBouncy ? null : -1;

        // Common properties derived from the fixture
        const isCapzone = capZoneMap.get(i) === 'capzone';
        const isNoJump = capZoneMap.get(i) === 'nojump';
        const noPhysics = !!fixture.np;
        const noGrapple = !!fixture.ng;

        if (isCapzone) {
            isBouncy = false;
        }

        // Base object with properties shared by all shapes
        const baseObject = {
            id: id,
            color: fixture.f || 16777215,
            x: shape.c[0] + bodyPos[0] + xOffsetForPkrGenrator,
            y: shape.c[1] + bodyPos[1] + yOffsetForPkrGenrator,
            angle: shape.a * (180 / Math.PI), // Convert radians to degrees
            isBouncy: isBouncy,
            isDeath: isDeath,
            isCapzone: isCapzone,
            isNoJump: isNoJump,
            noPhysics: noPhysics,
            noGrapple: noGrapple,
            isBgLine: noPhysics,
        };

        let finalObject = null;

        // Handle polygons
        if (shape.type === 'po') {
            finalObject = {
                ...baseObject,
                type: "poly",
                scale: shape.s || 1,
                vertices: (shape.v || []).map(v => ({ x: v[0], y: v[1] })),
            };
        }
        // Handle boxes (rectangles)
        else if (shape.type === 'bx') {
            finalObject = {
                ...baseObject,
                type: "line",
                width: shape.w,
                height: shape.h,
                bounciness: isBouncy ? null : -1,
            };
        }
        // Handle circles
        else if (shape.type === 'ci') {
            finalObject = {
                ...baseObject,
                type: "circle",
                radius: shape.r,
            };
        }

        rawObjects.push(finalObject);
    }

    // --- SORTING AND ID RE-ASSIGNMENT LOGIC ---
    const exportedObjects = [];
    let newIdCounter = 0;

    // Get the visual body render order (bro)
    const bro = gameMap.physics.bro || gameMap.physics.bodies.map((_, idx) => idx);

    // Iterate through platforms in REVERSE render order to fix top/bottom layering
    [...bro].reverse().forEach(bodyIndex => {
        const body = gameMap.physics.bodies[bodyIndex];
        if (!body || !body.fx) return;

        // Iterate through shapes on that platform
        body.fx.forEach(fixtureIndex => {
            const obj = rawObjects[fixtureIndex];
            if (obj) {
                // UPDATE ID to match the new array position! (Fixes Capzones)
                obj.id = newIdCounter++;
                exportedObjects.push(obj);
            }
        });
    });

    // Handle spawn point
    const spawn = (gameMap.spawns && gameMap.spawns.length > 0)
    ? { spawnX: gameMap.spawns[0].x, spawnY: gameMap.spawns[0].y }
    : { spawnX: 0, spawnY: 0 };

    // Handle map size
    const mapSize = transformMapSizeFromGameData(gameMap.physics.ppm) || 9;

    // Build the final JSON output
    const outputJSON = {
        version: 1,
        spawn: spawn,
        mapSize: mapSize,
        objects: exportedObjects
    };

    const jsonString = JSON.stringify(outputJSON, null, 2);

    // Copy to clipboard
    navigator.clipboard.writeText(jsonString).then(() => {
        console.log('JSON copied to clipboard successfully!');
    }).catch(err => {
        console.error('Failed to copy JSON to clipboard:', err);
    });

    return outputJSON;
}

function transformMapSizeFromGameData(mapSize) {
    const mapSizeMapping = {
        1: 30,
        2: 25,
        3: 20,
        4: 17,
        5: 15,
        6: 13,
        7: 12,
        8: 10,
        9: 9,
        10: 8,
        11: 7,
        12: 6,
        13: 5
    };

    // Reverse the mapping: 1 -> 30 becomes 30 -> 1
    const reversedMap = Object.fromEntries(
        Object.entries(mapSizeMapping).map(([key, value]) => [value, parseInt(key)]));

    // Look up the new map size from the reversed map
    return reversedMap[mapSize] || 9; // Default to 9 if no match
}

function decimalToRgb(decimal) {
    if (typeof decimal !== 'number' || !isFinite(decimal)) return "rgb(255, 255, 255)"; // Default white for invalid input
    decimal = Math.max(0, Math.min(16777215, Math.floor(decimal))); // Clamp to valid 24-bit range
    const r = (decimal >> 16) & 0xff;
    const g = (decimal >> 8) & 0xff;
    const b = decimal & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
}

let injector = str => {
    let newStr = str;

    ///////////////////
    // From host mod //
    ///////////////////

    const BIGVAR = newStr.match(/[A-Za-z0-9$_]+\[[0-9]{6}\]/)[0].split('[')[0];
    let stateCreationString = newStr.match(
        /[A-Za-z]\[...(\[[0-9]{1,4}\]){2}\]\(\[\{/)[0];
    let stateCreationStringIndex = stateCreationString.match(/[0-9]{1,4}/g);
    stateCreationStringIndex =
        stateCreationStringIndex[stateCreationStringIndex.length - 1];
    let stateCreation = newStr.match(
`[A-Za-z0-9\$_]{3}\[[0-9]{1,3}\]=[A-Za-z0-9\$_]{3}\\[[0-9]{1,4}\\]\\[[A-Za-z0-9\$_]{3}\\[[0-9]{1,4}\\]\\[${stateCreationStringIndex}\\]\\].+?(?=;);`)[0];
    stateCreationString = stateCreation.split(']')[0] + ']';

    const SET_STATE = `
        if (
            ${BIGVAR}.bonkHost.state &&
            !window.bonkHost.keepState &&
            window.parkourGenerator.keepPositions &&
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
            window.parkourGenerator.keepPositions = false;
        };
        `;

    const stateSetRegex = newStr.match(
        /\* 999\),[A-Za-z0-9\$_]{3}\[[0-9]{1,3}\],null,[A-Za-z0-9\$_]{3}\[[0-9]{1,3}\],true\);/)[0];
    newStr = newStr.replace(stateSetRegex, stateSetRegex + SET_STATE);
    return newStr;
};

if (!window.bonkCodeInjectors)
    window.bonkCodeInjectors = [];
window.bonkCodeInjectors.push(bonkCode => {
    try {
        return injector(bonkCode);
    } catch (error) {
        alert('Code injection for parkour generator failed');
        throw error;
    }
});

// Initialization logic to set up the UI once the document is ready
const init = () => {
    addPkrDiv();
    let playerSelector = document.getElementById("posRecorder_player_selector");
    if (playerSelector) {
        playerSelector.addEventListener("change", posRecorder.select_player);
    } else {
        console.error("posRecorder_player_selector element not found!");
    }
};

if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
} else {
    document.addEventListener("DOMContentLoaded", init);
}
