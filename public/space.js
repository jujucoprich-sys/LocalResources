// Sci-fi background and floating UI.
//  - A field of drifting nodes; nearby nodes link up with thin lines, and
//    nodes near the cursor connect to it, like a live network.
//  - The field and the grid drift with the cursor (scroll on phones), in
//    depth: --mx / --my (-1..1) on <html> drive the CSS layers.
//  - A targeting reticle trails the cursor; it locks onto buttons and cards.
//  - Cards, tiles and panels marked tiltable lean toward the cursor.
// Decoration only: with "reduce motion" on, everything holds still.
(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia?.("(pointer: fine)").matches;
  const canvas = document.getElementById("stars");
  const reticle = document.getElementById("reticle");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let w = 0;
  let h = 0;
  let nodes = [];
  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(110, Math.round((w * h) / 16000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      depth: 0.3 + Math.random() * 0.7,
      r: 0.8 + Math.random() * 1.4,
    }));
  }

  let tx = 0;
  let ty = 0;
  let mx = 0;
  let my = 0;
  let px = -999;
  let py = -999;
  let rx = -999;
  let ry = -999;
  let lock = null;

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    tx = (e.clientX / w) * 2 - 1;
    ty = (e.clientY / h) * 2 - 1;
    px = e.clientX;
    py = e.clientY;
    if (rx < -900) {
      rx = px;
      ry = py;
    }
    lock = e.target.closest?.("button, a, input, textarea, .tile, .card");
    tilt(e);
  }, { passive: true });
  document.addEventListener("pointerleave", () => {
    tx = 0;
    ty = 0;
    px = py = -999;
    lock = null;
  });
  if (!fine) {
    window.addEventListener("scroll", () => {
      ty = Math.max(-1, Math.min(1, (window.scrollY / Math.max(1, document.body.scrollHeight - h)) * 2 - 1));
    }, { passive: true });
  }

  let tilted = null;
  const TILTABLE = ".card, .tile, .glass[data-tilt], .near, .online-card";
  function tilt(e) {
    if (reduce) return;
    const elx = e.target.closest?.(TILTABLE);
    if (tilted && tilted !== elx) for (const k of ["--rx", "--ry", "--gx", "--gy"]) tilted.style.removeProperty(k);
    tilted = elx;
    if (!elx) return;
    const b = elx.getBoundingClientRect();
    const nx = (e.clientX - b.left) / b.width - 0.5;
    const ny = (e.clientY - b.top) / b.height - 0.5;
    const max = b.height > 360 ? 1.2 : 4;
    elx.style.setProperty("--ry", `${(nx * max).toFixed(2)}deg`);
    elx.style.setProperty("--rx", `${(-ny * max).toFixed(2)}deg`);
    elx.style.setProperty("--gx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    elx.style.setProperty("--gy", `${((ny + 0.5) * 100).toFixed(1)}%`);
  }

  const LINK = 120;
  const REACH = 170;
  function frame() {
    mx += (tx - mx) * 0.06;
    my += (ty - my) * 0.06;
    root.style.setProperty("--mx", mx.toFixed(4));
    root.style.setProperty("--my", my.toFixed(4));

    if (reticle) {
      rx += (px - rx) * 0.2;
      ry += (py - ry) * 0.2;
      reticle.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
      reticle.classList.toggle("lock", Boolean(lock));
      reticle.classList.toggle("on", px > -900);
    }

    ctx.clearRect(0, 0, w, h);
    const pts = nodes.map((n) => {
      if (!reduce) {
        n.x = (n.x + n.vx + w) % w;
        n.y = (n.y + n.vy + h) % h;
      }
      return { x: n.x - mx * 36 * n.depth, y: n.y - my * 36 * n.depth, n };
    });
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK) {
          ctx.strokeStyle = `rgba(90,98,112,${(0.16 * (1 - d / LINK)).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      const dc = Math.hypot(a.x - px, a.y - py);
      if (dc < REACH) {
        ctx.strokeStyle = `rgba(6,182,212,${(0.45 * (1 - dc / REACH)).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
      ctx.fillStyle = dc < REACH ? "rgba(6,182,212,0.85)" : `rgba(70,78,92,${(0.25 + a.n.depth * 0.35).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.n.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduce) requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  if (fine && !reduce) document.body.classList.add("has-cursor");
  requestAnimationFrame(frame);
})();
