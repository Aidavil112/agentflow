import "./style.css";
import { Game } from "./core/game.js";

const game = new Game();
window.__MONSOON_DRIFT__ = game;
game.init();
