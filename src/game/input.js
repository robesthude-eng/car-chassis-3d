/**
 * Ввод: клавиатура для десктопа, тач-зоны и гироскоп для Android.
 * Все касания идут через Pointer Events, чтобы не ловить двойные события.
 */

export class InputController {
  constructor(root = document) {
    this.root = root;
    this.state = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: 0,
      gearUp: false,
      gearDown: false,
    };
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.tilt = { enabled: false, value: 0, calibration: 0 };
    this.mode = "keyboard";
    this._bound = [];
    this.attach();
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._bound.push([target, type, fn]);
  }

  attach() {
    this.on(window, "keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "KeyR") this.onReset?.();
      if (e.code === "ShiftLeft") this.state.gearUp = true;
      if (e.code === "ControlLeft") this.state.gearDown = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      this.mode = "keyboard";
    });
    this.on(window, "keyup", (e) => this.keys.delete(e.code));
    this.on(window, "blur", () => {
      this.keys.clear();
      this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    });
  }

  /** Привязка экранных кнопок: элемент с data-control. */
  bindTouchControls(container) {
    if (!container) return;
    const active = new Map();

    const set = (control, value) => {
      if (control === "steerLeft") this.touch.steer = -value;
      else if (control === "steerRight") this.touch.steer = value;
      else if (control in this.touch) this.touch[control] = value;
      if (value > 0) this.mode = "touch";
    };

    for (const el of container.querySelectorAll("[data-control]")) {
      const control = el.dataset.control;
      el.style.touchAction = "none";

      const down = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        active.set(e.pointerId, control);
        el.classList.add("is-pressed");
        if (control === "gearUp" || control === "gearDown") this.state[control] = true;
        else set(control, 1);
      };
      const up = (e) => {
        if (!active.has(e.pointerId)) return;
        active.delete(e.pointerId);
        el.classList.remove("is-pressed");
        if (control !== "gearUp" && control !== "gearDown") set(control, 0);
      };

      this.on(el, "pointerdown", down);
      this.on(el, "pointerup", up);
      this.on(el, "pointercancel", up);
      this.on(el, "lostpointercapture", up);
    }
  }

  /** Наклон устройства как руль — просят почти все мобильные гонки. */
  async enableTilt() {
    if (typeof DeviceOrientationEvent === "undefined") return false;
    const req = DeviceOrientationEvent.requestPermission;
    if (typeof req === "function") {
      try {
        const res = await req();
        if (res !== "granted") return false;
      } catch {
        return false;
      }
    }
    this.on(window, "deviceorientation", (e) => {
      const raw = (e.gamma ?? 0) / 32;
      this.tilt.value = Math.max(-1, Math.min(1, raw - this.tilt.calibration));
      if (this.tilt.enabled) this.mode = "tilt";
    });
    this.tilt.enabled = true;
    return true;
  }

  calibrateTilt() {
    this.tilt.calibration += this.tilt.value;
  }

  disableTilt() {
    this.tilt.enabled = false;
    this.tilt.value = 0;
  }

  sample() {
    const k = this.keys;
    const kThrottle = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const kBrake = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const kLeft = k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0;
    const kRight = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;
    const kHand = k.has("Space") ? 1 : 0;

    const steerTilt = this.tilt.enabled ? this.tilt.value : 0;
    const steer = kRight - kLeft || this.touch.steer || steerTilt;

    const out = {
      throttle: Math.max(kThrottle, this.touch.throttle),
      brake: Math.max(kBrake, this.touch.brake),
      steer: Math.max(-1, Math.min(1, steer)),
      handbrake: Math.max(kHand, this.touch.handbrake),
      gearUp: this.state.gearUp,
      gearDown: this.state.gearDown,
    };
    this.state.gearUp = false;
    this.state.gearDown = false;
    return out;
  }

  dispose() {
    for (const [t, type, fn] of this._bound) t.removeEventListener(type, fn);
    this._bound = [];
  }
}
