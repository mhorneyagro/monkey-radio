const GENRE_PALETTES = {
  jazz: {
    c1: [255, 148, 72],
    c2: [92, 52, 128],
    c3: [28, 22, 48],
    base: [14, 10, 22],
  },
  synthwave: {
    c1: [255, 46, 160],
    c2: [36, 220, 255],
    c3: [48, 12, 96],
    base: [8, 6, 22],
  },
  lofi: {
    c1: [186, 148, 210],
    c2: [128, 98, 78],
    c3: [62, 48, 88],
    base: [16, 13, 24],
  },
  ambient: {
    c1: [96, 188, 228],
    c2: [58, 82, 148],
    c3: [22, 32, 58],
    base: [8, 12, 20],
  },
  funk: {
    c1: [255, 204, 36],
    c2: [255, 92, 48],
    c3: [92, 28, 68],
    base: [14, 10, 16],
  },
  rock: {
    c1: [228, 72, 58],
    c2: [148, 148, 168],
    c3: [36, 36, 48],
    base: [12, 11, 16],
  },
  default: {
    c1: [91, 140, 255],
    c2: [255, 176, 32],
    c3: [32, 38, 58],
    base: [11, 13, 18],
  },
};

function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function lerpColor(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t);
}

function getPalette(genre) {
  const key = typeof genre === "string" ? genre.toLowerCase() : "";
  return GENRE_PALETTES[key] ?? GENRE_PALETTES.default;
}

/**
 * Procedural genre-tinted background with smooth crossfades.
 */
export function createMoodBackground() {
  let currentGenre = "lofi";
  let targetGenre = "lofi";
  let blend = 1;
  let energy = 5;
  let phase = 0;
  let sweepPhase = 0;
  let lastTimeSec = null;
  let ambientLevel = 0;

  function setMood({ genre, energy: nextEnergy } = {}) {
    if (genre && genre !== targetGenre) {
      if (blend >= 0.99) {
        currentGenre = targetGenre;
      }
      targetGenre = genre;
      blend = 0;
    }
    if (typeof nextEnergy === "number") {
      energy = Math.min(10, Math.max(1, nextEnergy));
    }
  }

  function draw(ctx, width, height, timeSec, bassSmooth = 0) {
    if (width <= 0 || height <= 0) return;

    const deltaSec =
      lastTimeSec == null ? 0 : Math.min(0.033, Math.max(0, timeSec - lastTimeSec));
    lastTimeSec = timeSec;

    blend = Math.min(1, blend + deltaSec * 0.12);
    if (blend >= 1) {
      currentGenre = targetGenre;
    }

    ambientLevel += (bassSmooth - ambientLevel) * 0.025;

    const from = getPalette(currentGenre);
    const to = getPalette(targetGenre);
    const c1 = lerpColor(from.c1, to.c1, blend);
    const c2 = lerpColor(from.c2, to.c2, blend);
    const c3 = lerpColor(from.c3, to.c3, blend);
    const base = lerpColor(from.base, to.base, blend);

    ctx.fillStyle = rgba(base, 1);
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.48;
    const baseSize = Math.max(width, height);
    const driftSpeed = 0.018 + (energy / 10) * 0.012;
    phase += deltaSec * driftSpeed;
    sweepPhase += deltaSec * driftSpeed * 0.35;

    const orbs = [c1, c2, c3];

    for (let i = 0; i < orbs.length; i += 1) {
      const orbit = baseSize * (0.18 + i * 0.08);
      const angleX = phase * (0.62 + i * 0.08) + i * 2.09;
      const angleY = phase * (0.41 + i * 0.06) + i * 1.47;
      const x = cx + Math.cos(angleX) * orbit;
      const y = cy + Math.sin(angleY) * orbit * 0.55;
      const radius = baseSize * (0.42 + i * 0.04);
      const glow = 0.36 + ambientLevel * 0.06;

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, rgba(orbs[i], glow));
      gradient.addColorStop(0.45, rgba(orbs[i], glow * 0.28));
      gradient.addColorStop(1, rgba(orbs[i], 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    const sweepX = cx + Math.cos(sweepPhase) * baseSize * 0.32;
    const sweepY = cy + Math.sin(sweepPhase * 0.78) * baseSize * 0.22;
    const sweep = ctx.createRadialGradient(
      sweepX,
      sweepY,
      0,
      sweepX,
      sweepY,
      baseSize * 0.55,
    );
    sweep.addColorStop(0, rgba(c2, 0.06 + ambientLevel * 0.04));
    sweep.addColorStop(1, rgba(c2, 0));
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, width, height);

    const vignette = ctx.createRadialGradient(
      cx,
      cy,
      baseSize * 0.08,
      cx,
      cy,
      baseSize * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.55, "rgba(0, 0, 0, 0.08)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  return { setMood, draw };
}
