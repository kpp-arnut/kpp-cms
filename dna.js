(function () {
  function init() {
  const canvas = document.getElementById('dna-canvas');
  if (!canvas) return;

  const wrap = canvas.parentElement;
  const ctx = canvas.getContext('2d');

  let animationId = null;
  let t = 0;
  let isRunning = false;

  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  function render() {
    const rect = wrap.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;

    ctx.clearRect(0, 0, W, H);

    const DOTS = Math.max(16, Math.floor(H / 42));
    const SPACING = H / Math.max(1, DOTS - 1);
    const AMPLITUDE = Math.min(W * 0.34, 38);
    const PERIOD = H * 0.65;

    const dots = [];

    for (let i = 0; i < DOTS; i++) {
      const y = i * SPACING;
      const angle = (y / PERIOD) * Math.PI * 2 + t;

      dots.push({
        y,
        x1: cx + Math.cos(angle) * AMPLITUDE,
        z1: Math.sin(angle),
        x2: cx + Math.cos(angle + Math.PI) * AMPLITUDE,
        z2: Math.sin(angle + Math.PI)
      });
    }

    for (const { y, x1, x2, z1, z2 } of dots) {
      if (Math.abs(z1 - z2) < 0.4) {
        const a = 0.08 + (1 - Math.abs(z1 - z2) / 0.4) * 0.12;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.strokeStyle = `rgba(180,180,210,${a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    const all = [];
    for (const { y, x1, x2, z1, z2 } of dots) {
      all.push({ x: x1, y, z: z1, strand: 1 });
      all.push({ x: x2, y, z: z2, strand: 2 });
    }

    all.sort((a, b) => a.z - b.z);

    for (const d of all) {
      const dep = (d.z + 1) / 2;
      const radius = 4 + dep * 7;

      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);

      ctx.fillStyle = d.strand === 1
        ? `rgba(224,224,240,${0.2 + dep * 0.75})`
        : `rgba(255,255,255,${0.12 + dep * 0.5})`;

      ctx.shadowColor = d.strand === 1
        ? 'rgba(224,224,240,0.55)'
        : 'rgba(255,255,255,0.35)';
      ctx.shadowBlur = dep * 12;

      ctx.fill();
      ctx.shadowBlur = 0;
    }

    t += 0.018;
    animationId = requestAnimationFrame(render);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    resizeCanvas();
    render();
  }

  function stop() {
    if (!isRunning) return;
    cancelAnimationFrame(animationId);
    animationId = null;
    isRunning = false;
  }

  const mediaReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function handleMotionPreference() {
    if (mediaReducedMotion.matches) {
      stop();
      resizeCanvas();
      renderStaticFrame();
    } else {
      start();
    }
  }

  function renderStaticFrame() {
    const rect = wrap.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;

    ctx.clearRect(0, 0, W, H);

    const DOTS = Math.max(16, Math.floor(H / 42));
    const SPACING = H / Math.max(1, DOTS - 1);
    const AMPLITUDE = Math.min(W * 0.34, 38);
    const PERIOD = H * 0.65;

    const dots = [];

    for (let i = 0; i < DOTS; i++) {
      const y = i * SPACING;
      const angle = (y / PERIOD) * Math.PI * 2;

      dots.push({
        y,
        x1: cx + Math.cos(angle) * AMPLITUDE,
        z1: Math.sin(angle),
        x2: cx + Math.cos(angle + Math.PI) * AMPLITUDE,
        z2: Math.sin(angle + Math.PI)
      });
    }

    for (const { y, x1, x2, z1, z2 } of dots) {
      if (Math.abs(z1 - z2) < 0.4) {
        const a = 0.08 + (1 - Math.abs(z1 - z2) / 0.4) * 0.12;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.strokeStyle = `rgba(180,180,210,${a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    const all = [];
    for (const { y, x1, x2, z1, z2 } of dots) {
      all.push({ x: x1, y, z: z1, strand: 1 });
      all.push({ x: x2, y, z: z2, strand: 2 });
    }

    all.sort((a, b) => a.z - b.z);

    for (const d of all) {
      const dep = (d.z + 1) / 2;
      const radius = 4 + dep * 7;

      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);

      ctx.fillStyle = d.strand === 1
        ? `rgba(224,224,240,${0.2 + dep * 0.75})`
        : `rgba(255,255,255,${0.12 + dep * 0.5})`;

      ctx.fill();
    }
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeCanvas();
    }, 100);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
    } else if (!mediaReducedMotion.matches) {
      start();
    }
  });

  if (typeof mediaReducedMotion.addEventListener === 'function') {
    mediaReducedMotion.addEventListener('change', handleMotionPreference);
  } else if (typeof mediaReducedMotion.addListener === 'function') {
    mediaReducedMotion.addListener(handleMotionPreference);
  }

      handleMotionPreference();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    requestAnimationFrame(init);
  }
})();




