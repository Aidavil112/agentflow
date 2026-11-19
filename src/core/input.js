import { clamp, isTouchDevice, vibrate } from "./utils.js";

const PREVENT_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
]);

export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = new Map();
    this.enabled = false;
    this.hasTouch = isTouchDevice();
    this.touch = { throttle: false, brake: false, drift: false, boost: false };
    this.touchSteer = 0;
    this.touchThrottle = 0;
    this.touchBrake = 0;
    this.pointerId = null;
    this.boundButtons = [];

    if (this.hasTouch) document.body.classList.add("has-touch");
    this.bindKeyboard();
    this.bindJoystick();
    this.bindButtons();
  }

  onKey(code, handler) {
    if (!this.handlers.has(code)) this.handlers.set(code, []);
    this.handlers.get(code).push(handler);
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!enabled) this.clear();
  }

  bindKeyboard() {
    window.addEventListener("keydown", (event) => {
      if (PREVENT_KEYS.has(event.code)) event.preventDefault();
      if (event.repeat) return;
      this.keys.add(event.code);
      const callbacks = this.handlers.get(event.code);
      if (callbacks) callbacks.forEach((callback) => callback(event));
    }, { passive: false });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener("blur", () => this.clear());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clear();
    });
  }

  bindJoystick() {
    const joystick = document.getElementById("joystick");
    const knob = document.getElementById("joystick-knob");
    if (!joystick || !knob) return;

    const update = (event) => {
      const rect = joystick.getBoundingClientRect();
      const radius = rect.width * 0.36;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = event.clientX - cx;
      let dy = event.clientY - cy;
      const length = Math.hypot(dx, dy);
      if (length > radius) {
        dx = (dx / length) * radius;
        dy = (dy / length) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchSteer = clamp(dx / radius, -1, 1);
      this.touchThrottle = clamp(-dy / radius, 0, 1);
      this.touchBrake = clamp(dy / radius, 0, 1);
    };

    const release = (event) => {
      if (this.pointerId !== null && event?.pointerId !== undefined && event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.touchSteer = 0;
      this.touchThrottle = 0;
      this.touchBrake = 0;
      knob.style.transform = "translate(0px, 0px)";
    };

    joystick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.pointerId = event.pointerId;
      try { joystick.setPointerCapture(event.pointerId); } catch { /* optional */ }
      update(event);
      vibrate(6);
    });
    joystick.addEventListener("pointermove", (event) => {
      if (this.pointerId !== event.pointerId) return;
      event.preventDefault();
      update(event);
    });
    joystick.addEventListener("pointerup", release);
    joystick.addEventListener("pointercancel", release);
    joystick.addEventListener("lostpointercapture", release);
  }

  bindButtons() {
    const bindings = [
      ["btn-throttle", "throttle"],
      ["btn-brake", "brake"],
      ["btn-drift", "drift"],
      ["btn-boost", "boost"],
    ];
    for (const [id, key] of bindings) {
      const button = document.getElementById(id);
      if (!button) continue;
      const press = (event) => {
        event.preventDefault();
        this.touch[key] = true;
        button.classList.add("pressed");
        try { button.setPointerCapture(event.pointerId); } catch { /* optional */ }
        vibrate(7);
      };
      const release = () => {
        this.touch[key] = false;
        button.classList.remove("pressed");
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      this.boundButtons.push({ button, key });
    }
  }

  clear() {
    this.keys.clear();
    this.touch.throttle = false;
    this.touch.brake = false;
    this.touch.drift = false;
    this.touch.boost = false;
    this.touchSteer = 0;
    this.touchThrottle = 0;
    this.touchBrake = 0;
    this.pointerId = null;
    const knob = document.getElementById("joystick-knob");
    if (knob) knob.style.transform = "translate(0px, 0px)";
    for (const { button } of this.boundButtons) button.classList.remove("pressed");
  }

  getControls() {
    if (!this.enabled) return { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
    const keyboardSteer =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const throttleKey = this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0;
    const brakeKey = this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0;
    return {
      steer: clamp(keyboardSteer + this.touchSteer, -1, 1),
      throttle: Math.max(throttleKey, this.touchThrottle, this.touch.throttle ? 1 : 0),
      brake: Math.max(brakeKey, this.touchBrake, this.touch.brake ? 1 : 0),
      drift: this.keys.has("Space") || this.touch.drift,
      boost: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touch.boost,
    };
  }
}
