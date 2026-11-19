import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_COLORS = ["#ff9f1c", "#20e3b2", "#ff4d6d", "#8b7cff", "#4cc9f0", "#f7d154"];
const RUN_DURATION = 90;
const CITY_IDS = new Set(["mumbai", "delhi", "gurugram", "india"]);
const CITY_ALIASES = {
  mumbai: "mumbai", bombay: "mumbai",
  delhi: "delhi", dilli: "delhi", newdelhi: "delhi", ncr: "delhi",
  guru: "gurugram", gurgaon: "gurugram", gurugram: "gurugram", cybercity: "gurugram",
  india: "india", bharat: "india", ind: "india", tour: "india", highway: "india",
  indiatour: "india", panindia: "india",
};
const OPEN = WebSocket.OPEN;
const rooms = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const now = () => Date.now();

function roomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || "RIDER")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .slice(0, 14) || "RIDER";
}

function cleanCity(value, fallback = "mumbai") {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!key) return fallback;
  if (CITY_IDS.has(key)) return key;
  return CITY_ALIASES[key] || fallback;
}

function send(ws, payload) {
  if (ws.readyState === OPEN) ws.send(JSON.stringify(payload));
}

function publicPlayers(room) {
  return [...room.clients.values()].map((client) => ({
    id: client.id,
    name: client.name,
    color: client.color,
    score: client.score || 0,
    gates: client.gates || 0,
    alive: client.alive !== false,
    host: client.id === room.hostId,
    city: client.city || room.city || "mumbai",
  }));
}

function broadcast(room, payload, exceptId) {
  const encoded = JSON.stringify(payload);
  for (const client of room.clients.values()) {
    if (client.id !== exceptId && client.readyState === OPEN) client.send(encoded);
  }
}

function broadcastPlayers(room) {
  broadcast(room, { type: "players", hostId: room.hostId, players: publicPlayers(room) });
}

function createRoom(host) {
  const code = roomCode();
  const room = {
    code,
    hostId: host.id,
    clients: new Map(),
    started: false,
    startAt: 0,
    duration: RUN_DURATION,
    seed: Math.floor(Math.random() * 1e9),
    city: host.city || "mumbai",
    scoreboardTimer: null,
  };
  rooms.set(code, room);
  room.scoreboardTimer = setInterval(() => {
    if (room.clients.size) broadcastPlayers(room);
  }, 1000);
  return room;
}

function disposeRoom(code) {
  const room = rooms.get(code);
  if (!room || room.clients.size) return;
  if (room.scoreboardTimer) clearInterval(room.scoreboardTimer);
  rooms.delete(code);
}

function leave(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  room.clients.delete(ws.id);
  if (room.hostId === ws.id) room.hostId = room.clients.keys().next().value || null;
  if (room.clients.size) {
    broadcast(room, { type: "players", hostId: room.hostId, players: publicPlayers(room) });
  } else {
    room.started = false;
    disposeRoom(room.code);
  }
  ws.roomCode = null;
}

function startRun(ws, room, requestedSeed, requestedCity) {
  if (ws.id !== room.hostId) {
    send(ws, { type: "error", message: "Only the room host can start the run." });
    return;
  }
  room.started = true;
  room.duration = RUN_DURATION;
  room.startAt = now() + 1600;
  room.seed = Number.isFinite(Number(requestedSeed)) ? Math.floor(Number(requestedSeed)) : Math.floor(Math.random() * 1e9);
  room.city = cleanCity(requestedCity, room.city);
  for (const client of room.clients.values()) {
    client.score = 0;
    client.gates = 0;
    client.alive = true;
  }
  broadcast(room, {
    type: "start",
    seed: room.seed,
    city: room.city,
    startAt: room.startAt,
    serverTime: now(),
    duration: room.duration,
    hostId: room.hostId,
    players: publicPlayers(room),
  });
  broadcastPlayers(room);
}

export function attachNetwork(httpServer, { path = "/net" } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  httpServer.on("upgrade", (request, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      pathname = "/";
    }
    if (pathname !== path) return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (ws) => {
    ws.id = randomUUID().slice(0, 8);
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "hello") {
        if (ws.roomCode) return;
        const requested = String(msg.room || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
        ws.city = cleanCity(msg.city);
        let room;
        if (msg.create || !requested) {
          room = createRoom(ws);
        } else {
          room = rooms.get(requested);
          if (!room) {
            send(ws, { type: "error", message: "Room not found. Ask the host for a fresh invite." });
            return;
          }
        }
        if (room.clients.size >= 8) {
          send(ws, { type: "error", message: "That room is full (8 riders max)." });
          if (!room.clients.size) disposeRoom(room.code);
          return;
        }
        ws.city = room.city || cleanCity(msg.city);
        ws.name = cleanName(msg.name);
        ws.color = PLAYER_COLORS[room.clients.size % PLAYER_COLORS.length];
        ws.score = 0;
        ws.gates = 0;
        ws.alive = true;
        ws.roomCode = room.code;
        room.clients.set(ws.id, ws);
        if (!room.hostId) room.hostId = ws.id;
        send(ws, {
          type: "welcome",
          id: ws.id,
          room: room.code,
          hostId: room.hostId,
          players: publicPlayers(room),
          started: room.started,
          startAt: room.startAt,
          serverTime: now(),
          seed: room.seed,
          city: room.city,
          duration: room.duration,
        });
        broadcastPlayers(room);
        if (room.started && room.startAt) {
          send(ws, {
            type: "start",
            seed: room.seed,
            city: room.city,
            startAt: room.startAt,
            serverTime: now(),
            duration: room.duration,
            hostId: room.hostId,
            players: publicPlayers(room),
          });
        }
        return;
      }

      const room = rooms.get(ws.roomCode);
      if (!room) return;

      switch (msg.type) {
        case "state": {
          if (!room.started) break;
          ws.score = clamp(Math.round(Number(msg.score) || 0), 0, 9999999);
          ws.gates = clamp(Math.round(Number(msg.gates) || 0), 0, 999);
          ws.alive = msg.alive !== false;
          broadcast(room, {
            type: "state",
            id: ws.id,
            name: ws.name,
            color: ws.color,
            x: clamp(Number(msg.x) || 0, -1000, 1000),
            z: clamp(Number(msg.z) || 0, -1000, 1000),
            y: clamp(Number(msg.y) || 0, -10, 30),
            yaw: Number(msg.yaw) || 0,
            speed: Number(msg.speed) || 0,
            drift: !!msg.drift,
            boost: !!msg.boost,
            score: ws.score,
            gates: ws.gates,
            combo: Number(msg.combo) || 1,
            alive: ws.alive,
            t: now(),
          }, ws.id);
          break;
        }
        case "start":
          startRun(ws, room, msg.seed, msg.city);
          break;
        case "reset":
          if (ws.id === room.hostId) {
            room.started = false;
            room.startAt = 0;
            broadcast(room, { type: "reset", hostId: room.hostId, players: publicPlayers(room) });
          }
          break;
        case "ping":
          send(ws, { type: "pong", t: msg.t, serverTime: now() });
          break;
        default:
          break;
      }
    });

    ws.on("close", () => leave(ws));
    ws.on("error", () => leave(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignored */ }
    }
  }, 20000);
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
