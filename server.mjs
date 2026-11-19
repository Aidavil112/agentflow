import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachNetwork } from "./server/net.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "dist");
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = path.resolve(root, clean || "index.html");
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

function serve(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ status: "ok", service: "monsoon-drift", websocket: "/net" }));
    return;
  }
  if (url.pathname === "/net") {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("WebSocket upgrade required\n");
    return;
  }
  let file = resolveFile(url.pathname);
  if (!file) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Room links and refreshes all fall back to the app shell.
    file = path.join(root, "index.html");
  }
  const ext = path.extname(file).toLowerCase();
  const stream = fs.createReadStream(file);
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}

const server = http.createServer(serve);
attachNetwork(server);
server.listen(port, "0.0.0.0", () => {
  console.log(`Monsoon Drift running at http://0.0.0.0:${port}`);
  console.log(`Multiplayer WebSocket endpoint: /net`);
});
