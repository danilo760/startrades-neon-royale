export class JuiceManager {
  constructor(scene) {
    this.scene = scene;
    this.hitStopUntil = 0;
    this.restoreZoomTimer = null;
  }

  shake(duration = 150, intensity = 0.006) {
    this.scene.cameras.main.shake(duration, intensity, true);
  }

  flash(color = { r: 255, g: 255, b: 255 }, duration = 120, alpha = 0.08) {
    this.scene.cameras.main.flash(duration, color.r, color.g, color.b, false, undefined, alpha);
  }

  hitStop(duration = 48, strength = 0.015) {
    this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + duration);
    this.shake(Math.max(70, duration * 2), strength);
    const camera = this.scene.cameras.main;
    camera.setZoom(1.012);
    clearTimeout(this.restoreZoomTimer);
    this.restoreZoomTimer = setTimeout(() => {
      if (!camera?.scene) return;
      camera.setZoom(1);
    }, duration + 35);
  }

  isHitStopped() {
    return performance.now() < this.hitStopUntil;
  }

  impact({ duration = 52, shake = 0.008, flash = false, color = { r: 255, g: 66, b: 107 } } = {}) {
    this.hitStop(duration, shake);
    if (flash) this.flash(color, 100, 0.09);
  }

  bossPhase(phase = 1) {
    const intensity = phase === 3 ? 0.014 : phase === 2 ? 0.01 : 0.006;
    this.shake(phase === 3 ? 520 : 360, intensity);
    this.flash(phase === 3 ? { r: 255, g: 45, b: 100 } : { r: 196, g: 85, b: 255 }, 260, 0.11);
  }

  destroy() {
    clearTimeout(this.restoreZoomTimer);
    this.scene?.cameras?.main?.setZoom?.(1);
  }
}
