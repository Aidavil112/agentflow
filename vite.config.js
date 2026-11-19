import { defineConfig } from "vite";
import { attachNetwork } from "./server/net.mjs";

export default defineConfig({
  appType: "spa",
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app", "localhost", "127.0.0.1"],
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app", "localhost", "127.0.0.1"],
  },
  build: {
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  plugins: [
    {
      name: "monsoon-connect-play",
      configureServer(vite) {
        if (vite.httpServer) attachNetwork(vite.httpServer);
      },
      configurePreviewServer(vite) {
        if (vite.httpServer) attachNetwork(vite.httpServer);
      },
    },
  ],
});
