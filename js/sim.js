/*
  Numerical core for the interactive companion page.
  Every model implements the equations printed in the papers; equation numbers refer to
  the journal paper (IEEE TAC) unless marked "ACC".
  Runs in the browser (window.FXT) and in Node (module.exports) for testing.
*/
(function (root) {
  "use strict";

  // Below REG the fractional powers are continued linearly (Lipschitz). REG is far below the plots'
  // 1e-12 floor, so the curves are unaffected, but the solver no longer stalls at the origin.
  const REG = 1e-14;

  // ⌊v⌉^a = |v|^a sign(v)
  function spow(v, a) {
    const m = v < 0 ? -v : v;
    if (m === 0) return 0;
    if (a < 1 && m < REG) return v * Math.pow(REG, a - 1);
    return v > 0 ? Math.pow(m, a) : -Math.pow(m, a);
  }
  // |s|^(-k) for k > 0, held constant below REG (used in s/|s|^k terms)
  function ipow(m, k) {
    return Math.pow(m < REG ? REG : m, -k);
  }
  function norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
  }

  // ---------------------------------------------------------------- linearly implicit solver
  /*
    Fixed-time vector fields are not Lipschitz at the origin and are very stiff far from it
    (terms like x^3 started at 1e8), so an explicit method crawls. We use the L-stable
    second-order Rosenbrock method ROS2 (Verwer et al., 1999) with γ = 1 + 1/√2, a numerical
    Jacobian, time appended as a state (so inputs are handled exactly), and the embedded
    first-order solution for step-size control.

    integrate(f, y0, t0, t1, opts) -> { t, y: [component arrays], settledAt, steps }
    f(t, y, out) writes dy/dt into out.
    opts.done(t, y) -> true once the solution has reached an equilibrium that is exactly invariant;
    the run then records a flat segment to t1.
  */
  const GAM = 1 + 1 / Math.SQRT2;
  function integrate(f, y0, t0, t1, opts) {
    opts = opts || {};
    const n = y0.length, N = n + 1; // last component is time
    const rtol = opts.rtol || 1e-3, atol = opts.atol || 1e-14;
    const maxSteps = opts.maxSteps || 40000, hmin = opts.hmin || 1e-24;
    const done = opts.done || null;
    let t = t0, h = opts.h0 || 1e-9;
    const y = Float64Array.from(y0);
    const fy = new Float64Array(n), fp = new Float64Array(n), yp = new Float64Array(n);
    const J = new Float64Array(N * N), W = new Float64Array(N * N);
    const k1 = new Float64Array(N), k2 = new Float64Array(N), r = new Float64Array(N), yn = new Float64Array(n);
    const piv = new Int32Array(N);

    let cap = 1024, len = 0;
    let T = new Float64Array(cap);
    const Y = [];
    for (let i = 0; i < n; i++) Y.push(new Float64Array(cap));
    function push(tt, yy) {
      if (len === cap) {
        cap *= 2;
        const T2 = new Float64Array(cap); T2.set(T); T = T2;
        for (let i = 0; i < n; i++) { const a = new Float64Array(cap); a.set(Y[i]); Y[i] = a; }
      }
      T[len] = tt;
      for (let i = 0; i < n; i++) Y[i][len] = yy[i];
      len++;
    }
    // LU with partial pivoting of W (in place); returns false if singular
    function lu() {
      for (let c = 0; c < N; c++) {
        let pr = c, best = Math.abs(W[c * N + c]);
        for (let rr = c + 1; rr < N; rr++) { const v = Math.abs(W[rr * N + c]); if (v > best) { best = v; pr = rr; } }
        if (!(best > 0) || !isFinite(best)) return false;
        piv[c] = pr;
        if (pr !== c) for (let j = 0; j < N; j++) { const tmp = W[c * N + j]; W[c * N + j] = W[pr * N + j]; W[pr * N + j] = tmp; }
        for (let rr = c + 1; rr < N; rr++) {
          const m = (W[rr * N + c] /= W[c * N + c]);
          if (m !== 0) for (let j = c + 1; j < N; j++) W[rr * N + j] -= m * W[c * N + j];
        }
      }
      return true;
    }
    function solve(b) {
      for (let c = 0; c < N; c++) { const pr = piv[c]; if (pr !== c) { const tmp = b[c]; b[c] = b[pr]; b[pr] = tmp; } }
      for (let i = 1; i < N; i++) for (let j = 0; j < i; j++) b[i] -= W[i * N + j] * b[j];
      for (let i = N - 1; i >= 0; i--) { for (let j = i + 1; j < N; j++) b[i] -= W[i * N + j] * b[j]; b[i] /= W[i * N + i]; }
    }
    function jacobian() {
      f(t, y, fy);
      for (let j = 0; j < n; j++) {
        const d = Math.max(Math.abs(y[j]) * 1e-7, 1e-22);
        yp.set(y); yp[j] += d;
        f(t, yp, fp);
        for (let i = 0; i < n; i++) J[i * N + j] = (fp[i] - fy[i]) / d;
        J[n * N + j] = 0;
      }
      const dt = Math.max(Math.abs(t) * 1e-7, 1e-9);
      f(t + dt, y, fp);
      for (let i = 0; i < n; i++) J[i * N + n] = (fp[i] - fy[i]) / dt;
      J[n * N + n] = 0;
    }

    push(t, y);
    let settledAt = null, steps = 0, needJ = true;
    while (t < t1 && steps < maxSteps) {
      if (done && done(t, y)) { settledAt = t; push(t1, y); break; }
      if (needJ) { jacobian(); needJ = false; }
      if (t + h > t1) h = t1 - t;
      for (let i = 0; i < N * N; i++) W[i] = -GAM * h * J[i];
      for (let i = 0; i < N; i++) W[i * N + i] += 1;
      steps++;
      if (!lu()) { h *= 0.25; continue; }
      // stage 1: W k1 = F(z)
      for (let i = 0; i < n; i++) k1[i] = fy[i];
      k1[n] = 1;
      solve(k1);
      // stage 2: W k2 = F(z + h k1) - 2 k1
      for (let i = 0; i < n; i++) yp[i] = y[i] + h * k1[i];
      f(t + h * k1[n], yp, fp);
      for (let i = 0; i < n; i++) k2[i] = fp[i] - 2 * k1[i];
      k2[n] = 1 - 2 * k1[n];
      solve(k2);
      // z_{n+1} = z + 1.5 h k1 + 0.5 h k2;  error = z_{n+1} - (z + h k1) = 0.5 h (k1 + k2)
      let err = 0, ok = true;
      for (let i = 0; i < n; i++) {
        yn[i] = y[i] + h * (1.5 * k1[i] + 0.5 * k2[i]);
        const e = 0.5 * h * (k1[i] + k2[i]);
        const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i]));
        err = Math.max(err, Math.abs(e) / sc);
        if (!isFinite(yn[i])) ok = false;
      }
      if (ok && (err <= 1 || h <= hmin)) {
        t += h;
        y.set(yn);
        push(t, y);
        needJ = true;
      }
      const fac = !ok ? 0.1 : err === 0 ? 4 : Math.min(4, Math.max(0.2, 0.9 / Math.sqrt(err)));
      h = Math.max(hmin, h * fac);
    }
    return { t: T.subarray(0, len), y: Y.map((a) => a.subarray(0, len)), settledAt: settledAt, steps: steps };
  }

  // Settling time: first time after which the error stays below tol.
  function settleTime(t, err, tol) {
    for (let k = err.length - 1; k >= 0; k--) if (err[k] >= tol) return k + 1 < t.length ? t[k + 1] : null;
    return t[0];
  }

  // ---------------------------------------------------------------- scalar FxTS  x' = -a⌊x⌉^p - b⌊x⌉^q
  // Time to reach 0 from x0 > 0: T(x0) = ∫_0^{x0} ds / (a s^p + b s^q), computed in log space.
  function scalarSettle(x0, p, q, a, b) {
    if (x0 <= 0) return 0;
    if (!b) return Math.pow(x0, 1 - p) / (a * (1 - p));
    const wLo = Math.log(Math.min(x0, 1e-30)), wHi = Math.log(x0);
    // tail below e^wLo: b s^q is negligible there
    let T = Math.pow(Math.exp(wLo), 1 - p) / (a * (1 - p));
    if (wHi <= wLo) return T;
    const N = 600, dw = (wHi - wLo) / N;
    let s = 0;
    for (let k = 0; k <= N; k++) {
      const w = wLo + k * dw, e = Math.exp(w);
      const v = e / (a * Math.pow(e, p) + b * Math.pow(e, q));
      s += (k === 0 || k === N ? 1 : k % 2 ? 4 : 2) * v;
    }
    return T + (s * dw) / 3;
  }
  // Exact trajectory |x(t)| of the scalar system, parametrised by the state: t(x) = T(x0) - T(x).
  function scalarTrajectory(x0, p, q, a, b, floor) {
    const T0 = scalarSettle(x0, p, q, a, b);
    const ts = [], xs = [];
    const lo = Math.log10(floor), hi = Math.log10(x0), M = 240;
    for (let k = 0; k <= M; k++) {
      const x = Math.pow(10, hi - ((hi - lo) * k) / M);
      ts.push(T0 - scalarSettle(x, p, q, a, b));
      xs.push(x);
    }
    ts.push(T0); xs.push(0);
    return { t: ts, x: xs, T: T0 };
  }
  function scalarBound(p, q, a, b) {
    return 1 / (a * (1 - p)) + 1 / (b * (q - 1));
  }

  // ---------------------------------------------------------------- TAC example (19): FxT-ISS interconnection
  // x' = -x^{1/3} - x^3 + 0.1(⌊y⌉^2 + ⌊y⌉^{2.5}) + k u1(t)
  // y' = -⌊y⌉^{1/2} - ⌊y⌉^{9/4} - 0.3⌊x⌉^{4/9} + 0.2⌊x⌉^{5/8} + k u2(t)
  function u1(t) { return Math.sin(1.7 * t) + 0.5 * Math.sin(5.1 * t); }
  function u2(t) { return 0.8 * Math.cos(2.3 * t) + 0.35 * Math.sin(6.7 * t); }
  function tacExample(k) {
    return function (t, s, out) {
      const x = s[0], y = s[1];
      out[0] = -spow(x, 1 / 3) - spow(x, 3) + 0.1 * (spow(y, 2) + spow(y, 2.5)) + k * u1(t);
      out[1] = -spow(y, 0.5) - spow(y, 2.25) - 0.3 * spow(x, 4 / 9) + 0.2 * spow(x, 5 / 8) + k * u2(t);
    };
  }

  // ---------------------------------------------------------------- ACC example (14): coupled FxTS systems
  // x' = f(x) + ε1(⌊y⌉^p + ⌊y⌉^q),  y' = g(y) - ε2⌊x⌉^r,
  // with f(x) = -x^{1/3} - x^3 and g(y) = -⌊y⌉^{1/2} - ⌊y⌉^2 as in ACC (19).
  function accExample(e1, e2, p, q, r) {
    return function (t, s, out) {
      const x = s[0], y = s[1];
      out[0] = -spow(x, 1 / 3) - spow(x, 3) + e1 * (spow(y, p) + spow(y, q));
      out[1] = -spow(y, 0.5) - spow(y, 2) - e2 * spow(x, r);
    };
  }
  // For f, g above with V = x^2, W = y^2: 2x f(x) = -2|x|^{4/3} - 2|x|^4 (m1 = 1),
  // 2y g(y) = -2|y|^{3/2} - 2|y|^3, i.e. m2 = 1, α2 = 3/4, β2 = 3/2.
  const ACC = { m1: 1, m2: 1, a2: 0.75, b2: 1.5 };
  // Gains from the proof of ACC Theorem 2 with c1, c2 -> 0:
  //   γ1(s)    = (ε1/m1)^2 (s^{p/2} + s^{q/2})^2
  //   γ2^-1(s) = (m2^2 / (L_r ε2^2))^{1/r} (s^{α2/r} + s^{β2/r}),  L_r = max(1, 2^{r-1})
  function accGains(e1, e2, p, q, r, c) {
    c = c || 0;
    const Lr = Math.max(1, Math.pow(2, r - 1));
    const C1 = Math.pow(e1 / (ACC.m1 - c / 2), 2);
    const D = Math.pow((ACC.m2 * (ACC.m2 - c)) / (Lr * e2 * e2), 1 / r);
    return {
      g1: (s) => C1 * Math.pow(Math.pow(s, p / 2) + Math.pow(s, q / 2), 2),
      g2inv: (s) => D * (Math.pow(s, ACC.a2 / r) + Math.pow(s, ACC.b2 / r)),
      C1: C1, D: D, Lr: Lr,
    };
  }
  // Does γ1(s) < γ2^-1(s) hold for every s > 0?  Exact asymptotics at both ends plus a dense check in between.
  function accSmallGain(e1, e2, p, q, r) {
    if (q < p) { const tmp = p; p = q; q = tmp; }
    const G = accGains(e1, e2, p, q, r, 0);
    const lo = ACC.a2 / r, hi = ACC.b2 / r, eps = 1e-9;
    // s -> 0:   γ1 ~ C1 s^p,   γ2^-1 ~ D s^{α2/r}
    const small = p > lo + eps || (Math.abs(p - lo) <= eps && G.C1 < G.D);
    // s -> ∞:   γ1 ~ C1 s^q,   γ2^-1 ~ D s^{β2/r}
    const large = q < hi - eps || (Math.abs(q - hi) <= eps && G.C1 < G.D);
    let mid = true, worst = Infinity, worstS = null, failLo = null, failHi = null;
    for (let k = 0; k <= 1600; k++) {
      const s = Math.pow(10, -40 + (80 * k) / 1600);
      const ratio = G.g2inv(s) / G.g1(s);
      if (ratio < worst) { worst = ratio; worstS = s; }
      if (!(ratio > 1)) {
        mid = false;
        if (failLo === null) failLo = s;
        failHi = s;
      }
    }
    const cond16 = Math.pow(e1, r) * e2 < (Math.pow(ACC.m1, r) * ACC.m2) / (Math.pow(2, r) * Math.sqrt(G.Lr));
    return {
      holds: small && large && mid, small: small, large: large, mid: mid, worstS: worstS, failLo: failLo, failHi: failHi,
      pr: p * r, qr: q * r, window: [ACC.a2, ACC.b2], cond16: cond16, gains: G,
    };
  }

  // ---------------------------------------------------------------- 2x2 helpers
  function mv(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1], M[1][0] * v[0] + M[1][1] * v[1]]; }
  function solve2(M, b) {
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    return [(M[1][1] * b[0] - M[0][1] * b[1]) / det, (-M[1][0] * b[0] + M[0][0] * b[1]) / det];
  }

  // ---------------------------------------------------------------- TAC §IV-C: feedback optimization
  // Plant (22): x' = -A1 e/|e|^{1/2} - A2 e |e|^{1/2},  e = x - h(u),  h(u) = 1.1u
  // Controller (28b): u' = -F_ξ(G_θ(x,u)),  F_ξ(s) = s/|s|^{1/3} + s|s|^{1/5}
  // G_θ(x,u) = 1.1 Q_θ x + P_θ u + 1.1c + d,  with d1 = ½sin(2ε0t), d2 = ⅓sin(1.5ε0t), d3 = ½sin(4ε0t)
  const FO = {
    A1: [[1.5, 0.3], [0.3, 1.8]], A2: [[1.4, 0.25], [0.25, 1.6]], hk: 1.1, c: [2, 1], d: [1.5, 0.5],
    ell: 1.1, gamma: 7 / 5, K: 1.339, mu: 3.37,
  };
  function foTheta(eps0, t) {
    const d1 = 0.5 * Math.sin(2 * eps0 * t), d2 = Math.sin(1.5 * eps0 * t) / 3, d3 = 0.5 * Math.sin(4 * eps0 * t);
    return { Q: [[1 + d1, 0.5], [0.5, 1 + d2]], P: [[3.5, 0.2], [0.2, 3.2 + d3]] };
  }
  // Optimizer φ(θ) = argmin_u Φ_θ(u) = -(1.21 Q_θ + P_θ)^{-1}(1.1c + d)
  function foOptimizer(eps0, t) {
    const th = foTheta(eps0, t), k = FO.hk;
    const M = [[k * k * th.Q[0][0] + th.P[0][0], k * k * th.Q[0][1] + th.P[0][1]],
      [k * k * th.Q[1][0] + th.P[1][0], k * k * th.Q[1][1] + th.P[1][1]]];
    const s = solve2(M, [k * FO.c[0] + FO.d[0], k * FO.c[1] + FO.d[1]]);
    return [-s[0], -s[1]];
  }
  function Fxi(v, xi1, xi2, out, off) {
    const n = Math.hypot(v[0], v[1]);
    if (n === 0) { out[off] = 0; out[off + 1] = 0; return; }
    const g = ipow(n, xi1) + Math.pow(n, -xi2);
    out[off] = v[0] * g;
    out[off + 1] = v[1] * g;
  }
  function plantRHS(A1, A2, pbar, qbar, ex, ey, out) {
    const n = Math.hypot(ex, ey);
    if (n === 0) { out[0] = 0; out[1] = 0; return; }
    const g1 = ipow(n, pbar), g2 = Math.pow(n, -qbar);
    out[0] = -(A1[0][0] * ex + A1[0][1] * ey) * g1 - (A2[0][0] * ex + A2[0][1] * ey) * g2;
    out[1] = -(A1[1][0] * ex + A1[1][1] * ey) * g1 - (A2[1][0] * ex + A2[1][1] * ey) * g2;
  }
  // Time derivative of the optimizer: from M(t)φ = -(1.1c + d), φ' = -M^{-1} M' φ.
  function foOptimizerDot(eps0, t, phi) {
    const th = foTheta(eps0, t), k2 = FO.hk * FO.hk;
    const M = [[k2 * th.Q[0][0] + th.P[0][0], k2 * th.Q[0][1] + th.P[0][1]],
      [k2 * th.Q[1][0] + th.P[1][0], k2 * th.Q[1][1] + th.P[1][1]]];
    const dQ0 = eps0 * Math.cos(2 * eps0 * t), dQ1 = 0.5 * eps0 * Math.cos(1.5 * eps0 * t), dP1 = 2 * eps0 * Math.cos(4 * eps0 * t);
    const Mdphi = [k2 * dQ0 * phi[0], (k2 * dQ1 + dP1) * phi[1]];
    const s = solve2(M, Mdphi);
    return [-s[0], -s[1]];
  }
  // Simulated in error coordinates  x~ = x - h(φ(θ)),  u~ = u - φ(θ)  (state order: x~1, x~2, u~1, u~2),
  // so the solver's tolerances act on the tracking error itself.
  function foSystem(eps0) {
    const xi1 = 1 / 3, xi2 = -1 / 5, k = FO.hk, G = [0, 0];
    return function (t, s, out) {
      const ph = foOptimizer(eps0, t), dph = eps0 ? foOptimizerDot(eps0, t, ph) : [0, 0];
      const x0 = s[0] + k * ph[0], x1 = s[1] + k * ph[1], v0 = s[2] + ph[0], v1 = s[3] + ph[1];
      plantRHS(FO.A1, FO.A2, 0.5, -0.5, x0 - k * v0, x1 - k * v1, out);
      const th = foTheta(eps0, t);
      G[0] = k * (th.Q[0][0] * x0 + th.Q[0][1] * x1 + FO.c[0]) + th.P[0][0] * v0 + th.P[0][1] * v1 + FO.d[0];
      G[1] = k * (th.Q[1][0] * x0 + th.Q[1][1] * x1 + FO.c[1]) + th.P[1][0] * v0 + th.P[1][1] * v1 + FO.d[1];
      Fxi(G, xi1, xi2, out, 2);
      out[0] -= k * dph[0];
      out[1] -= k * dph[1];
      out[2] = -out[2] - dph[0];
      out[3] = -out[3] - dph[1];
    };
  }

  // ---------------------------------------------------------------- TAC §V-B: Nash seeking with a plant
  // Plant (22) with A1 = A2 = I, h(u) = u/2, p̄ = 2/5, q̄ = -2/7.
  // Player i: u_i' = -(G_i/|G_i|^{1/3} + G_i|G_i|^{1/5}),  G(x,u) = ½Qx + Pu + ½c + d.
  const NE = {
    Q: [[1, 0.5], [1.7, 1.5]], P: [[4, 1], [0.7, 3]], c: [0.6, 1], d: [0.7, 0.8],
    Pot: [[4.25, 1.125], [1.125, 3.375]], ell: 0.5, gamma: 0.51, K: 1.257, mu: 2.605,
  };
  NE.ustar = (function () {
    const s = solve2(NE.Pot, [0.5 * NE.c[0] + NE.d[0], 0.5 * NE.c[1] + NE.d[1]]);
    return [-s[0], -s[1]];
  })();
  NE.potential = function (u) {
    const b0 = 0.5 * NE.c[0] + NE.d[0], b1 = 0.5 * NE.c[1] + NE.d[1];
    const Mu = mv(NE.Pot, u);
    return 0.5 * (u[0] * Mu[0] + u[1] * Mu[1]) + b0 * u[0] + b1 * u[1];
  };
  // Simulated in error coordinates x~ = x - h(u*), u~ = u - u*  (state order: x~1, x~2, u~1, u~2).
  function neSystem() {
    const I = [[1, 0], [0, 1]], us = NE.ustar;
    return function (t, s, out) {
      const x0 = s[0] + 0.5 * us[0], x1 = s[1] + 0.5 * us[1], v0 = s[2] + us[0], v1 = s[3] + us[1];
      plantRHS(I, I, 0.4, -2 / 7, x0 - 0.5 * v0, x1 - 0.5 * v1, out);
      const G0 = 0.5 * (NE.Q[0][0] * x0 + NE.Q[0][1] * x1 + NE.c[0]) + NE.P[0][0] * v0 + NE.P[0][1] * v1 + NE.d[0];
      const G1 = 0.5 * (NE.Q[1][0] * x0 + NE.Q[1][1] * x1 + NE.c[1]) + NE.P[1][0] * v0 + NE.P[1][1] * v1 + NE.d[1];
      out[2] = -(spow(G0, 2 / 3) + spow(G0, 6 / 5));
      out[3] = -(spow(G1, 2 / 3) + spow(G1, 6 / 5));
    };
  }

  const FXT = {
    REG, spow, ipow, norm, integrate, settleTime,
    scalarSettle, scalarTrajectory, scalarBound,
    u1, u2, tacExample,
    ACC, accExample, accGains, accSmallGain,
    FO, foTheta, foOptimizer, foOptimizerDot, foSystem,
    NE, neSystem,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = FXT;
  else root.FXT = FXT;
})(this);
