/* Wires the page's controls to the simulations in sim.js and draws them with plot.js. */
(function () {
  "use strict";
  const F = window.FXT;
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const col = () => ({
    ink: cssVar("--ink"), text: cssVar("--text"), muted: cssVar("--muted"), s1: cssVar("--s1"), s2: cssVar("--s2"),
    bad: cssVar("--bad"), ok: cssVar("--ok"), panel: cssVar("--panel"),
  });
  // near starts dim, far starts bright
  const RAMP = ["#34507a", "#3f6497", "#4b78b3", "#5a8fd0", "#6fa5e6", "#8bbcf2", "#abd1f8", "#d2e7ff"];
  const ramp = (j, n) => RAMP[Math.round((j * (RAMP.length - 1)) / Math.max(1, n - 1))];

  // ------------------------------------------------------------ formatting
  const MINUS = "−";
  function supExp(k) { return String(k).replace("-", MINUS); }
  // 3.2 × 10^7 as HTML
  function sci(v, digits) {
    if (v === 0) return "0";
    const k = Math.floor(Math.log10(Math.abs(v)) + 1e-12);
    if (k >= -2 && k <= 3) return trim(v.toPrecision(digits || 2));
    const m = v / Math.pow(10, k);
    const ms = trim(m.toPrecision(digits || 2));
    return (ms === "1" ? "" : ms + " × ") + "10<sup>" + supExp(k) + "</sup>";
  }
  function trim(s) { return s.indexOf("e") < 0 && s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }
  function pow10(k) { return Number.isInteger(k) ? (k === 0 ? "1" : k === 1 ? "10" : "10<sup>" + supExp(k) + "</sup>") : sci(Math.pow(10, k)); }
  function secs(t) { return t.toFixed(2) + " s"; }
  function bigSecs(t) {
    if (t < 1000) return secs(t);
    if (t < 1e7) return Math.round(t).toLocaleString("en-US") + " s";
    return sci(t, 2) + " s";
  }
  function vec(v) { return "(" + v.map((x) => x.toFixed(3).replace("-", MINUS)).join(", ") + ")"; }

  // ------------------------------------------------------------ helpers
  const zero = (tol) => (t, y) => { let s = 0; for (let i = 0; i < y.length; i++) s += y[i] * y[i]; return Math.sqrt(s) < tol; };
  function norms(sol, idx) {
    const out = new Float64Array(sol.t.length);
    for (let k = 0; k < out.length; k++) { let s = 0; for (const i of idx) s += sol.y[i][k] * sol.y[i][k]; out[k] = Math.sqrt(s); }
    return out;
  }
  function absOf(arr) { const out = new Float64Array(arr.length); for (let k = 0; k < arr.length; k++) out[k] = Math.abs(arr[k]); return out; }
  // one pending update per frame per demo
  function scheduler(fn) {
    let queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    };
  }
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const demos = [];

  // ============================================================ hero: TAC (19) with no input
  (function hero() {
    const range = $("heroRange"), out = $("heroOut"), readout = $("heroReadout");
    const plot = new Plot($("heroPlot"), {
      x: { min: 0, max: 4, label: "time (s)" }, y: { min: 1e-12, max: 1e9, log: true, label: "|(x, y)|" },
      aspect: 0.6, pad: { l: 56, r: 12, t: 10, b: 38 },
    });
    let runs = [], latest = 0, first = true;
    function compute() {
      const K = +range.value, n = 8;
      out.innerHTML = pow10(K);
      runs = [];
      latest = 0;
      for (let j = 0; j < n; j++) {
        const r = Math.pow(10, -1 + (j * (K + 1)) / (n - 1)), a = 0.35 + j * 0.83;
        const sol = F.integrate(F.tacExample(0), [r * Math.cos(a), r * Math.sin(a)], 0, 4, { done: zero(1e-13) });
        runs.push({ t: sol.t, v: norms(sol, [0, 1]) });
        latest = Math.max(latest, sol.settledAt == null ? Infinity : sol.settledAt);
      }
      readout.textContent = isFinite(latest)
        ? `Every trajectory reaches the origin by t = ${secs(latest)}, no matter how far away it starts.`
        : "Some trajectories have not reached the origin by t = 4 s.";
    }
    function draw(upto) {
      const c = col();
      plot.clear();
      plot.axes();
      runs.forEach((r, j) => plot.line(r.t, r.v, { color: ramp(j, runs.length), width: 2.2, upto }));
      if (isFinite(latest) && (upto == null || upto >= latest)) plot.vline(latest, { color: c.ink, label: `all at 0 by ${secs(latest)}` });
    }
    function update() {
      compute();
      if (first && !reduced) {
        first = false;
        const t0 = performance.now(), D = 1300;
        const step = (now) => {
          const f = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - f, 3);
          draw(e * 4);
          if (f < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      } else {
        first = false;
        draw();
      }
    }
    range.addEventListener("input", scheduler(update));
    demos.push({ init: update, redraw: () => { plot.resize(); draw(); } });
  })();

  // ============================================================ scalar: finite vs fixed time
  (function scalar() {
    const sx0 = $("sx0"), sp = $("sp"), sq = $("sq"), readout = $("scalarReadout");
    const pT = new Plot($("scalarT"), {
      x: { min: 1e-2, max: 1e9, log: true, label: "starting point x₀" }, y: { min: 0, max: 5, label: "settling time (s)" },
      aspect: 0.66, pad: { l: 46, r: 12, t: 10, b: 38 },
    });
    const pX = new Plot($("scalarX"), {
      x: { min: 0, max: 5, label: "time (s)" }, y: { min: 1e-12, max: 1e10, log: true, label: "|x(t)|" },
      aspect: 0.66, pad: { l: 54, r: 12, t: 10, b: 38 },
    });
    let S = null;
    function compute() {
      const k = +sx0.value, p = +sp.value, q = +sq.value, x0 = Math.pow(10, k);
      $("sx0Out").innerHTML = pow10(+k.toFixed(1));
      $("spOut").textContent = p.toFixed(2);
      $("sqOut").textContent = q.toFixed(1);
      const bound = F.scalarBound(p, q, 1, 1);
      const xs = [], tFix = [], tFin = [];
      for (let i = 0; i <= 220; i++) {
        const x = Math.pow(10, -2 + (11 * i) / 220);
        xs.push(x);
        tFix.push(F.scalarSettle(x, p, q, 1, 1));
        tFin.push(Math.pow(x, 1 - p) / (1 - p));
      }
      S = {
        x0, p, q, bound, xs, tFix, tFin,
        Tfix: F.scalarSettle(x0, p, q, 1, 1), Tfin: Math.pow(x0, 1 - p) / (1 - p),
        trFix: F.scalarTrajectory(x0, p, q, 1, 1, 1e-12), trFin: F.scalarTrajectory(x0, p, q, 1, 0, 1e-12),
      };
      readout.innerHTML =
        `From x₀ = ${pow10(+k.toFixed(1))}, the state reaches 0 at t = ${secs(S.Tfix)} with the fast term, inside the bound ` +
        `T* = ${secs(bound)} that holds for every start. Without the fast term it takes ${bigSecs(S.Tfin)}.`;
    }
    function draw() {
      const c = col();
      const ymax = Math.max(2, S.bound * 1.5);
      pT.setRange("y", 0, ymax);
      pT.clear(); pT.axes();
      pT.line(S.xs, S.tFin, { color: c.muted, width: 2, dash: [6, 5] });
      pT.line(S.xs, S.tFix, { color: c.ink, width: 2.4 });
      pT.hline(S.bound, { color: c.ink, label: `bound T* = ${secs(S.bound)}` });
      if (S.Tfin <= ymax) pT.dot(S.x0, S.Tfin, { color: c.muted });
      pT.dot(S.x0, S.Tfix, { color: c.ink });

      pX.setRange("x", 0, Math.max(2, S.bound * 1.35));
      pX.clear(); pX.axes();
      pX.line(S.trFin.t, S.trFin.x, { color: c.muted, width: 2, dash: [6, 5] });
      pX.line(S.trFix.t, S.trFix.x, { color: c.ink, width: 2.4 });
      pX.vline(S.bound, { color: c.ink, label: "T*" });
      // when the slow-only trajectory runs off the right edge, label it with the time it reaches 0
      if (S.Tfin > pX.o.x.max) {
        const nearTop = Math.log10(S.x0) > Math.log10(pX.o.y.max) - 1.6;
        pX.text(0, S.x0, `without it: 0 at t = ${bigSecs(S.Tfin)}`, {
          color: c.muted, align: "left", baseline: nearTop ? "top" : "bottom", dx: 10, dy: nearTop ? 7 : -7,
        });
      }
    }
    const upd = scheduler(() => { compute(); draw(); });
    [sx0, sp, sq].forEach((el) => el.addEventListener("input", upd));
    demos.push({ init: () => { compute(); draw(); }, redraw: () => { pT.resize(); pX.resize(); draw(); } });
  })();

  // ============================================================ coupling: ACC Theorem 2
  (function coupling() {
    const e1 = $("ce1"), e2 = $("ce2"), rr = $("cr"), list = $("couplingChecks");
    const P = 2, Q = 2.5;
    const pg = new Plot($("gainPlot"), {
      x: { min: 1e-6, max: 1e6, log: true, label: "s" }, y: { min: 1e-16, max: 1e24, log: true },
      aspect: 0.72, pad: { l: 56, r: 12, t: 10, b: 38 },
    });
    const pt = new Plot($("couplingPlot"), {
      x: { min: 0, max: 4, label: "time (s)" }, y: { min: 1e-12, max: 1e6, log: true, label: "|(x, y)|" },
      aspect: 0.72, pad: { l: 56, r: 12, t: 10, b: 38 },
    });
    let S = null;
    const rVal = () => (+rr.value === 0.44 ? 4 / 9 : +rr.value);
    function compute() {
      const E1 = +e1.value, E2 = +e2.value, R = rVal();
      $("ce1Out").textContent = E1.toFixed(2);
      $("ce2Out").textContent = E2.toFixed(2);
      $("crOut").textContent = R === 4 / 9 ? "4/9" : R.toFixed(2);
      const sg = F.accSmallGain(E1, E2, P, Q, R);
      // s-range: 1e-6..1e6, stretched so that any point where the condition fails is on screen
      let lo = -6, hi = 6;
      if (!sg.small && sg.failHi != null) lo = Math.min(lo, Math.floor(Math.log10(sg.failHi)) - 4);
      if (!sg.large && sg.failLo != null) hi = Math.max(hi, Math.ceil(Math.log10(sg.failLo)) + 4);
      if (sg.small && sg.large && sg.failLo != null) { lo = Math.min(lo, Math.floor(Math.log10(sg.failLo)) - 2); hi = Math.max(hi, Math.ceil(Math.log10(sg.failHi)) + 2); }
      lo = Math.max(lo, -40); hi = Math.min(hi, 40);
      const ss = [], g1 = [], g2 = [];
      let ymin = Infinity, ymax = 0;
      for (let i = 0; i <= 400; i++) {
        const s = Math.pow(10, lo + ((hi - lo) * i) / 400), a = sg.gains.g1(s), b = sg.gains.g2inv(s);
        ss.push(s); g1.push(a); g2.push(b);
        ymin = Math.min(ymin, a, b); ymax = Math.max(ymax, a, b);
      }
      pg.setRange("x", Math.pow(10, lo), Math.pow(10, hi));
      pg.setRange("y", Math.pow(10, Math.max(-300, Math.floor(Math.log10(ymin)))), Math.pow(10, Math.min(300, Math.ceil(Math.log10(ymax)))));
      const runs = [];
      let latest = 0;
      for (let j = 0; j < 6; j++) {
        const r = Math.pow(10, -1 + j), a = 0.4 + j * 1.05;
        const sol = F.integrate(F.accExample(E1, E2, P, Q, R), [r * Math.cos(a), r * Math.sin(a)], 0, 4, { done: zero(1e-13) });
        runs.push({ t: sol.t, v: norms(sol, [0, 1]) });
        latest = Math.max(latest, sol.settledAt == null ? Infinity : sol.settledAt);
      }
      S = { sg, ss, g1, g2, runs, latest };
      // checks
      const win = sg.pr >= 0.75 - 1e-9 && sg.qr <= 1.5 + 1e-9;
      const lhs = Math.pow(E1, R) * E2, rhs = 1 / (Math.pow(2, R) * Math.sqrt(sg.gains.Lr));
      let sgWhy;
      if (sg.holds) sgWhy = "γ₁(s) < γ₂⁻¹(s) for every s > 0.";
      else if (!sg.small) sgWhy = "Fails as s → 0: p r is below α₂, so γ₁ eventually lies above γ₂⁻¹.";
      else if (!sg.large) sgWhy = "Fails as s → ∞: q r is above β₂, so γ₁ eventually lies above γ₂⁻¹.";
      else sgWhy = `Fails near s = ${sci(sg.worstS)}: the couplings are too strong there.`;
      const item = (ok, head, why) =>
        `<li class="${ok ? "yes" : "no"}"><span class="mark" aria-hidden="true">${ok ? "✓" : "✕"}</span>` +
        `<span><b>${head}</b> <span class="why">${why}</span></span></li>`;
      list.innerHTML =
        item(win, "Exponent window.", `p r = ${sg.pr.toFixed(2)} and q r = ${sg.qr.toFixed(2)} ${win ? "lie" : "do not both lie"} in [α₂, β₂] = [0.75, 1.5].`) +
        item(sg.holds, "Small-gain condition.", sgWhy) +
        item(sg.cond16, "Closed-form test (16).", `ε₁<sup>r</sup> ε₂ = ${lhs.toPrecision(2)} ${sg.cond16 ? "<" : "≥"} ${rhs.toPrecision(2)}.` +
          (sg.holds && !sg.cond16 ? " This test is more conservative than the comparison of the gains, which still holds." : "")) +
        `<li class="verdict ${sg.holds ? "yes" : "no"}"><span class="mark" aria-hidden="true"></span><span><b>${sg.holds ? "Certified: the coupled system is fixed-time stable." : "Not certified by the theorem."}</b>` +
        (isFinite(latest) ? ` <span class="why">In the simulation, every start reaches the origin by t = ${secs(latest)}.</span>` : ` <span class="why">In the simulation, not every start reaches the origin by t = 4 s.</span>`) +
        `</span></li>`;
    }
    function draw() {
      const c = col();
      pg.clear(); pg.axes();
      // shade where the condition fails
      const ctx = pg.ctx;
      pg._clip(() => {
        ctx.fillStyle = c.bad;
        ctx.globalAlpha = 0.28;
        for (let i = 0; i < S.ss.length - 1; i++) {
          if (S.g1[i] >= S.g2[i] || S.g1[i + 1] >= S.g2[i + 1]) {
            const x0 = pg.X(S.ss[i]), x1 = pg.X(S.ss[i + 1]);
            ctx.beginPath();
            ctx.moveTo(x0, pg.Y(S.g1[i])); ctx.lineTo(x1, pg.Y(S.g1[i + 1]));
            ctx.lineTo(x1, pg.Y(S.g2[i + 1])); ctx.lineTo(x0, pg.Y(S.g2[i]));
            ctx.closePath(); ctx.fill();
            ctx.fillRect(x0, pg.h - pg.pad.b - 6, x1 - x0 + 0.5, 6);
          }
        }
        ctx.globalAlpha = 1;
      });
      pg.line(S.ss, S.g2, { color: c.s2, width: 2.4 });
      pg.line(S.ss, S.g1, { color: c.s1, width: 2.4 });

      pt.clear(); pt.axes();
      S.runs.forEach((r, j) => pt.line(r.t, r.v, { color: ramp(j + 1, 7), width: 2 }));
      if (isFinite(S.latest)) pt.vline(S.latest, { color: c.ink, label: secs(S.latest) });
    }
    const upd = scheduler(() => { compute(); draw(); });
    [e1, e2, rr].forEach((el) => el.addEventListener("input", upd));
    $("couplingReset").addEventListener("click", () => { e1.value = 0.3; e2.value = 0.1; rr.value = 0.44; upd(); });
    demos.push({ init: () => { compute(); draw(); }, redraw: () => { pg.resize(); pt.resize(); draw(); } });
  })();

  // ============================================================ inputs: TAC (19) with u1, u2
  (function inputs() {
    const kk = $("ik"), readout = $("inputsReadout");
    const plot = new Plot($("inputsPlot"), {
      x: { min: 0, max: 10, label: "time (s)" }, y: { min: 1e-12, max: 1e5, log: true, label: "|(x, y)|" },
      aspect: 0.4, pad: { l: 56, r: 12, t: 10, b: 38 },
    });
    let S = null;
    function compute() {
      const k = +kk.value;
      $("ikOut").textContent = k.toFixed(2) + "×";
      const runs = [];
      let latest = 0, band = 0;
      for (let j = 0; j < 6; j++) {
        const r = Math.pow(10, -1 + j), a = 0.4 + j * 1.05;
        const sol = F.integrate(F.tacExample(k), [r * Math.cos(a), r * Math.sin(a)], 0, 10, { done: k === 0 ? zero(1e-13) : null });
        const v = norms(sol, [0, 1]);
        runs.push({ t: sol.t, v });
        latest = Math.max(latest, sol.settledAt == null ? Infinity : sol.settledAt);
        for (let i = 0; i < v.length; i++) if (sol.t[i] >= 5) band = Math.max(band, v[i]);
      }
      const ut = [], uv = [];
      let umax = 0;
      for (let i = 0; i <= 800; i++) {
        const t = (10 * i) / 800, u = k * Math.hypot(F.u1(t), F.u2(t));
        ut.push(t); uv.push(u); umax = Math.max(umax, u);
      }
      S = { runs, ut, uv, k };
      readout.innerHTML = k === 0
        ? `With no input, every trajectory reaches the origin by t = ${secs(latest)}.`
        : `After t = 5 s every trajectory stays below ${band.toPrecision(2)}, for an input of size up to ${umax.toPrecision(2)}. ` +
          `Starting points from 0.1 to 10<sup>4</sup> all end up in the same band.`;
    }
    function draw() {
      const c = col();
      plot.clear(); plot.axes();
      if (S.k > 0) plot.line(S.ut, S.uv, { color: c.muted, width: 1.6, dash: [5, 5] });
      S.runs.forEach((r, j) => plot.line(r.t, r.v, { color: ramp(j + 1, 7), width: 2 }));
    }
    kk.addEventListener("input", scheduler(() => { compute(); draw(); }));
    demos.push({ init: () => { compute(); draw(); }, redraw: () => { plot.resize(); draw(); } });
  })();

  // ============================================================ feedback optimization: TAC §IV-C
  (function optimization() {
    const oe = $("oe"), readout = $("optReadout");
    const pe = new Plot($("optErr"), {
      x: { min: 0, max: 6, label: "time (s)" }, y: { min: 1e-12, max: 1e6, log: true },
      aspect: 0.72, pad: { l: 56, r: 12, t: 10, b: 38 },
    });
    const pk = new Plot($("optTrack"), {
      x: { min: 0, max: 6, label: "time (s)" }, y: { min: -1.6, max: 0.6 },
      aspect: 0.72, pad: { l: 46, r: 12, t: 10, b: 38 },
    });
    let S = null;
    function compute() {
      const e0 = +oe.value;
      $("oeOut").textContent = e0.toFixed(2);
      const runs = [];
      let latest = 0, band = 0, first = null;
      for (let j = 0; j < 5; j++) {
        const r = Math.pow(10, 0.5 + j), a = 0.3 + j * 1.1, b = 2 + 1.3 * j;
        const y0 = [r * Math.cos(a), r * Math.sin(a), (r / 3) * Math.cos(b), (r / 3) * Math.sin(b)];
        const sol = F.integrate(F.foSystem(e0), y0, 0, 6, { done: e0 === 0 ? zero(1e-13) : null });
        const v = norms(sol, [0, 1]);
        runs.push({ t: sol.t, v });
        latest = Math.max(latest, sol.settledAt == null ? Infinity : sol.settledAt);
        for (let i = 0; i < v.length; i++) if (sol.t[i] >= 4) band = Math.max(band, v[i]);
        if (j === 0) first = sol;
      }
      // optimizer path and the first trajectory's input u = u~ + φ
      const ts = [], ph1 = [], ph2 = [];
      for (let i = 0; i <= 400; i++) { const t = (6 * i) / 400, ph = F.foOptimizer(e0, t); ts.push(t); ph1.push(ph[0]); ph2.push(ph[1]); }
      const u1 = new Float64Array(first.t.length), u2 = new Float64Array(first.t.length);
      for (let i = 0; i < first.t.length; i++) { const ph = F.foOptimizer(e0, first.t[i]); u1[i] = first.y[2][i] + ph[0]; u2[i] = first.y[3][i] + ph[1]; }
      S = { runs, ts, ph1, ph2, ut: first.t, u1, u2 };
      readout.innerHTML = e0 === 0
        ? `The cost is fixed, so convergence is exact: every trajectory reaches the optimizer by t = ${secs(latest)}.`
        : `The cost keeps moving, so the error settles into a band instead of reaching zero: after t = 4 s it stays below ${sci(band, 2)}. ` +
          `The band shrinks as ε₀ does.`;
    }
    function draw() {
      const c = col();
      pe.clear(); pe.axes();
      S.runs.forEach((r, j) => pe.line(r.t, r.v, { color: ramp(j + 2, 7), width: 2 }));
      pk.clear(); pk.axes();
      pk.line(S.ut, S.u1, { color: c.s1, width: 1.8, dash: [5, 4] });
      pk.line(S.ut, S.u2, { color: c.s2, width: 1.8, dash: [5, 4] });
      pk.line(S.ts, S.ph1, { color: c.s1, width: 2.4 });
      pk.line(S.ts, S.ph2, { color: c.s2, width: 2.4 });
    }
    oe.addEventListener("input", scheduler(() => { compute(); draw(); }));
    demos.push({ init: () => { compute(); draw(); }, redraw: () => { pe.resize(); pk.resize(); draw(); } });
  })();

  // ============================================================ Nash seeking: TAC §V-B
  (function games() {
    const gd = $("gd"), readout = $("gameReadout");
    const us = F.NE.ustar;
    const pp = new Plot($("gamePlane"), {
      x: { min: -1, max: 1, label: "u₁" }, y: { min: -1, max: 1, label: "u₂" },
      aspect: 0.8, pad: { l: 50, r: 12, t: 10, b: 38 },
    });
    const pe = new Plot($("gameErr"), {
      x: { min: 0, max: 5, label: "time (s)" }, y: { min: 1e-12, max: 1e6, log: true },
      aspect: 0.8, pad: { l: 56, r: 12, t: 10, b: 38 },
    });
    let seed = 7, S = null;
    function compute() {
      const k = +gd.value, R = Math.pow(10, k), rand = rng(seed);
      $("gdOut").innerHTML = pow10(k);
      const runs = [];
      let latest = 0;
      for (let j = 0; j < 6; j++) {
        const a = (2 * Math.PI * (j + rand() * 0.8)) / 6, b = 2 * Math.PI * rand(), rx = 0.4 * R * rand();
        const y0 = [rx * Math.cos(b), rx * Math.sin(b), R * Math.cos(a), R * Math.sin(a)];
        const sol = F.integrate(F.neSystem(), y0, 0, 5, { done: zero(1e-13) });
        const u1 = new Float64Array(sol.t.length), u2 = new Float64Array(sol.t.length);
        for (let i = 0; i < sol.t.length; i++) { u1[i] = sol.y[2][i] + us[0]; u2[i] = sol.y[3][i] + us[1]; }
        runs.push({ t: sol.t, u1, u2, e1: absOf(sol.y[2]), e2: absOf(sol.y[3]) });
        latest = Math.max(latest, sol.settledAt == null ? Infinity : sol.settledAt);
      }
      S = { R, runs, latest };
      readout.innerHTML = isFinite(latest)
        ? `Both players reach the Nash equilibrium u* = ${vec(us)} by t = ${secs(latest)}, each using only its own payoff gradient.`
        : "Not every trajectory has reached the Nash equilibrium by t = 5 s.";
    }
    function draw() {
      const c = col();
      // equal scaling in the action plane
      const w = 1.3 * S.R, inner = (pp.h - pp.pad.t - pp.pad.b) / (pp.w - pp.pad.l - pp.pad.r);
      pp.setRange("x", us[0] - w, us[0] + w);
      pp.setRange("y", us[1] - w * inner, us[1] + w * inner);
      pp.clear();
      const P0 = F.NE.potential(us), corner = F.NE.potential([us[0] + w, us[1] + w * inner]) - P0;
      const levels = [], shades = ["#17263d", "#152238", "#131f33", "#121c2e", "#11192a", "#101826", "#0f1622"];
      for (let i = 1; i < shades.length; i++) levels.push(P0 + corner * Math.pow(i / (shades.length - 1), 2) * 0.9);
      pp.field((x, y) => F.NE.potential([x, y]), levels, shades);
      pp.axes();
      S.runs.forEach((r) => {
        pp.line(r.u1, r.u2, { color: c.ink, width: 1.7, alpha: 0.9 });
        pp.dot(r.u1[0], r.u2[0], { color: c.muted, r: 3.5 });
      });
      pp.star(us[0], us[1], { color: c.ink, r: 9 });

      pe.setRange("y", 1e-12, Math.pow(10, Math.max(1, Math.ceil(Math.log10(S.R) + 1))));
      pe.clear(); pe.axes();
      S.runs.forEach((r) => {
        pe.line(r.t, r.e1, { color: c.s1, width: 1.8, alpha: 0.9 });
        pe.line(r.t, r.e2, { color: c.s2, width: 1.8, alpha: 0.9 });
      });
      if (isFinite(S.latest)) pe.vline(S.latest, { color: c.ink, label: secs(S.latest) });
    }
    const upd = scheduler(() => { compute(); draw(); });
    gd.addEventListener("input", upd);
    $("gameNew").addEventListener("click", () => { seed = (seed * 7919 + 13) % 100003; upd(); });
    demos.push({ init: () => { compute(); draw(); }, redraw: () => { pp.resize(); pe.resize(); draw(); } });
  })();

  // ============================================================ BibTeX copy buttons
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = $(btn.dataset.copy).textContent;
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch (e) {
        const sel = window.getSelection(), range = document.createRange();
        range.selectNodeContents($(btn.dataset.copy));
        sel.removeAllRanges(); sel.addRange(range);
        btn.textContent = "Selected, press Ctrl+C";
      }
      setTimeout(() => (btn.textContent = label), 1800);
    });
  });

  // ============================================================ start
  function start() {
    demos.forEach((d) => d.init());
    let timer = null, lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(() => demos.forEach((d) => d.redraw()), 120);
    });
  }
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(start);
})();
