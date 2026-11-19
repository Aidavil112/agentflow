import {
  clamp, cleanName, escapeHtml, formatScore, formatTime, getHighScores,
} from "./utils.js";

export class UI {
  constructor(game) {
    this.game = game;
    this.screens = {
      loading: document.getElementById("loading-screen"),
      start: document.getElementById("start-screen"),
      connect: document.getElementById("connect-screen"),
      pause: document.getElementById("pause-screen"),
      gameover: document.getElementById("gameover-screen"),
    };
    this.el = {
      hud: document.getElementById("hud"),
      loadingProgress: document.getElementById("loading-progress"),
      loadingStatus: document.getElementById("loading-status"),
      score: document.getElementById("score-value"),
      comboChip: document.getElementById("combo-chip"),
      timer: document.getElementById("timer-value"),
      timerCard: document.querySelector(".timer-card"),
      speed: document.getElementById("speed-value"),
      speedometer: document.querySelector(".speedometer"),
      healthFill: document.getElementById("health-fill"),
      boostFill: document.getElementById("boost-fill"),
      comboFill: document.getElementById("combo-fill"),
      objective: document.getElementById("objective-text"),
      gateDistance: document.getElementById("gate-distance"),
      compassArrow: document.getElementById("compass-arrow"),
      modeTag: document.getElementById("mode-tag"),
      roomPill: document.getElementById("room-pill"),
      roomCodeHud: document.getElementById("room-code-hud"),
      multiplayerHud: document.getElementById("multiplayer-hud"),
      mpPlayers: document.getElementById("mp-players"),
      touchControls: document.getElementById("touch-controls"),
      goBanner: document.getElementById("go-banner"),
      countdownBanner: document.getElementById("countdown-banner"),
      floatLayer: document.getElementById("float-layer"),
      speedLines: document.getElementById("speed-lines"),
      boostFlash: document.getElementById("boost-flash"),
      damageFlash: document.getElementById("damage-flash"),
      toast: document.getElementById("toast"),
      nameInput: document.getElementById("name-input"),
      joinCodeInput: document.getElementById("join-code-input"),
      roomCodeDisplay: document.getElementById("room-code-display"),
      inviteLink: document.getElementById("invite-link"),
      copyInviteBtn: document.getElementById("copy-invite-btn"),
      roomStatus: document.getElementById("room-status"),
      connectPlayers: document.getElementById("connect-players"),
      connectStartBtn: document.getElementById("connect-start-btn"),
      connectHint: document.getElementById("connect-hint"),
      startScores: document.getElementById("start-scores"),
      gameoverScores: document.getElementById("gameover-scores"),
      finalScore: document.getElementById("final-score"),
      finalGates: document.getElementById("final-gates"),
      finalCombo: document.getElementById("final-combo"),
      finalDistance: document.getElementById("final-distance"),
      gameoverReason: document.getElementById("gameover-reason"),
      newRecord: document.getElementById("new-record"),
      muteBtn: document.getElementById("mute-btn"),
      pauseMuteBtn: document.getElementById("pause-mute-btn"),
      minimap: document.getElementById("minimap"),
      characterCards: [...document.querySelectorAll(".character-card")],
      characterStatus: document.getElementById("character-status"),
      installBtn: document.getElementById("install-btn"),
      qualityButtons: [...document.querySelectorAll(".quality-btn")],
      qualityStatus: document.getElementById("quality-status"),
      cityButtons: [...document.querySelectorAll(".city-btn")],
      cityStatus: document.getElementById("city-status"),
      cityTagline: document.getElementById("city-tagline"),
      hudCity: document.getElementById("hud-city"),
      minimapCity: document.getElementById("minimap-city"),
      connectCity: document.getElementById("connect-city"),
      landscapeBtn: document.getElementById("landscape-btn"),
      rotateBtn: document.getElementById("rotate-btn"),
      rotateOverlay: document.getElementById("rotate-overlay"),
    };
    this.orientationQuery = window.matchMedia("(orientation: portrait) and (max-width: 900px)");
    this.minimapCtx = this.el.minimap.getContext("2d");
    this.lastCombo = 1;
    this.comboTimer = null;
    this.toastTimer = null;
    this.goTimer = null;
    this.damageTimer = null;
    this.deferredInstall = null;

    this.bindEvents();
    this.renderHighScores();
    this.setMuteState(game.audio?.muted || false);
    this.orientationQuery.addEventListener?.("change", () => this.updateOrientation());
    this.updateOrientation();
  }

