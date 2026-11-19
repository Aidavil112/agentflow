const noop = () => {};

export class NetworkClient {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.ws = null;
    this.desired = null;
    this.manualClose = false;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.lastStateAt = 0;

    this.id = null;
    this.room = null;
    this.hostId = null;
    this.players = [];
    this.connected = false;
    this.started = false;
    this.startAt = 0;
    this.duration = 90;
    this.seed = null;
    this.serverOffset = 0;
  }

  get statusSocketUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/net`;
  }

  serverNow() {
    return Date.now() + this.serverOffset;
  }

  remainingTime() {
    if (!this.started || !this.startAt) return this.duration;
    return Math.max(0, this.duration - Math.max(0, (this.serverNow() - this.startAt) / 1000));
  }

  isCountdown() {
    return this.started && this.startAt > this.serverNow();
  }

  isHost() {
    return !!this.connected && this.id === this.hostId;
  }

  isConnected() {
    return this.connected && !!this.room;
  }

  connect({ name, room = "", create = false }) {
    this.desired = { name, room: String(room || "").toUpperCase(), create };
    this.manualClose = true;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignored */ }
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.open();
  }

  open() {
    if (!this.desired) return;
    this.manualClose = false;
    this.callbacks.onStatus?.("Connecting…", "connecting");
    let socket;
    try {
      socket = new WebSocket(this.statusSocketUrl);
      this.ws = socket;
    } catch {
      this.callbacks.onError?.("WebSocket unavailable. Solo mode still works.");
      this.callbacks.onStatus?.("Offline", "offline");
      return;
    }

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.send({ type: "hello", ...this.desired });
      this.pingTimer = setInterval(() => this.send({ type: "ping", t: Date.now() }), 5000);
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case "welcome": {
          this.id = msg.id;
          this.room = msg.room;
          this.hostId = msg.hostId;
          this.players = msg.players || [];
          this.connected = true;
          this.started = !!msg.started;
          this.startAt = msg.startAt || 0;
          this.duration = msg.duration || 90;
          this.seed = msg.seed;
          this.serverOffset = (msg.serverTime || Date.now()) - Date.now();
          this.callbacks.onStatus?.(`Connected · Room ${msg.room}`, "connected");
          this.callbacks.onWelcome?.(msg);
          this.callbacks.onPlayers?.(this.players, this.hostId);
          break;
        }
        case "players":
          this.players = msg.players || [];
          this.hostId = msg.hostId || this.hostId;
          this.callbacks.onPlayers?.(this.players, this.hostId);
          break;
        case "state":
          this.callbacks.onState?.(msg);
          break;
        case "start": {
          this.started = true;
          this.startAt = msg.startAt;
          this.duration = msg.duration || 90;
          this.seed = msg.seed;
          this.hostId = msg.hostId || this.hostId;
          if (msg.players) this.players = msg.players;
          this.serverOffset = (msg.serverTime || Date.now()) - Date.now();
          this.callbacks.onStart?.(msg);
          this.callbacks.onPlayers?.(this.players, this.hostId);
          break;
        }
        case "reset":
          this.started = false;
          this.startAt = 0;
          if (msg.players) this.players = msg.players;
          this.hostId = msg.hostId || this.hostId;
          this.callbacks.onReset?.(msg);
          this.callbacks.onPlayers?.(this.players, this.hostId);
          break;
        case "error":
          this.callbacks.onError?.(msg.message || "Connection error.");
          this.callbacks.onStatus?.("Connection issue", "error");
          break;
        case "pong": {
          const now = Date.now();
          const rtt = Math.max(0, now - (msg.t || now));
          const estimate = (msg.serverTime || now) + rtt / 2;
          this.serverOffset = estimate - now;
          break;
        }
        default:
          break;
      }
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.callbacks.onStatus?.("Connection error", "error");
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.connected = false;
      this.callbacks.onStatus?.("Disconnected", "offline");
      this.callbacks.onClose?.();
      if (!this.manualClose && this.desired) {
        this.reconnectTimer = setTimeout(() => this.open(), 1800);
      }
    };
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  start(seed = Date.now()) {
    return this.send({ type: "start", seed: seed >>> 0 });
  }

  sendState(data) {
    const now = performance.now();
    if (now - this.lastStateAt < 85) return;
    this.lastStateAt = now;
    this.send({ type: "state", ...data });
  }

  leave() {
    this.desired = null;
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignored */ }
    }
    this.ws = null;
    this.connected = false;
    this.started = false;
    this.room = null;
    this.hostId = null;
    this.players = [];
    this.callbacks.onStatus?.("Not connected", "idle");
    this.callbacks.onPlayers?.([], null);
  }
}
