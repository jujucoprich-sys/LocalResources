// Space background and floating UI.
//  - A starfield in three depths that drifts as the cursor moves (or the
//    page scrolls, on phones), with twinkles and the odd shooting star.
//  - A trail of stardust and a soft glow follow the cursor.
//  - --mx / --my (-1..1) on <html> let CSS layers and the page float.
//  - Cards, tiles and panels marked tiltable lean toward the cursor.
// Everything is decoration: with "reduce motion" on, the stars stay still.
(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia?.("(pointer: fine)").matches;
  const canvas = document.getElementById("stars");
  const glow = document.getElementById("cursor-glow");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const COLORS = ["255,255,255", "255,236,190", "200,214,255"];

  let w = 0;
  let h = 0;
  let stars = [];
  const dust = [];
  let shooting = null;
  let nextShot = performance.now() + 4000;

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(420, Math.round((w * h) / 4200));
    stars = Array.from({ length: count }, () => {
      const depth = [0.25, 0.55, 1][Math.floor(Math.random() * 3)];
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 0.9 + 0.35) * (0.6 + depth * 0.7),
        depth,
        base: 0.35 + Math.random() * 0.5,
        speed: 0.6 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        color: COLORS[Math.random() < 0.7 ? 0 : Math.random() < 0.5 ? 1 : 2],
      };
    });
  }

  // Cursor (or scroll) target, eased toward every frame.
  let tx = 0;
  let ty = 0;
  let mx = 0;
  let my = 0;
  let px = w / 2;
  let py = h / 2;
  let gx = px;
  let gy = py;
  let lastDust = 0;

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    tx = (e.clientX / w) * 2 - 1;
    ty = (e.clientY / h) * 2 - 1;
    px = e.clientX;
    py = e.clientY;
    const now = performance.now();
    if (!reduce && now - lastDust > 22) {
      lastDust = now;
      dust.push({ x: px, y: py, vx: (Math.random() - 0.5) * 0.6, vy: -0.25 - Math.random() * 0.5, life: 1, r: 0.8 + Math.random() * 1.6 });
      if (dust.length > 60) dust.shift();
    }
    tilt(e);
  }, { passive: true });
  if (!fine) {
    // Phones: the scroll position drives a gentle drift instead.
    window.addEventListener("scroll", () => {
      ty = Math.max(-1, Math.min(1, (window.scrollY / Math.max(1, document.body.scrollHeight - h)) * 2 - 1));
    }, { passive: true });
  }

  // Lean the card under the cursor toward it, a few degrees at most.
  let tilted = null;
  const TILTABLE = ".card, .tile, .glass[data-tilt], .near, .online-card";
  function tilt(e) {
    if (reduce) return;
    const elx = e.target.closest?.(TILTABLE);
    if (tilted && tilted !== elx) {
      tilted.style.removeProperty("--rx");
      tilted.style.removeProperty("--ry");
      tilted.style.removeProperty("--gx");
      tilted.style.removeProperty("--gy");
    }
    tilted = elx;
    if (!elx) return;
    const b = elx.getBoundingClientRect();
    const nx = (e.clientX - b.left) / b.width - 0.5;
    const ny = (e.clientY - b.top) / b.height - 0.5;
    const max = b.height > 360 ? 1.5 : 5;
    elx.style.setProperty("--ry", `${(nx * max).toFixed(2)}deg`);
    elx.style.setProperty("--rx", `${(-ny * max).toFixed(2)}deg`);
    elx.style.setProperty("--gx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    elx.style.setProperty("--gy", `${((ny + 0.5) * 100).toFixed(1)}%`);
  }
  document.addEventListener("pointerleave", () => {
    tx = 0;
    ty = 0;
  });

  function frame(now) {
    mx += (tx - mx) * 0.06;
    my += (ty - my) * 0.06;
    gx += (px - gx) * 0.18;
    gy += (py - gy) * 0.18;
    root.style.setProperty("--mx", mx.toFixed(4));
    root.style.setProperty("--my", my.toFixed(4));
    if (glow) glow.style.transform = `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0)`;

    ctx.clearRect(0, 0, w, h);
    const t = now / 1000;
    for (const s of stars) {
      // Nearer stars move more: that's the depth.
      const x = (((s.x - mx * 40 * s.depth) % w) + w) % w;
      const y = (((s.y - my * 40 * s.depth) % h) + h) % h;
      const a = reduce ? s.base : s.base + Math.sin(t * s.speed + s.phase) * 0.3;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${s.color},${Math.max(0.08, Math.min(1, a)).toFixed(3)})`;
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.x += d.vx;
      d.y += d.vy;
      d.life -= 0.022;
      if (d.life <= 0) {
        dust.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,214,120,${(d.life * 0.8).toFixed(3)})`;
      ctx.arc(d.x, d.y, d.r * d.life + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!reduce) {
      if (!shooting && now > nextShot) {
        shooting = { x: Math.random() * w * 0.7 + w * 0.2, y: Math.random() * h * 0.35, life: 1 };
        nextShot = now + 6000 + Math.random() * 9000;
      }
      if (shooting) {
        const s = shooting;
        s.x -= 9;
        s.y += 4;
        s.life -= 0.02;
        const grad = ctx.createLinearGradient(s.x, s.y, s.x + 90, s.y - 40);
        grad.addColorStop(0, `rgba(255,240,200,${s.life.toFixed(3)})`);
        grad.addColorStop(1, "rgba(255,240,200,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + 90, s.y - 40);
        ctx.stroke();
        if (s.life <= 0) shooting = null;
      }
    }
    if (!reduce) requestAnimationFrame(frame);
  }

  resize();
  px = gx = w / 2;
  py = gy = h * 0.35;
  window.addEventListener("resize", resize);
  if (fine && !reduce) document.body.classList.add("has-cursor");
  requestAnimationFrame(frame);
})();