  bindEvents() {
    const g = this.game;
    const click = (id, handler) => document.getElementById(id)?.addEventListener("click", (event) => {
      event.preventDefault();
      handler();
    });

    click("start-btn", () => g.startSolo());
    click("connect-btn", () => g.openConnect());
    click("create-room-btn", () => g.createRoom());
    click("join-room-btn", () => g.joinRoom());
    click("copy-invite-btn", () => g.copyInvite());
    click("connect-start-btn", () => g.startConnectRun());
    click("connect-back-btn", () => g.toMenu());
    click("pause-btn", () => g.togglePause());
    click("mute-btn", () => g.toggleMute());
    click("resume-btn", () => g.resume());
    click("pause-restart-btn", () => g.restart());
    click("pause-menu-btn", () => g.toMenu());
    click("pause-mute-btn", () => g.toggleMute());
    click("restart-btn", () => g.restart());
    click("gameover-menu-btn", () => g.toMenu());
    click("install-btn", () => this.promptInstall());
    click("landscape-btn", () => g.enterLandscapeMode());
    click("rotate-btn", () => g.enterLandscapeMode());

    for (const button of this.el.qualityButtons) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        g.setQualityPreset(button.dataset.quality);
      });
    }

    for (const button of this.el.cityButtons) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        g.setCity(button.dataset.city);
      });
    }

    for (const card of this.el.characterCards) {
      card.addEventListener("click", (event) => {
        event.preventDefault();
        g.setCharacter(card.dataset.character);
      });
    }

    this.el.nameInput.addEventListener("change", () => g.setPlayerName(this.el.nameInput.value));
    this.el.nameInput.addEventListener("input", () => g.setPlayerName(this.el.nameInput.value, false));
    this.el.joinCodeInput.addEventListener("input", () => {
      this.el.joinCodeInput.value = this.el.joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    });
    this.el.joinCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") g.joinRoom();
    });
    this.el.inviteLink.addEventListener("click", () => this.el.inviteLink.select());
  }

  showScreen(name) {
    for (const [key, element] of Object.entries(this.screens)) {
      element.classList.toggle("hidden", key !== name);
    }
  }

  setLoading(progress, status) {
    this.el.loadingProgress.style.width = `${clamp(progress, 0, 1) * 100}%`;
    if (status) this.el.loadingStatus.textContent = status;
    this.showScreen("loading");
  }

  showStart() {
    this.renderHighScores();
    this.showScreen("start");
    this.showHUD(false);
    this.setTouchVisible(false);
    this.hideCountdown();
    this.hideGo();
    this.game.resizePreviewRenderer?.();
  }

  showConnect() {
    this.showScreen("connect");
    this.showHUD(false);
    this.setTouchVisible(false);
  }

  showPause() {
    this.showScreen("pause");
    this.setTouchVisible(false);
    this.setMuteState(this.game.audio?.muted || false);
  }

  showGameOver(stats) {
    this.showScreen("gameover");
    this.setTouchVisible(false);
    this.hideGo();
    this.hideCountdown();
    this.el.finalScore.textContent = formatScore(stats.score);
    this.el.finalGates.textContent = String(stats.gates);
    this.el.finalCombo.textContent = `×${stats.bestCombo}`;
    this.el.finalDistance.textContent = `${(stats.distance / 1000).toFixed(2)} km`;
    this.el.gameoverReason.textContent = stats.reason;
    if (stats.rank >= 0) {
      this.el.newRecord.classList.remove("hidden");
      this.el.newRecord.textContent = stats.rank === 0 ? "✦ NEW LOCAL RECORD ✦" : `✦ TOP 5 ENTRY · #${stats.rank + 1} ✦`;
    } else {
      this.el.newRecord.classList.add("hidden");
    }
    this.renderHighScores(stats.highlightDate);
  }

  showPlaying() {
    this.showScreen(null);
    this.showHUD(true);
    this.setTouchVisible(true);
  }

  showHUD(show) {
    this.el.hud.classList.toggle("hidden", !show);
    if (!show) {
      this.el.speedLines.style.opacity = "0";
      this.el.boostFlash.style.opacity = "0";
    }
  }

  setTouchVisible(show) {
    const visible = show && this.game.input?.hasTouch;
    this.el.touchControls.classList.toggle("hidden", !visible);
  }

  setMuteState(muted) {
    this.el.muteBtn.textContent = muted ? "♪̸" : "♫";
    this.el.muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    this.el.pauseMuteBtn.textContent = `SOUND: ${muted ? "OFF" : "ON"}`;
  }

  renderHighScores(highlightDate = null) {
    const scores = getHighScores();
    const html = scores.length
      ? scores.map((entry, index) => {
        const fresh = highlightDate && entry.date === highlightDate ? " class=\"fresh\"" : "";
        return `<tr${fresh}><td>${index + 1}</td><td>${escapeHtml(entry.name)}</td><td>${formatScore(entry.score)}</td></tr>`;
      }).join("")
      : '<tr class="empty-row"><td colspan="3">No runs yet — set the first record</td></tr>';
    this.el.startScores.innerHTML = html;
    this.el.gameoverScores.innerHTML = html;
  }

  getPlayerName() {
    return cleanName(this.el.nameInput.value);
  }

  setPlayerName(name) {
    this.el.nameInput.value = cleanName(name);
  }

  setCharacter(id, meta = null) {
    for (const card of this.el.characterCards) {
      card.classList.toggle("selected", card.dataset.character === id);
      card.setAttribute("aria-pressed", card.dataset.character === id ? "true" : "false");
    }
    if (this.el.characterStatus && meta?.tag) this.el.characterStatus.textContent = meta.tag;
  }

  setQuality(id, meta = null) {
    for (const button of this.el.qualityButtons) {
      const selected = button.dataset.quality === id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    if (this.el.qualityStatus && meta?.note) this.el.qualityStatus.textContent = meta.note;
  }

  setCity(id, meta = null) {
    for (const button of this.el.cityButtons) {
      const selected = button.dataset.city === id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    if (this.el.cityStatus && meta?.note) this.el.cityStatus.textContent = meta.note;
    if (this.el.cityTagline && meta?.story) this.el.cityTagline.textContent = meta.story;
    const label = meta?.hudLabel || meta?.label || "MUMBAI";
    if (this.el.hudCity) this.el.hudCity.textContent = label;
    if (this.el.minimapCity) this.el.minimapCity.textContent = label;
    if (this.el.connectCity) this.el.connectCity.textContent = meta?.shortLabel || meta?.label || label;
    document.documentElement.style.setProperty("--city-accent", meta?.accent || "#20e3b2");
  }

  updateOrientation() {
    if (!this.el.rotateOverlay) return;
    const portraitTouch = this.orientationQuery.matches ||
      (window.innerHeight > window.innerWidth && window.innerWidth < 900);
    this.el.rotateOverlay.classList.toggle("hidden", !portraitTouch);
  }

  setInstallPrompt(event) {
    this.deferredInstall = event;
    this.el.installBtn.classList.remove("hidden");
  }

  async promptInstall() {
    if (!this.deferredInstall) {
      this.showToast("Use your browser's Install App / Add to Home Screen option", 3000);
      return;
    }
    const prompt = this.deferredInstall;
    this.deferredInstall = null;
    this.el.installBtn.classList.add("hidden");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") this.showToast("Monsoon Drift installed", 1900);
    } catch {
      this.showToast("Installation was cancelled", 1800);
    }
  }

  setJoinCode(code) {
    this.el.joinCodeInput.value = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  }

  getJoinCode() {
    return this.el.joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  }

  getInviteLink() {
    return this.el.inviteLink.value;
  }

  updateConnect({ status, room, inviteUrl, players = [], hostId, selfId, connected, started, city = null }) {
    const cityLabel = city?.shortLabel || city?.label || "MUMBAI";
    this.el.roomStatus.textContent = status || "Not connected";
    if (this.el.connectCity) this.el.connectCity.textContent = city?.hudLabel || cityLabel;
    this.el.roomCodeDisplay.textContent = room || "----";
    this.el.inviteLink.value = inviteUrl || "";
    this.el.copyInviteBtn.disabled = !inviteUrl;

    this.el.connectPlayers.innerHTML = players.length
      ? players.map((player) => {
        const isHost = player.id === hostId;
        return `<span class="player-chip${isHost ? " host" : ""}" style="--chip-color:${escapeHtml(player.color || "#20e3b2")}"><i></i>${escapeHtml(player.name)}${player.id === selfId ? " · YOU" : ""}</span>`;
      }).join("")
      : '<span class="player-chip" style="--chip-color:#59627f"><i></i>Waiting for riders…</span>';

    const canStart = connected && selfId === hostId && !started;
    this.el.connectStartBtn.disabled = !canStart;
    if (started) {
      this.el.connectStartBtn.textContent = "RUN IN PROGRESS";
      this.el.connectHint.textContent = "Shared clock is live. Gates score points; no time extensions.";
    } else if (connected && selfId !== hostId) {
      this.el.connectStartBtn.textContent = "WAITING FOR HOST";
      this.el.connectHint.textContent = "The host will start the 90-second score attack.";
    } else if (connected) {
      this.el.connectStartBtn.textContent = "START SHARED RUN";
      this.el.connectHint.textContent = "You are the host. Start when everyone is in — solo starts are allowed too.";
    } else {
      this.el.connectStartBtn.textContent = "START SHARED RUN";
      this.el.connectHint.textContent = "The host starts a 90-second score attack. Up to 8 riders.";
    }
    this.el.connectHint.textContent += ` · ${cityLabel} city`;
  }

  setRoomHud(room, players, selfId) {
    if (!room) {
      this.el.roomPill.classList.add("hidden");
      this.el.multiplayerHud.classList.add("hidden");
      return;
    }
    this.el.roomPill.classList.remove("hidden");
    this.el.multiplayerHud.classList.remove("hidden");
    this.el.roomCodeHud.textContent = room;
    const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6);
    this.el.mpPlayers.innerHTML = sorted.map((player) => {
      const name = player.id === selfId ? `${player.name} · YOU` : player.name;
      return `<div class="mp-row" style="--chip-color:${escapeHtml(player.color || "#20e3b2")}"><i class="mp-dot"></i><span class="mp-name">${escapeHtml(name)}</span><span class="mp-score">${formatScore(player.score || 0)}</span></div>`;
    }).join("");
  }

  updateHUD(data) {
    this.el.score.textContent = formatScore(data.score);
    this.el.comboChip.textContent = `×${data.combo} COMBO`;
    if (data.combo > this.lastCombo) {
      this.el.comboChip.classList.remove("pop");
      void this.el.comboChip.offsetWidth;
      this.el.comboChip.classList.add("pop");
      if (this.comboTimer) clearTimeout(this.comboTimer);
      this.comboTimer = setTimeout(() => this.el.comboChip.classList.remove("pop"), 340);
    }
    this.lastCombo = data.combo;
    this.el.timer.textContent = formatTime(data.timeLeft);
    this.el.timerCard.classList.toggle("critical", data.timeLeft <= 10);
    this.el.speed.textContent = String(Math.round(data.speedKmh));
    this.el.speedometer.style.setProperty("--speed-pct", `${clamp(data.speedRatio, 0, 1) * 75}%`);
    this.el.healthFill.style.width = `${clamp(data.healthRatio, 0, 1) * 100}%`;
    this.el.boostFill.style.width = `${clamp(data.boost / 100, 0, 1) * 100}%`;
    this.el.comboFill.style.width = `${clamp(data.comboTimer / data.comboWindow, 0, 1) * 100}%`;
    this.el.objective.textContent = data.objective;
    this.el.gateDistance.textContent = `${Math.round(data.gateDistance)}m`;
    this.el.compassArrow.style.transform = `rotate(${data.compassAngle}deg)`;
    this.el.modeTag.textContent = data.mode === "connect" ? "CONNECT PLAY" : "SOLO RUN";
    const speedOpacity = clamp((data.speedRatio - 0.38) * 0.7 + (data.boosting ? 0.32 : 0), 0, 0.82);
    document.documentElement.style.setProperty("--speed-opacity", speedOpacity.toFixed(2));
    this.el.boostFlash.style.opacity = data.boosting ? "0.9" : "0";
  }

  flashDamage(strength = 1) {
    this.el.damageFlash.style.opacity = String(clamp(strength, 0.25, 1));
    if (this.damageTimer) clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => {
      this.el.damageFlash.style.opacity = "0";
    }, 110);
  }

  showGo() {
    const banner = this.el.goBanner;
    banner.classList.remove("hidden");
    banner.style.animation = "none";
    void banner.offsetWidth;
    banner.style.animation = "";
    if (this.goTimer) clearTimeout(this.goTimer);
    this.goTimer = setTimeout(() => banner.classList.add("hidden"), 900);
  }

  hideGo() {
    this.el.goBanner.classList.add("hidden");
  }

  showCountdown(text) {
    this.el.countdownBanner.textContent = text;
    this.el.countdownBanner.classList.remove("hidden");
  }

  hideCountdown() {
    this.el.countdownBanner.classList.add("hidden");
  }

  floatScore(text, x, y, color = "#ffd166") {
    const element = document.createElement("div");
    element.className = "score-pop";
    element.textContent = text;
    element.style.left = `${clamp(x, 70, window.innerWidth - 70)}px`;
    element.style.top = `${clamp(y, 80, window.innerHeight - 100)}px`;
    element.style.setProperty("--pop-color", color);
    this.el.floatLayer.appendChild(element);
    element.addEventListener("animationend", () => element.remove(), { once: true });
    setTimeout(() => element.remove(), 1200);
  }

  showToast(message, duration = 2800) {
    this.el.toast.textContent = message;
    this.el.toast.classList.remove("hidden");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.add("hidden"), duration);
  }

  drawMinimap(data) {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const w = this.el.minimap.width;
    const h = this.el.minimap.height;
    const scale = w / (data.citySize * 2);
    const mx = (x) => w / 2 + x * scale;
    const my = (z) => h / 2 + z * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(4, 9, 22, 0.9)";
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = Math.max(5, data.roadWidth * scale);
    ctx.strokeStyle = "rgba(90, 112, 156, 0.36)";
    ctx.beginPath();
    for (const r of data.roads) {
      ctx.moveTo(mx(r), 0); ctx.lineTo(mx(r), h);
      ctx.moveTo(0, my(r)); ctx.lineTo(w, my(r));
    }
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 209, 102, 0.16)";
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.font = "700 9px Arial";
    ctx.fillText("N", w / 2 - 3, 12);

    for (const pad of data.pads || []) {
      if (pad.used) continue;
      ctx.fillStyle = "rgba(32, 227, 178, .75)";
      ctx.fillRect(mx(pad.x) - 2, my(pad.z) - 2, 4, 4);
    }
    for (const pickup of data.pickups || []) {
      if (pickup.collected) continue;
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.arc(mx(pickup.x), my(pickup.z), 1.7, 0, Math.PI * 2); ctx.fill();
    }
    for (const car of data.traffic || []) {
      ctx.fillStyle = "rgba(180, 195, 230, .5)";
      ctx.fillRect(mx(car.x) - 1.2, my(car.z) - 1.2, 2.4, 2.4);
    }
    for (const remote of data.remotes || []) {
      ctx.fillStyle = remote.color || "#8b7cff";
      ctx.beginPath(); ctx.arc(mx(remote.x), my(remote.z), 3, 0, Math.PI * 2); ctx.fill();
    }

    if (data.gate) {
      const pulse = 5 + Math.sin(performance.now() * 0.006) * 2;
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx(data.gate.x), my(data.gate.z), pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ff9f1c";
      ctx.beginPath(); ctx.arc(mx(data.gate.x), my(data.gate.z), 2.5, 0, Math.PI * 2); ctx.fill();
    }

    if (data.player) {
      const px = mx(data.player.x);
      const py = my(data.player.z);
      const fx = Math.sin(data.player.yaw);
      const fz = Math.cos(data.player.yaw);
      const rx = Math.cos(data.player.yaw);
      const rz = -Math.sin(data.player.yaw);
      ctx.fillStyle = "#20e3b2";
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + fx * 8, py + fz * 8);
      ctx.lineTo(px - fx * 5 + rx * 4.5, py - fz * 5 + rz * 4.5);
      ctx.lineTo(px - fx * 5 - rx * 4.5, py - fz * 5 - rz * 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}
