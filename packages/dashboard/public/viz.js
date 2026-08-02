import { createMoodBackground } from "./mood-background.js";

const audioConnections = new WeakMap();

/**
 * @param {{ canvas: HTMLCanvasElement, audio: HTMLAudioElement, logoGlow?: HTMLElement | null, container?: HTMLElement | null, audioHook?: () => { audioContext: AudioContext, analyser: AnalyserNode } | null }} options
 */
export function createVisualizer({ canvas, audio, logoGlow, container, audioHook }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D canvas context");
  }

  const BAR_COUNT = 96;
  let width = 0;
  let height = 0;
  let centerX = 0;
  let centerY = 0;
  let innerRadius = 0;
  let maxBarLength = 0;

  let audioContext = null;
  let analyser = null;
  let frequencyData = null;
  let timeData = null;

  let bassSmooth = 0;
  let beatPulse = 0;
  let idlePhase = 0;
  let particles = [];
  let running = false;
  let renderTimeSec = 0;
  const moodBackground = createMoodBackground();

  function updateLayoutMetrics() {
    centerX = width / 2;
    centerY = height / 2;
    const base = Math.min(width, height);
    innerRadius = base * 0.24;
    maxBarLength = base * 0.17;
  }

  function resize() {
    const rect = (container ?? canvas).getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
    const nextHeight = Math.max(1, Math.floor(rect.height * dpr));

    if (nextWidth === width && nextHeight === height) {
      return;
    }

    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    updateLayoutMetrics();
  }

  function connectAudio() {
    const external = audioHook?.();
    if (external?.audioContext && external?.analyser) {
      audioContext = external.audioContext;
      analyser = external.analyser;
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.frequencyBinCount);
      return;
    }

    if (audioConnections.has(audio)) {
      const existing = audioConnections.get(audio);
      audioContext = existing.audioContext;
      analyser = existing.analyser;
      frequencyData = existing.frequencyData;
      timeData = existing.timeData;
      return;
    }

    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;

    const sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);

    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.frequencyBinCount);
    audioConnections.set(audio, {
      audioContext,
      analyser,
      frequencyData,
      timeData,
    });
  }

  async function resume() {
    connectAudio();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  }

  function isLive() {
    if (audioHook?.()) {
      if (!analyser || audioContext?.state !== "running" || !frequencyData) {
        return false;
      }
      analyser.getByteFrequencyData(frequencyData);
      let sum = 0;
      for (let i = 0; i < 32; i += 1) sum += frequencyData[i];
      return sum > 8;
    }

    return Boolean(
      analyser &&
        audioContext?.state === "running" &&
        !audio.paused &&
        !audio.ended &&
        frequencyData,
    );
  }

  function sampleLevel(startBin, endBin) {
    if (!frequencyData) return 0;
    let sum = 0;
    for (let i = startBin; i <= endBin; i += 1) {
      sum += frequencyData[i];
    }
    return sum / ((endBin - startBin + 1) * 255);
  }

  function spawnParticles(intensity) {
    const count = Math.floor(4 + intensity * 14);
    for (let i = 0; i < count; i += 1) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: innerRadius + Math.random() * maxBarLength * 0.25,
        speed: 1.2 + Math.random() * 2.5,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        size: 1.5 + Math.random() * 3 * intensity,
      });
    }
  }

  function drawBackground() {
    moodBackground.draw(ctx, width, height, renderTimeSec, bassSmooth);

    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      innerRadius * 0.15,
      centerX,
      centerY,
      Math.max(width, height) * 0.55,
    );
    gradient.addColorStop(0, `rgba(255, 255, 255, ${0.02 + bassSmooth * 0.06})`);
    gradient.addColorStop(0.5, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.25)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function setMood(mood) {
    moodBackground.setMood(mood);
  }

  function mapBarToBinRange(i, barCount, binCount) {
    const minBin = 2;
    const maxBin = Math.max(minBin + 1, Math.floor(binCount * 0.72));
    const t0 = i / barCount;
    const t1 = (i + 1) / barCount;
    const logMin = Math.log(minBin);
    const logMax = Math.log(maxBin);
    const binStart = Math.floor(Math.exp(logMin + t0 * (logMax - logMin)));
    const binEnd = Math.max(
      binStart,
      Math.floor(Math.exp(logMin + t1 * (logMax - logMin))) - 1,
    );
    return { binStart, binEnd: Math.min(maxBin - 1, binEnd) };
  }

  function sampleBarLevel(binStart, binEnd) {
    if (!frequencyData) return 0;
    let sum = 0;
    let count = 0;
    for (let b = binStart; b <= binEnd; b += 1) {
      sum += frequencyData[b];
      count += 1;
    }
    return count > 0 ? sum / (count * 255) : 0;
  }

  function compressLevel(raw) {
    return Math.min(0.75, Math.pow(raw, 0.9) * 0.58);
  }

  function drawCircularBars(live) {
    const binCount = frequencyData?.length ?? 0;
    const lineScale = Math.max(1, Math.min(width, height) / 540);
    const levels = new Array(BAR_COUNT);

    for (let i = 0; i < BAR_COUNT; i += 1) {
      if (live && binCount > 0) {
        const { binStart, binEnd } = mapBarToBinRange(i, BAR_COUNT, binCount);
        levels[i] = compressLevel(sampleBarLevel(binStart, binEnd));
      } else {
        levels[i] =
          0.08 +
          0.06 * Math.sin(idlePhase * 1.4 + i * 0.22) +
          0.04 * Math.sin(idlePhase * 0.7 + i * 0.08);
      }
    }

    for (let i = 0; i < BAR_COUNT; i += 1) {
      const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
      const level = levels[i];
      const barLength = maxBarLength * level;
      const x1 = centerX + Math.cos(angle) * innerRadius;
      const y1 = centerY + Math.sin(angle) * innerRadius;
      const x2 = centerX + Math.cos(angle) * (innerRadius + barLength);
      const y2 = centerY + Math.sin(angle) * (innerRadius + barLength);

      const hueShift = i / BAR_COUNT;
      const alpha = 0.25 + level * 0.75;
      ctx.strokeStyle = `rgba(${Math.floor(220 + hueShift * 35)}, ${Math.floor(
        235 + hueShift * 20,
      )}, 255, ${alpha})`;
      ctx.lineWidth = (1.5 + level * 1.2) * lineScale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  function drawWaveRing(live) {
    if (!live || !timeData) return;

    ctx.beginPath();
    const points = 180;
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * Math.PI * 2;
      const sample = timeData[Math.floor((i / points) * timeData.length)] / 128 - 1;
      const radius =
        innerRadius -
        innerRadius * 0.11 +
        sample * innerRadius * 0.05 +
        bassSmooth * innerRadius * 0.08;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + bassSmooth * 0.35})`;
    ctx.lineWidth = Math.max(1, Math.min(width, height) / 540);
    ctx.stroke();
  }

  function drawParticles() {
    particles = particles.filter((particle) => particle.life > 0);

    for (const particle of particles) {
      particle.radius += particle.speed;
      particle.life -= particle.decay;

      const x = centerX + Math.cos(particle.angle) * particle.radius;
      const y = centerY + Math.sin(particle.angle) * particle.radius;
      ctx.fillStyle = `rgba(255, 255, 255, ${particle.life * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, particle.size * particle.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFloorReflection(live) {
    if (!live || !frequencyData) return;

    const bars = 64;
    const barWidth = width / bars;
    const baseY = height - height * 0.045;
    const binCount = frequencyData.length;

    for (let i = 0; i < bars; i += 1) {
      const { binStart, binEnd } = mapBarToBinRange(i, bars, binCount);
      const level = compressLevel(sampleBarLevel(binStart, binEnd));
      const barHeight = height * 0.035 + level * height * 0.1;

      const gradient = ctx.createLinearGradient(0, baseY - barHeight, 0, baseY);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.05 + level * 0.5})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(i * barWidth + 4, baseY - barHeight, barWidth - 8, barHeight);
    }
  }

  function updateAudioMetrics(live) {
    renderTimeSec = performance.now() / 1000;

    if (live && analyser) {
      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(timeData);

      const nextBass = sampleLevel(2, 18);
      bassSmooth += (nextBass - bassSmooth) * 0.14;

      if (nextBass > bassSmooth * 1.35 + 0.08) {
        beatPulse = 1;
        spawnParticles(nextBass);
      }
    } else {
      bassSmooth += (0 - bassSmooth) * 0.05;
      idlePhase += 0.02;
    }

    beatPulse *= 0.9;

    if (logoGlow) {
      const glow = 0.35 + bassSmooth * 0.65 + beatPulse * 0.4;
      logoGlow.style.opacity = String(glow);
      logoGlow.style.transform = `scale(${1 + bassSmooth * 0.08 + beatPulse * 0.06})`;
    }
  }

  function render(live) {
    if (width <= 0 || height <= 0) return;

    ctx.clearRect(0, 0, width, height);
    drawBackground();
    drawWaveRing(live);
    drawCircularBars(live);
    drawFloorReflection(live);
    drawParticles();
  }

  function frame() {
    if (!running) return;

    try {
      const live = isLive();
      updateAudioMetrics(live);
      render(live);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => resize())
      : null;

  resizeObserver?.observe(container ?? canvas);
  window.addEventListener("resize", resize);

  audio.addEventListener("play", () => {
    void resume();
  });

  if (audioHook) {
    setInterval(() => {
      if (!analyser) connectAudio();
    }, 500);
  }

  start();
  requestAnimationFrame(resize);

  return { resume, start, stop, resize, setMood };
}
