import "./style.css";
import { Game } from "./core/game.js";

const game = new Game();
window.__MONSOON_DRIFT__ = game;
game.init();

if ("serviceWorker" in navigator) {
  const registerWorker = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("Service worker registration failed; online play still works.", error);
    });
  };
  if (document.readyState === "complete") registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  game.ui.setInstallPrompt(event);
});

window.addEventListener("appinstalled", () => {
  game.ui.el.installBtn.classList.add("hidden");
  game.ui.showToast("Monsoon Drift installed", 2200);
});
