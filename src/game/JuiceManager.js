const PRESETS = Object.freeze({
  LIGHT: { duration: 30, shake: 0.0035, flash: false, zoom: 1.006 },
  MEDIUM: { duration: 44, shake: 0.006, flash: true, zoom: 1.009 },
  HEAVY: { duration: 62, shake: 0.0095, flash: true, zoom: 1.012 },
  LEGENDARY: { duration: 82, shake: 0.013, flash: true, zoom: 1.017, shockwave: true },
});

export class JuiceManager {
  constructor(scene) {
    this.scene = scene;
    this.hitStopUntil = 0;
    this.restoreZoomTimer = null;
  }

  intensityScale() {
    const setting = String(this.scene?.state?.settings?.effectIntensity || 'NORMAL').toUpperCase();
    return setting === 'BAIXA' ? 0.62 : setting === 'ALTA' ? 1.15 : 1;
  }

  shake(duration = 150, intensity = 0.006) {
    const scale = this.intensityScale();
    this.scene.cameras.main.shake(Math.min(650, duration * scale), Math.min(0.018, intensity * scale), true);
  }

  flash(color = { r: 255, g: 255, b: 255 }, duration = 120, alpha = 0.08) {
    const scale = this.intensityScale();
    this.scene.cameras.main.flash(Math.min(420, duration * scale), color.r, color.g, color.b, false, undefined, Math.min(0.16, alpha * scale));
  }

  hitStop(duration = 48, strength = 0.015, zoom = 1.012) {
    const scale = this.intensityScale();
    const safeDuration = Math.min(90, Math.max(0, duration * scale));
    this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + safeDuration);
    this.shake(Math.max(70, safeDuration * 2), Math.min(0.016, strength));
    const camera = this.scene.cameras.main;
    camera.setZoom(Math.min(1.02, 1 + (zoom - 1) * scale));
    clearTimeout(this.restoreZoomTimer);
    this.restoreZoomTimer = setTimeout(() => {
      if (!camera?.scene) return;
      camera.setZoom(1);
    }, safeDuration + 35);
  }

  isHitStopped() {
    return performance.now() < this.hitStopUntil;
  }

  impact({ duration = 52, shake = 0.008, flash = false, color = { r: 255, g: 66, b: 107 }, zoom = 1.012 } = {}) {
    this.hitStop(duration, shake, zoom);
    if (flash) this.flash(color, 100, 0.09);
  }

  preset(name = 'LIGHT', color = { r: 255, g: 255, b: 255 }) {
    const preset = PRESETS[String(name).toUpperCase()] || PRESETS.LIGHT;
    if (name === 'LIGHT') {
      this.shake(100, preset.shake);
      return preset;
    }
    this.hitStop(preset.duration, preset.shake, preset.zoom);
    if (preset.flash) this.flash(color, name === 'LEGENDARY' ? 170 : 110, name === 'LEGENDARY' ? 0.12 : 0.08);
    return preset;
  }

  bossPhase(phase = 1) {
    if (phase >= 3) this.preset('LEGENDARY', { r: 255, g: 45, b: 100 });
    else if (phase === 2) this.preset('HEAVY', { r: 255, g: 138, b: 43 });
    else this.preset('MEDIUM', { r: 196, g: 85, b: 255 });
  }

  destroy() {
    clearTimeout(this.restoreZoomTimer);
    this.scene?.cameras?.main?.setZoom?.(1);
  }
}

export const juicePresets = PRESETS;
