export const TAU = Math.PI * 2;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function dampAngle(a, b, lambda, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const formatScore = (score) => Math.round(score).toLocaleString("en-IN");
export const formatTime = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const isTouchDevice = () =>
  (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
  (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);

export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* vibration is optional */
  }
}

export function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be disabled; the game still works */
  }
}

const HIGH_SCORE_KEY = "monsoon-drift-highscores-v1";

export function getHighScores() {
  const scores = safeGet(HIGH_SCORE_KEY, []);
  if (!Array.isArray(scores)) return [];
  return scores
    .filter((entry) => entry && Number.isFinite(Number(entry.score)))
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 5);
}

export function saveHighScore(entry) {
  const clean = {
    ...entry,
    name: String(entry.name || "RIDER").slice(0, 14),
    score: Math.max(0, Math.round(Number(entry.score) || 0)),
    date: entry.date || new Date().toISOString(),
  };
  const scores = getHighScores();
  if (clean.score <= 0) return { rank: -1, scores, entry: clean };
  scores.push(clean);
  scores.sort((a, b) => b.score - a.score || new Date(b.date) - new Date(a.date));
  const trimmed = scores.slice(0, 5);
  safeSet(HIGH_SCORE_KEY, trimmed);
  const rank = trimmed.findIndex((item) => item.date === clean.date && item.score === clean.score && item.name === clean.name);
  return { rank, scores: trimmed, entry: clean };
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function cleanName(value) {
  return String(value || "RIDER")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .slice(0, 14) || "RIDER";
}

export function randomColor(rng, palette) {
  return palette[Math.floor(rng() * palette.length)];
}
