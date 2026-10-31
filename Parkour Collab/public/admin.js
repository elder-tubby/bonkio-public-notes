// public/admin.js
import * as Network from "./network.js";
import { showToast } from "./utils-client.js";

class AdminUI {
  constructor() {
    this.isLoggedIn = false;
    this.gameActive = false;
    this.players = [];
    this.elems = {};
  }

  init() {
    const container = document.createElement("div");
    container.id = "adminPanel";
    container.className = "admin-panel";
    container.innerHTML = `
      <button id="adminPanelToggle" class="admin-panel-toggle">🔒</button>
      <div id="adminPanelContent" class="admin-panel-content hidden"></div>
    `;
    document.body.appendChild(container);

    this.elems.panel = container;
    this.elems.toggleBtn = document.getElementById("adminPanelToggle");
    this.elems.content = document.getElementById("adminPanelContent");

    this.elems.toggleBtn.addEventListener("click", () => this.togglePanel());
  }

  togglePanel() {
    const isHidden = this.elems.content.classList.toggle("hidden");
    if (!isHidden && !this.isLoggedIn) {
      this.renderLogin();
    }
  }

  handleStateUpdate({ hasLobbyPassword, gameActive, players }) {
    if (typeof gameActive === "boolean") this.gameActive = gameActive;
    if (Array.isArray(players)) this.players = players;

    // If panel is open and we're logged in, re-render controls with fresh data
    const panelOpen = !this.elems.content.classList.contains("hidden");
    if (panelOpen && this.isLoggedIn) {
      this.renderControls({ hasLobbyPassword });
    }
  }

  handleLoginSuccess(state) {
    this.isLoggedIn = true;
    this.handleStateUpdate(state); // Renders the controls
  }

  renderLogin() {
    this.elems.content.innerHTML = `
      <div class="admin-login-form">
        <h4>Admin Access</h4>
        <input type="password" id="adminPasswordInput" placeholder="Admin Password"  autocomplete="off"/>
        <button id="adminLoginBtn" class="btn btn-small">Login</button>
      </div>
    `;

    document.getElementById("adminLoginBtn").addEventListener("click", () => {
      const pass = document.getElementById("adminPasswordInput").value;
      Network.adminLogin(pass);
    });
    document
      .getElementById("adminPasswordInput")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          document.getElementById("adminLoginBtn").click();
        }
      });
  }

  renderControls({ hasLobbyPassword }) {
    const playersHTML = this.players
      .map(
        (p) => `
        <li class="admin-player-item">
          <span>${p.name}</span>
          <div class="admin-player-actions">
            <button class="btn btn-small" data-kick-id="${p.id}">Kick</button>
          </div>
        </li>
      `,
      )
      .join("");

    this.elems.content.innerHTML = `
      <div class="admin-section">
        <h4>Lobby Password</h4>
        <input type="text" id="lobbyPasswordInput" placeholder="New pass (leave blank to remove)" autocomplete="off"/>
        <button id="setLobbyPassBtn" class="btn btn-small">Set/Remove</button>
      </div>
      <div class="admin-section">
        <h4>Players (${this.players.length})</h4>
        <ul class="admin-player-list">${playersHTML}</ul>
      </div>
      ${
        this.gameActive
          ? `
      <div class="admin-section">
        <h4>Game Management</h4>
        <button id="adminEndGameBtn" class="btn btn-small">Force End Game</button>
      </div>
      `
          : ""
      }
    `;

    // Bind events
    document.getElementById("setLobbyPassBtn").addEventListener("click", () => {
      const newPass = document.getElementById("lobbyPasswordInput").value;
      Network.adminSetPassword(newPass);
      showToast(newPass ? "Lobby password set." : "Lobby password removed.");
      document.getElementById("lobbyPasswordInput").value = "";
    });

    this.elems.content.querySelectorAll("[data-kick-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.dataset.kickId;
        if (confirm("Are you sure you want to kick this player?")) {
          Network.adminKickPlayer(id);
        }
      });
    });

    if (this.gameActive) {
      document
        .getElementById("adminEndGameBtn")
        .addEventListener("click", () => {
          if (
            confirm(
              "Are you sure you want to end the current game for everyone?",
            )
          ) {
            Network.adminEndGame();
          }
        });
    }
  }
}

export default new AdminUI();
