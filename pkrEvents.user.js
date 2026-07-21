	// ==UserScript==
	// @name         pkrEvents
	// @version      1.4.2
	// @description  Bouldering-style parkour competition judge tool for Bonk.io
	// @author       eldertubby
	// @match        https://bonk.io/gameframe-release.html
	// @match        https://bonkisback.io/gameframe-release.html
	// @run-at       document-end
	// @updateURL	 https://github.com/elder-tubby/bonkio-public-notes/raw/refs/heads/main/pkrEvents.user.js
	// @downloadURL  https://github.com/elder-tubby/bonkio-public-notes/raw/refs/heads/main/pkrEvents.user.js
	// @grant        none
	// ==/UserScript==

	"use strict";

	window.pkrEventScores = {
		windowId: "pkr_scores_window",
		state: {
			modActive: false,
			chatAlerts: false,
			autoLogDeaths: false,
			autoRemoveTimeUp: false,
			currentMap: 1,
			highestMap: 1,
			maxMaps: 100,
			allPlayers: new Set(),
			mapData: {}, // mapId -> { started: bool, timeLeft: int, timerInterval: null, players: { name -> stats } }
			timerDuration: 240, // 4 minutes
			initialPos: {},
			latestInputState: null,
			currentFrame: 0,
			currentCapZones: []
		}
	};

	pkrEventScores.rules = {
		event: [
			"This parkour competition style is inspired by the bouldering sports. It works like this:",
			"There will be a series of unseen maps that the participants have not played before. Players will have 4 minutes to play each map.",
			"Reaching the cap zone is reffered to as a <b>'Top'</b>.",
			"Each map also has a circular mid-point indicator. Reaching it secures a <b>'Zone'</b>.",
			"Your final score tracks your Tops, Zones, and how many attempts you took to reach them.",
			"<b style='color:#4fc3f7'>Score Breakdown Example:</b> <span style='font-family: monospace; font-size: 18px; color: #4caf50;'>8T 10z 14 17</span>",
			"<b>8T</b>: 8 Tops (the player finished 8 maps).",
			"<b>10z</b>: 10 Zones (they reached the midway point on 10 maps).",
			"<b>14</b>: Attempts to Top (it took 14 total tries to get those 8 Tops).",
			"<b>17</b>: Attempts to Zone (it took 17 total tries to get those 10 Zones).",
			"<i style='color: #aaa;'>Winners are decided by: Most Tops > Most Zones > Fewest Top Attempts > Fewest Zone Attempts.</i>"
		],
		mapmaking: [
			"Each map should feature a designated zone. It is recommended to use non-physics shapes to visually indicate its location.",
			"The mod automatically recognizes when a player reaches a zone if you place a Cap Zone shape directly over it.",
			"<b>Crucial Naming Requirement:</b> Both the zone shape and the real final cap zone shape MUST have names starting with <b>'cp'</b> (e.g., <code>cp_zone</code> and <code>cp_real</code>). This prevents the <i>lbReplay</i> mod from prematurely generating a replay file when a player touches the zone.",
			"<b>Winning Time:</b> Ensure the map's winning time is set to <b>999</b>.",
			"<b>Spawn Safety:</b> To prevent false auto-death logging from accidental deaths immediately after spawn, deaths do not count for the first <b>2 seconds</b> after spawning.",
			"<b>Examples:</b> For actual examples of properly configured event maps, please search for recent maps by <b>'eldertubby'</b>, such as the map <i>'World Climbing design'</i>."
		]
	};

	pkrEventScores.init = function() {
		if (!window.bonkHUD || !window.bonkAPI) {
			console.error("pkrEvents: BonkLIB (API/HUD) not found.");
			return;
		}

		this.ensureMapData(this.state.currentMap);
		this.createWindow();
		this.setupListeners();

		console.log("pkrEvents initialized.");
	};

	// --- CORE UTILITIES ---

	pkrEventScores.killPlayer = function(playerID) {
		if (!window.bonkAPI || !window.bonkAPI.bonkWSS) return;

		// You must be the host to utilize this kill packet
		if (window.bonkAPI.myID !== window.bonkAPI.hostID) {
			console.error("pkrEvents: You must be the room host to instantly kill players.");
			return;
		}

		try {
			// Use the frame currently tracked by pkrEvents' stepEvent listener
			let currentFrame = this.state.currentFrame;

			// 1. Send Packet 25 to the server to register the kill as the host
			let sendPacket = '42[25,{"a":{"playersLeft":[' + playerID + '],"playersJoined":[]},"f":' + currentFrame + '}]';
			window.bonkAPI.originalSend.call(window.bonkAPI.bonkWSS, sendPacket);

			// 2. Mock receiving Packet 31 to visually kill the player on your own screen
			let receivePacket = '42[31,{"a":{"playersLeft":[' + playerID + '],"playersJoined":[]},"f":' + currentFrame + '}]';
			if (window.bonkAPI.bonkWSS.onmessage) {
				window.bonkAPI.bonkWSS.onmessage({ data: receivePacket });
			}

		} catch(e) {
			console.error("pkrEvents: Error executing kill", e);
		}
	};

	pkrEventScores.sendChatAlert = function(playerName, type, attempt) {
		if (!this.state.chatAlerts || !window.bonkAPI) return;
		let msg = type === "zone"
			? `${playerName} reached the zone on attempt ${attempt}`
			: `${playerName} reached the capzone on attempt ${attempt}`;
		window.bonkAPI.chat(msg);
	};

	// --- DATA MANAGEMENT ---

	pkrEventScores.ensureMapData = function(mapIndex) {
		if (!this.state.mapData[mapIndex]) {
			this.state.mapData[mapIndex] = {
				started: false,
				timeLeft: this.state.timerDuration,
				timerInterval: null,
				players: {}
			};
		}
	};

	pkrEventScores.initializeMapPlayers = function() {
		const map = this.state.mapData[this.state.currentMap];
		map.started = true;
		map.timeLeft = this.state.timerDuration;
		const lobby = bonkAPI.getPlayerLobbyList();
		lobby.forEach(p => {
			if (p && p.userName) {
				this.state.allPlayers.add(p.userName);
				if (!map.players[p.userName]) {
					map.players[p.userName] = {
						top: false,
						zone: false,
						att_t: 0,
						att_z: 0,
						current_att: 1,
						eliminated: false,
						lastSpawnTime: Date.now() + 5000,
						confirmedDeaths: 0, // Robust lag-proofing state tracker
						deathTimer: 0
					};
				}
			}
		});
	};

	pkrEventScores.eliminatePlayersAtSpawn = function() {
		const map = this.state.mapData[this.state.currentMap];
		if (!map || !this.state.latestInputState) return;

		const discs = this.state.latestInputState.discs;

		for (const [name, pData] of Object.entries(map.players)) {
			if (pData.top || pData.eliminated) continue;

			const playerID = window.bonkAPI.getPlayerIDByName(name);
			if (playerID === -1) continue;

			const initPos = this.state.initialPos[playerID];
			const disc = discs[playerID];

			let shouldEliminate = false;

			if (!disc) {
				shouldEliminate = true;
			} else if (initPos) {
				const dx = initPos.x - disc.x;
				const dy = initPos.y - disc.y;
				const distSq = (dx * dx) + (dy * dy);
				if (distSq < 1.0) {
					shouldEliminate = true;
				}
			}

			if (shouldEliminate) {
				pData.eliminated = true;
				this.killPlayer(playerID);
			}
		}
	};

	// --- UI CREATION ---


	pkrEventScores.createWindow = function() {
		const container = document.createElement("div");
		container.id = "pkr_scores_container";
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.height = "100%";
		container.style.padding = "5px 30px";
		container.style.fontFamily = "futurept_b1";
		container.className = "bonkhud-text-color";

		// --- Top Controls (Mod Toggle & Copy) ---
		const topControls = document.createElement("div");
		topControls.style.cssText = "display: flex; flex-direction: column; gap: 5px; padding: 15px 10px 8px 10px;";

		const btnRow = document.createElement("div");
		btnRow.style.display = "flex";
		btnRow.style.gap = "5px";

		const modBtn = bonkHUD.generateButton("Mod: OFF");
		modBtn.id = "pkr_toggle_mod";
		modBtn.style.flex = "1";
		modBtn.style.fontSize = "13px";
		modBtn.style.padding = "5px";
		modBtn.onclick = () => this.toggleMod();

		const copyBtn = bonkHUD.generateButton("Copy Scores");
		copyBtn.id = "pkr_copy_scores";
		copyBtn.style.flex = "1";
		copyBtn.style.fontSize = "13px";
		copyBtn.style.padding = "5px";
		copyBtn.onclick = () => this.copyScoresToClipboard();

		const rulesBtn = bonkHUD.generateButton("ℹ Info");
		rulesBtn.style.flex = "0.5";
		rulesBtn.style.fontSize = "13px";
		rulesBtn.style.padding = "5px";
		rulesBtn.style.backgroundColor = "#0277bd";
		rulesBtn.onclick = () => this.showRulesOverlay();

		btnRow.appendChild(modBtn);
		btnRow.appendChild(copyBtn);
		btnRow.appendChild(rulesBtn);
		topControls.appendChild(btnRow);
		container.appendChild(topControls);

		// --- Map and Timer Controls (Grid Layout Fix) ---
		const midControls = document.createElement("div");
		midControls.className = "bonkhud-background-color";
		midControls.style.padding = "8px";
		midControls.style.borderRadius = "4px";
		midControls.style.marginBottom = "8px";
		midControls.style.display = "flex";
		midControls.style.flexDirection = "column";
		midControls.style.gap = "8px";
		midControls.style.border = "1px solid rgba(255, 255, 255, 0.2)";

		// Use Flexbox to stack Map Nav above Toggles
    midControls.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; gap: 5px; margin-bottom: 8px;">
            <div id="pkr_map_prev" style="cursor:pointer; font-size: 16px; font-weight:bold; padding: 0 5px;">&lt;</div>
            <div id="pkr_map_full_text" class="bonkhud-text-color" style="font-weight: bold; font-size: 13px; text-align: center; min-width: 50px;">
                Map <span id="pkr_map_label">1</span>
            </div>
            <div id="pkr_map_next" style="cursor:pointer; font-size: 16px; font-weight:bold; padding: 0 5px;">&gt;</div>
        </div>

        <div style="display: flex; flex-direction: column; align-items: left; gap: 4px; width: 100%;">
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" id="pkr_chat_alerts" style="cursor:pointer; margin: 0;" />
                <label for="pkr_chat_alerts" style="font-size: 10px; cursor:pointer; white-space: nowrap;">Chat Alerts</label>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" id="pkr_auto_death" style="cursor:pointer; margin: 0;" />
                <label for="pkr_auto_death" style="font-size: 10px; cursor:pointer; white-space: nowrap;">Log Deaths (Buggy)</label>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="checkbox" id="pkr_auto_remove" style="cursor:pointer; margin: 0;" />
                <label for="pkr_auto_remove" style="font-size: 10px; cursor:pointer; white-space: nowrap;">Kill on Time Up (Buggy)</label>
            </div>
        </div>

        <div style="display: flex; justify-content: center; align-items: center; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 8px;">
				<div style="display: flex; align-items: left; gap: 10px;">
					<div id="pkr_timer_display" class="bonkhud-text-color" style="font-size: 16px; font-weight: bold; width: 50px; text-align: center; font-family: monospace;">04:00</div>
					<div id="pkr_timer_btns" style="display: flex; gap: 8px;"></div>
				</div>
			</div>
		`;
		container.appendChild(midControls);

		// Re-attach listeners for the new elements
		midControls.querySelector("#pkr_chat_alerts").onchange = (e) => this.state.chatAlerts = e.target.checked;
		midControls.querySelector("#pkr_auto_death").onchange = (e) => this.state.autoLogDeaths = e.target.checked;
		midControls.querySelector("#pkr_auto_remove").onchange = (e) => this.state.autoRemoveTimeUp = e.target.checked;
		midControls.querySelector("#pkr_map_prev").onclick = () => this.changeMap(-1);
		midControls.querySelector("#pkr_map_next").onclick = () => this.changeMap(1);

		// --- Score Table ---
		const tableWrapper = document.createElement("div");
		tableWrapper.className = "bonkhud-scrollbar-kit bonkhud-scrollbar-other";
		tableWrapper.style.flexGrow = "1";
		tableWrapper.style.overflowY = "auto";
		tableWrapper.style.overflowX = "hidden";
		tableWrapper.innerHTML = `
			<table style="width: 100%; border-collapse: collapse; table-layout: fixed;" class="bonkhud-text-color">
				<thead>
					<tr style="border-bottom: 2px solid #555; height: 20px;">
						<th style="text-align: left; padding-left: 2px; font-size: 11px; width: 35%;">Player</th>
						<th style="text-align: center; font-size: 10px; width: 25%;">Attempt</th>
						<th style="text-align: center; font-size: 10px; width: 15%;">Zone</th>
						<th style="text-align: center; font-size: 10px; width: 15%;">Top</th>
						<th style="text-align: center; font-size: 10px; width: 10%;">↺</th>
					</tr>
				</thead>
				<tbody id="pkr_score_body"></tbody>
			</table>
		`;
		container.appendChild(tableWrapper);

		// --- Bottom Controls ---
		const bottomControls = document.createElement("div");
		bottomControls.id = "pkr_score_controls";
		bottomControls.style.marginTop = "5px";
		bottomControls.style.display = "flex";
		bottomControls.style.flexDirection = "column";
		bottomControls.style.gap = "5px";

		const elimBtn = bonkHUD.generateButton("Remove Players...");
		elimBtn.style.backgroundColor = "#ff8c00";
		elimBtn.onclick = () => this.showKillOverlay();

		const reportBtn = bonkHUD.generateButton("View Leaderboard");
		reportBtn.style.backgroundColor = "#005500";
		reportBtn.onclick = () => this.showReportOverlay();

		const resetBtn = bonkHUD.generateButton("Wipe All Data");
		resetBtn.style.backgroundColor = "#8b0000";
		resetBtn.onclick = () => {
			if (window.confirm("WARNING: This wipes ALL map scores and player data. Continue?")) {
				this.stopCurrentTimer();
				this.state.currentMap = 1;
				this.state.highestMap = 1;
				this.state.mapData = {};
				this.state.allPlayers.clear();
				this.state.initialPos = {};
				this.state.latestInputState = null;
				this.state.currentFrame = 0;
				this.state.currentCapZones = [];
				this.ensureMapData(1);
				this.renderAll();
			}
		};

		bottomControls.appendChild(elimBtn);
		bottomControls.appendChild(reportBtn);
		bottomControls.appendChild(resetBtn);
		container.appendChild(bottomControls);

		const modIndex = bonkHUD.createMod("pkrEvents", {
			windowId: this.windowId,
			windowContent: container,
			bonkLIBVersion: "1.1.3"
		});

		const timerBtns = midControls.querySelector("#pkr_timer_btns");
		const startBtn = bonkHUD.generateButton("Start");
		startBtn.id = "pkr_timer_toggle";
		startBtn.style.padding = "2px 16px";
		startBtn.style.fontSize = "13px";
		startBtn.onclick = () => this.toggleTimer();

		const resetTimerBtn = bonkHUD.generateButton("Reset");
		resetTimerBtn.id = "pkr_timer_reset";
		resetTimerBtn.style.padding = "2px 16px";
		resetTimerBtn.style.fontSize = "13px";
		resetTimerBtn.onclick = () => this.resetTimer();

		timerBtns.appendChild(startBtn);
		timerBtns.appendChild(resetTimerBtn);

		if (modIndex !== -1) {
			bonkHUD.loadUISetting(modIndex);
		}
		this.renderAll();
	};

	pkrEventScores.toggleMod = function() {
		this.state.modActive = !this.state.modActive;
		const btn = document.getElementById("pkr_toggle_mod");
		if (this.state.modActive) {
			btn.textContent = "Mod: ON";
			btn.style.backgroundColor = "#2e7d32";
		} else {
			btn.textContent = "Mod: OFF";
			btn.style.backgroundColor = "#3d3d3d";
			this.stopCurrentTimer();
			this.updateTimerDisplay();
		}
	};

	pkrEventScores.copyScoresToClipboard = function() {
		const { results, sorted } = this.calculateLeaderboard();
		const scoreStrings = sorted.map((p, index) => {
			const r = results[p];
			return `${index + 1}. ${p}: ${r.tops}T${r.zones}z (${r.att_t}/${r.att_z})`;
		});

		const finalString = scoreStrings.length > 0 ? scoreStrings.join(" | ") : "No scores recorded yet.";

		navigator.clipboard.writeText(finalString).then(() => {
			const btn = document.getElementById("pkr_copy_scores");
			const originalText = btn.textContent;
			btn.textContent = "Copied!";
			btn.style.backgroundColor = "#1565c0";
			setTimeout(() => {
				if (btn) {
					btn.textContent = originalText;
					btn.style.backgroundColor = "#455a64";
				}
			}, 1500);
		}).catch(err => {
			console.error("Failed to copy scores: ", err);
		});
	};

	// --- RENDERERS ---

	pkrEventScores.renderAll = function() {
		this.renderMapControls();
		this.updateTimerDisplay();
		this.renderTable();
	};

	pkrEventScores.renderMapControls = function() {
		const label = document.getElementById("pkr_map_label");
		if (label) label.textContent = this.state.currentMap;
	};

	pkrEventScores.renderTable = function() {
		const tbody = document.getElementById("pkr_score_body");
		if (!tbody) return;
		tbody.innerHTML = "";

		const map = this.state.mapData[this.state.currentMap];

		if (!map || !map.started) {
			tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 15px; font-size: 11px; color: #888;">Map not started.<br>Will populate when game begins.</td></tr>`;
			return;
		}

		Object.entries(map.players).forEach(([name, pData]) => {
			const row = document.createElement("tr");
			row.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
			row.style.height = "30px";

			const isLocked = pData.top || pData.eliminated;
			const opacity = isLocked ? "0.5" : "1.0";

			const attBtnStyle = "cursor:pointer; border:1px solid #555; background:#333; color:white; border-radius:2px; padding:0 3px; font-size: 10px; height: 18px; line-height: 16px;";
			const stateBtnStyle = "cursor:pointer; font-weight:bold; font-size: 9px; width:18px; height:18px; border:none; border-radius:2px; color: white;";

			row.innerHTML = `
				<td style="padding-left: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; opacity: ${opacity}; color: ${pData.eliminated ? '#ff4444' : (pData.top ? '#4caf50' : 'inherit')};">${name}</td>
				<td style="opacity: ${opacity};">
					<div style="display: flex; align-items: center; justify-content: center; gap: 4px; height: 100%;">
						<button class="pkr-att-sub" style="${attBtnStyle}" ${isLocked ? 'disabled' : ''}>-</button>
						<span style="font-size: 11px; font-weight: bold; width: 14px; text-align: center;">${pData.current_att}</span>
						<button class="pkr-att-add" style="${attBtnStyle}" ${isLocked ? 'disabled' : ''}>+</button>
					</div>
				</td>
				<td style="text-align: center;">
					<div style="display: flex; align-items: center; justify-content: center; height: 100%;">
						<button class="pkr-zone-btn" style="${stateBtnStyle} background: ${pData.zone ? '#2196f3' : '#444'};" ${(isLocked || pData.zone) ? 'disabled' : ''}>Z</button>
					</div>
				</td>
				<td style="text-align: center;">
					<div style="display: flex; align-items: center; justify-content: center; height: 100%;">
						<button class="pkr-top-btn" style="${stateBtnStyle} background: ${pData.top ? '#4caf50' : '#444'};" ${isLocked ? 'disabled' : ''}>T</button>
					</div>
				</td>
				<td style="text-align: center;">
					<div style="display: flex; align-items: center; justify-content: center; height: 100%;">
						<button class="pkr-reset-btn" style="cursor:pointer; background:none; border:none; color:#ff4444; font-size:12px;">↺</button>
					</div>
				</td>
			`;

			row.querySelector(".pkr-att-add").onclick = () => { pData.current_att++; this.renderTable(); };
			row.querySelector(".pkr-att-sub").onclick = () => { if (pData.current_att > 1) pData.current_att--; this.renderTable(); };

			row.querySelector(".pkr-zone-btn").onclick = () => {
				pData.zone = true;
				pData.att_z = pData.current_att;
				this.sendChatAlert(name, "zone", pData.att_z);
				this.renderTable();
			};

			row.querySelector(".pkr-top-btn").onclick = () => {
				pData.top = true;
				pData.att_t = pData.current_att;
				this.sendChatAlert(name, "top", pData.att_t);
				if (!pData.zone) {
					pData.zone = true;
					pData.att_z = pData.current_att;
				}
				this.renderTable();
			};

			row.querySelector(".pkr-reset-btn").onclick = () => {
				if (confirm(`Reset ${name}'s score for Map ${this.state.currentMap}?`)) {
					pData.top = false;
					pData.zone = false;
					pData.att_t = 0;
					pData.att_z = 0;
					pData.current_att = 1;
					pData.eliminated = false;
					pData.lastSpawnTime = Date.now();
					// Notice we do NOT wipe confirmedDeaths here. By keeping it, we avoid re-triggering previous lag deaths!
					this.renderTable();
				}
			};

			tbody.appendChild(row);
		});
	};

	// --- TIMER LOGIC ---

	pkrEventScores.updateTimerDisplay = function() {
		const display = document.getElementById("pkr_timer_display");
		const toggle = document.getElementById("pkr_timer_toggle");
		if (!display || !toggle) return;

		const map = this.state.mapData[this.state.currentMap];
		if (!map || !map.started) {
			display.textContent = "04:00";
			display.style.color = "#888";
			toggle.textContent = "Start";
			return;
		}

		const mins = Math.floor(map.timeLeft / 60).toString().padStart(2, '0');
		const secs = (map.timeLeft % 60).toString().padStart(2, '0');
		display.textContent = `${mins}:${secs}`;
		display.style.color = map.timeLeft <= 10 ? "#ff4444" : "#00e676";
		toggle.textContent = map.timerInterval ? "Pause" : "Start";
	};

	pkrEventScores.toggleTimer = function() {
		if (!this.state.modActive) {
			alert("Please toggle the mod ON first!");
			return;
		}

		const map = this.state.mapData[this.state.currentMap];
		if (!map || !map.started) return;

		if (map.timerInterval) {
			clearInterval(map.timerInterval);
			map.timerInterval = null;
		} else if (map.timeLeft > 0) {
			map.timerInterval = setInterval(() => {
				if (map.timeLeft > 0) {
					map.timeLeft--;
					this.updateTimerDisplay();

					// --- Chat Countdown Alerts ---
					if (this.state.chatAlerts) {
						if (map.timeLeft === 30 || map.timeLeft === 10) {
							window.bonkAPI.chat(map.timeLeft + " sec left");
						} else if (map.timeLeft <= 3 && map.timeLeft > 0) {
							window.bonkAPI.chat(map.timeLeft.toString());
						}
					}

					if (map.timeLeft === 0) {
						clearInterval(map.timerInterval);
						map.timerInterval = null;
						if (this.state.autoRemoveTimeUp) {
							this.eliminatePlayersAtSpawn();
						}
						this.showKillOverlay();
						this.renderTable();
					}
				}
			}, 1000);
		}
		this.updateTimerDisplay();
	};

	pkrEventScores.resetTimer = function() {
		const map = this.state.mapData[this.state.currentMap];
		if (!map) return;
		this.stopCurrentTimer();
		map.timeLeft = this.state.timerDuration;
		this.updateTimerDisplay();
		this.renderTable();
	};

	pkrEventScores.stopCurrentTimer = function() {
		const map = this.state.mapData[this.state.currentMap];
		if (map && map.timerInterval) {
			clearInterval(map.timerInterval);
			map.timerInterval = null;
		}
	};

	pkrEventScores.changeMap = function(dir) {
		this.stopCurrentTimer();
		let newMap = Math.min(Math.max(this.state.currentMap + dir, 1), this.state.maxMaps);
		this.state.currentMap = newMap;
		if (newMap > this.state.highestMap) this.state.highestMap = newMap;

		this.ensureMapData(this.state.currentMap);
		this.renderAll();
	};

	// --- EVENT LISTENERS ---

	pkrEventScores.setupListeners = function() {
		bonkAPI.addEventListener("gameStart", (e) => {
			if (!this.state.modActive) return;

			// Cache map layers for CapZone name detection
			this.state.currentCapZones = e.mapData ? e.mapData.capZones : [];
			this.state.currentPhysics = e.mapData ? e.mapData.physics : null;

			this.state.initialPos = {};
			this.state.latestInputState = null;
			this.state.currentFrame = 0;

			// Lag-proof trackers
			this.state.previousDeathCount = 0;
			this.state.pendingDeaths = [];

			this.ensureMapData(this.state.currentMap);
			this.stopCurrentTimer();
			this.initializeMapPlayers();
			this.renderAll();
			this.toggleTimer();
		});

		// --- Robust Game End Hook ---
		const originalGameEnd = window.bonkAPI.receive_GameEnd;
		window.bonkAPI.receive_GameEnd = (args) => {
			if (this.state.modActive) {
				this.stopCurrentTimer();
				this.updateTimerDisplay();
				console.log("[pkrEvents] Game end detected via API override.");
			}
			return originalGameEnd ? originalGameEnd.apply(window.bonkAPI, [args]) : args;
		};

		bonkAPI.addEventListener("stepEvent", (data) => {
			if (!this.state.modActive) return;

			let gs = data.gameState;
			let is = data.inputState;
			this.state.currentFrame = data.currentFrame;

			this.state.latestInputState = is;
			if (is && is.discs) {
				for (let i = 0; i < is.discs.length; i++) {
					if (is.discs[i] && !this.state.initialPos[i]) {
						this.state.initialPos[i] = { x: is.discs[i].x, y: is.discs[i].y };
					}
				}
			}

			let map = this.state.mapData[this.state.currentMap];
			if (!map || !map.started) return;

		   // --- LAG PROOF DEATH SYSTEM (Inspired by LBUtil) ---
			let needsRender = false;
			let timeOut = map.timeLeft <= 0;

			if (gs && gs.discDeaths) {
				gs.discDeaths.forEach(death => {
					// If f === 0, the engine confirmed they died *exactly* this frame
					if (death.f === 0) {
						let playerID = death.i !== undefined ? death.i : -1;
						let playerName = window.bonkAPI.getPlayerNameByID(playerID);

						if (playerName && map && map.started) {
							let pData = map.players[playerName];
							if (pData && !pData.top && !pData.eliminated) {
								if (timeOut) {
									// Time is up and they just died naturally. Eliminate them!
									if (this.state.autoRemoveTimeUp) {
										pData.eliminated = true;
										setTimeout(() => this.killPlayer(playerID), 100);
										needsRender = true;
									}
								} else if (this.state.autoLogDeaths) {
									// Normal death during the timer
									let now = Date.now();
									// Cooldown protects against any weird multi-triggers
									if (data.currentFrame > 90 && now - pData.lastSpawnTime >= 2000) {
										pData.current_att++;
										needsRender = true;
									}
									pData.lastSpawnTime = now;
								}
							}
						}
					}
				});
			}

			// Note: Instant elimination for players AT SPAWN when the timer hits zero
			// is already handled perfectly by 'this.eliminatePlayersAtSpawn()' inside toggleTimer().

			if (needsRender) this.renderTable();
		});


		bonkAPI.addEventListener("capZoneEvent", (data) => {
			if (!this.state.modActive) return;

			const { capID, playerID } = data;
			let playerName = window.bonkAPI.getPlayerNameByID(playerID);
			let map = this.state.mapData[this.state.currentMap];

			// Identify the CapZone and its associated Shape/Platform
			let cz = this.state.currentCapZones[capID] || this.state.currentCapZones.find(c => c.i === capID);
			let fixName = "";
			let bodyName = "";

			if (cz && this.state.currentPhysics) {
				let fixtureIndex = cz.i;
				let fixture = this.state.currentPhysics.fixtures[fixtureIndex];
				if (fixture) {
					fixName = fixture.n || "";
					// Find the body containing this fixture
					let body = this.state.currentPhysics.bodies.find(b => b.fx && b.fx.includes(fixtureIndex));
					if (body && body.s) {
						bodyName = body.s.n || ""; // Fetches name from body.s.n as shown in your debug
					}
				}
			}

			let isZone = false;

			// Convert to lowercase once for efficiency
			const fNameLower = fixName.toLowerCase();
			const bNameLower = bodyName.toLowerCase();

			// Check for exact match of "zone", OR if the name contains "cp_zone"
			if (fNameLower === "zone" || fNameLower.includes("cp_zone") ||
				bNameLower === "zone" || bNameLower.includes("cp_zone")) {
				isZone = true;
			}

			if (playerName && map && map.started) {
				let pData = map.players[playerName];
				if (pData && !pData.top && !pData.eliminated) {
					if (isZone) {
						if (!pData.zone) {
							pData.zone = true;
							pData.att_z = pData.current_att;
							this.sendChatAlert(playerName, "zone", pData.att_z);
							this.renderTable();
						}
					} else {
						pData.top = true;
						pData.att_t = pData.current_att;
						this.sendChatAlert(playerName, "top", pData.att_t);

						if (!pData.zone) {
							pData.zone = true;
							pData.att_z = pData.current_att;
						}
						this.renderTable();
					}
				}
			}
		});


	};

	pkrEventScores.showKillOverlay = function() {
		// Prevent opening multiple instances
		if (document.getElementById("pkr_kill_modal")) return;

		const map = this.state.mapData[this.state.currentMap];
		if (!map || !map.started) {
			alert("No active game to eliminate players from.");
			return;
		}

		const activePlayers = [];
		for (const [name, pData] of Object.entries(map.players)) {
			if (!pData.top && !pData.eliminated) {
				activePlayers.push(name);
			}
		}

		if (activePlayers.length === 0) {
			console.log("pkrEvents: No eligible players to eliminate on this map.");
			return;
		}

		const modal = document.createElement("div");
		modal.id = "pkr_kill_modal";
		Object.assign(modal.style, {
			position: "fixed", left: (window.innerWidth / 2 - 175) + "px", top: "100px",
			width: "350px", backgroundColor: "#1e1e1e", color: "white",
			borderRadius: "8px", border: "2px solid #555",
			display: "flex", flexDirection: "column", padding: "20px",
			zIndex: "100000", fontFamily: "futurept_b1",
			boxShadow: "0 4px 15px rgba(0,0,0,0.5)"
		});

		// Render checkboxes unchecked by default
		let checkboxHTML = activePlayers.map(p => `
			<label style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px; cursor: pointer;">
				<input type="checkbox" value="${p}" class="pkr-kill-cb" style="cursor: pointer;">
				${p}
			</label>
		`).join("");

		modal.innerHTML = `
			<h3 id="pkr_kill_header" style="margin-top: 0; color: #ff8c00; text-align: center; cursor: move; user-select: none; background: #333; padding: 5px; border-radius: 4px;">Eliminate Players</h3>
			<p style="font-size: 13px; color: #aaa; margin-bottom: 15px; text-align: center;">Choose players to instantly eliminate.<br><span style="color: #ff4444;">(Note: This feature is buggy and may not always trigger deaths visually)</span></p>
			<div style="flex-grow: 1; max-height: 250px; overflow-y: auto; background: #222; padding: 10px; border-radius: 4px; border: 1px solid #444;" class="bonkhud-scrollbar-kit">
				${checkboxHTML}
			</div>
			<div style="display: flex; gap: 10px; margin-top: 20px;">
				<button id="pkr_kill_cancel" style="flex: 1; padding: 10px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px; font-family: 'futurept_b1'; font-size: 14px;">Cancel</button>
				<button id="pkr_kill_confirm" style="flex: 1; padding: 10px; background: #d32f2f; color: white; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; font-family: 'futurept_b1'; font-size: 14px;">Eliminate</button>
			</div>
		`;

		document.body.appendChild(modal);

		// Draggable Logic
		const header = modal.querySelector("#pkr_kill_header");
		let isDragging = false, startX, startY, startLeft, startTop;
		
		header.onmousedown = (e) => {
			isDragging = true;
			startX = e.clientX; startY = e.clientY;
			startLeft = modal.offsetLeft; startTop = modal.offsetTop;
			
			const onMouseMove = (e) => {
				if (!isDragging) return;
				modal.style.left = (startLeft + (e.clientX - startX)) + "px";
				modal.style.top = (startTop + (e.clientY - startY)) + "px";
			};
			
			const onMouseUp = () => {
				isDragging = false;
				document.removeEventListener("mousemove", onMouseMove);
				document.removeEventListener("mouseup", onMouseUp);
			};
			
			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		};

		modal.querySelector("#pkr_kill_cancel").onclick = () => modal.remove();
		modal.querySelector("#pkr_kill_confirm").onclick = () => {
			const selectedBoxes = Array.from(modal.querySelectorAll(".pkr-kill-cb:checked"));
			if (selectedBoxes.length === 0) {
				modal.remove();
				return;
			}

			if (confirm(`Are you sure you want to eliminate ${selectedBoxes.length} player(s)?`)) {
				selectedBoxes.forEach(cb => {
					const name = cb.value;
					const pData = map.players[name];
					const pID = window.bonkAPI.getPlayerIDByName(name);

					if (pData && pID !== -1) {
						pData.eliminated = true;
						this.killPlayer(pID);
					}
				});
				this.renderTable();
				modal.remove();
			}
		};
	};

	// --- AGGREGATOR & REPORT ---

	pkrEventScores.calculateLeaderboard = function() {
		const results = {};
		this.state.allPlayers.forEach(p => {
			results[p] = { tops: 0, zones: 0, att_t: 0, att_z: 0 };
		});
		for (let i = 1; i <= this.state.highestMap; i++) {
			const mData = this.state.mapData[i];
			if (mData && mData.started) {
				for (let p in mData.players) {
					const pData = mData.players[p];
					if (pData.top) {
						results[p].tops++;
						results[p].att_t += pData.att_t;
					}
					if (pData.zone) {
						results[p].zones++;
						results[p].att_z += pData.att_z;
					}
				}
			}
		}
		const sorted = Array.from(this.state.allPlayers).sort((a, b) => {
			const rA = results[a];
			const rB = results[b];
			if (rB.tops !== rA.tops) return rB.tops - rA.tops;
			if (rB.zones !== rA.zones) return rB.zones - rA.zones;
			if (rA.att_t !== rB.att_t) return rA.att_t - rB.att_t;
			return rA.att_z - rB.att_z;
		});
		return { results, sorted };
	};

	pkrEventScores.showRulesOverlay = function() {
		const overlay = document.createElement("div");
		Object.assign(overlay.style, {
			position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
			backgroundColor: "rgba(0, 0, 0, 0.8)", zIndex: "100000",
			display: "flex", justifyContent: "center", alignItems: "center",
			fontFamily: "futurept_b1"
		});

		const modal = document.createElement("div");
		Object.assign(modal.style, {
			width: "500px",
			maxWidth: "90vw",
			maxHeight: "85vh", // Prevents vertical stretching past the screen
			backgroundColor: "#1e1e1e",
			borderRadius: "8px", border: "2px solid #555",
			display: "flex", flexDirection: "column", padding: "20px", color: "white",
			boxSizing: "border-box"
		});

		modal.innerHTML = `
			<h2 style="text-align: center; margin-top: 0; margin-bottom: 15px; color: #4fc3f7; flex-shrink: 0;">Competition Info</h2>
			<div style="flex-grow: 1; overflow-y: auto; padding-right: 10px;" class="bonkhud-scrollbar-kit">
				<h3 style="color: #ff8c00; margin-top: 0; margin-bottom: 8px;">Info for Event</h3>
				<ul style="line-height: 1.5; font-size: 15px; padding-left: 20px; margin: 0; margin-bottom: 15px;">
					${this.rules.event.map(r => `<li style="margin-bottom: 8px;">${r}</li>`).join('')}
				</ul>
				<h3 style="color: #ff8c00; margin-top: 0; margin-bottom: 8px;">Info for Mapmaking</h3>
				<ul style="line-height: 1.5; font-size: 15px; padding-left: 20px; margin: 0;">
					${this.rules.mapmaking.map(r => `<li style="margin-bottom: 8px;">${r}</li>`).join('')}
				</ul>
			</div>
			<button id="pkr_rules_close" style="margin-top: 15px; padding: 10px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; font-family: 'futurept_b1'; font-size: 16px; flex-shrink: 0;">Close</button>
		`;

		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		overlay.querySelector("#pkr_rules_close").onclick = () => overlay.remove();
		
		// Close when clicking directly on the dark overlay background
		overlay.addEventListener("mousedown", (e) => {
			if (e.target === overlay) overlay.remove();
		});
	};

	pkrEventScores.showReportOverlay = function() {
		const { results, sorted } = this.calculateLeaderboard();
		let mapsPlayed = 0;
		for (let i = 1; i <= this.state.highestMap; i++) {
			if (this.state.mapData[i] && this.state.mapData[i].started) mapsPlayed++;
		}

		const overlay = document.createElement("div");
		Object.assign(overlay.style, {
			position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
			backgroundColor: "rgba(0, 0, 0, 0.95)", zIndex: "100000",
			display: "flex", justifyContent: "center", alignItems: "center",
			fontFamily: "futurept_b1"
		});

		const modal = document.createElement("div");
		Object.assign(modal.style, {
			width: "700px", maxHeight: "85%", backgroundColor: "#1e1e1e",
			borderRadius: "8px", border: "2px solid #555",
			display: "flex", flexDirection: "column", padding: "20px"
		});

		let tableHTML = `
			<table style="width: 100%; border-collapse: collapse; color: white; text-align: center; font-size: 16px;">
				<thead>
					<tr style="border-bottom: 2px solid #888; background: #333;">
						<th style="padding: 10px; width: 10%;">Rank</th>
						<th style="padding: 10px; text-align: left;">Player</th>
						<th style="padding: 10px; width: 35%;">Score String</th>
					</tr>
				</thead>
				<tbody>
		`;

		sorted.forEach((p, index) => {
			const r = results[p];
			const scoreString = `${r.tops}T ${r.zones}z ${r.att_t} ${r.att_z}`;
			const rankColor = index === 0 ? "#ffd700" : (index === 1 ? "#c0c0c0" : (index === 2 ? "#cd7f32" : "white"));

			tableHTML += `
				<tr style="border-bottom: 1px solid #444;">
					<td style="padding: 10px; font-weight: bold; color: ${rankColor};">${index + 1}</td>
					<td style="padding: 10px; text-align: left; font-weight: bold;">${p}</td>
					<td style="padding: 10px; font-family: monospace; font-size: 18px; color: #4caf50;">${scoreString}</td>
				</tr>
			`;
		});
		tableHTML += `</tbody></table>`;

		modal.innerHTML = `
			<h2 style="color: white; text-align: center; margin: 0;">Competition Leaderboard</h2>
			<p style="color: #aaa; text-align: center; margin-bottom: 20px;">Maps Started: ${mapsPlayed}</p>
			<div style="flex-grow: 1; overflow-y: auto; background: #222; border-radius: 4px; padding: 5px;">
				${tableHTML}
			</div>
			<div style="display: flex; gap: 10px; margin-top: 20px;">
				<button id="pkr_close" style="flex: 1; padding: 12px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px; font-family: 'futurept_b1'; font-size: 16px;">Close</button>
				<button id="pkr_csv" style="flex: 1; padding: 12px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; font-family: 'futurept_b1'; font-size: 16px;">Export CSV</button>
			</div>
		`;

		overlay.appendChild(modal);
		document.body.appendChild(overlay);

		overlay.querySelector("#pkr_close").onclick = () => overlay.remove();
		overlay.querySelector("#pkr_csv").onclick = () => {
			let csv = "Rank,Player,Tops,Zones,Attempts to Top,Attempts to Zone,Score String\n";
			sorted.forEach((p, i) => {
				const r = results[p];
				csv += `${i+1},"${p}",${r.tops},${r.zones},${r.att_t},${r.att_z},${r.tops}T ${r.zones}z ${r.att_t} ${r.att_z}\n`;
			});
			const b = new Blob([csv], {type: 'text/csv'});
			const u = URL.createObjectURL(b);
			const a = document.createElement('a');
			a.href = u;
			a.download = `Competition_Report_${Date.now()}.csv`; a.click();
		};
	};

	if (document.readyState === "complete" || document.readyState === "interactive") {
		pkrEventScores.init();
	} else {
		document.addEventListener("DOMContentLoaded", () => pkrEventScores.init());
	}