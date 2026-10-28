/*
  Minimal canvas plotting for the companion page: linear or log axes, decade tick labels,
  polylines with pixel-level decimation, reference lines, markers. Colours come from CSS variables.
*/
(function (root) {
  "use strict";

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  class Plot {
    /*
      opts: { x: {min, max, log, label, ticks}, y: {...}, aspect (height/width), pad }
    */
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.o = opts;
      this.aspect = opts.aspect || 0.56;
      this.pad = Object.assign({ l: 54, r: 14, t: 12, b: 40 }, opts.pad || {});
      this.resize();
    }
    resize() {
      const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth || 600;
      const h = Math.round(w * this.aspect);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.canvas.style.height = h + "px";
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w;
      this.h = h;
      // narrow screens: smaller margins
      if (w < 420) Object.assign(this.pad, { l: Math.min(this.pad.l, 44), b: Math.min(this.pad.b, 34) });
    }
    setRange(axis, min, max) { this.o[axis].min = min; this.o[axis].max = max; }
    _f(v, ax) { return ax.log ? Math.log10(v) : v; }
    X(v) {
      const ax = this.o.x, a = this._f(ax.min, ax), b = this._f(ax.max, ax);
      return this.pad.l + ((this._f(v, ax) - a) / (b - a)) * (this.w - this.pad.l - this.pad.r);
    }
    Y(v) {
      const ax = this.o.y, a = this._f(ax.min, ax), b = this._f(ax.max, ax);
      let val = ax.log ? Math.log10(Math.max(v, ax.min * 0.5)) : v;
      return this.h - this.pad.b - ((val - a) / (b - a)) * (this.h - this.pad.t - this.pad.b);
    }
    clear() {
      const c = this.ctx;
      c.clearRect(0, 0, this.w, this.h);
    }
    _ticks(ax) {
      if (ax.ticks) return ax.ticks;
      if (ax.log) {
        const a = Math.ceil(Math.log10(ax.min) - 1e-9), b = Math.floor(Math.log10(ax.max) + 1e-9);
        const span = b - a, step = [1, 2, 4, 5, 10, 20, 25, 50].find((st) => span / st <= 7) || 100;
        const out = [];
        for (let k = a; k <= b; k++) if ((k - a) % step === 0) out.push(Math.pow(10, k));
        return out;
      }
      const span = ax.max - ax.min, raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 6.5);
      const out = [];
      for (let v = Math.ceil(ax.min / step) * step; v <= ax.max + 1e-9; v += step) out.push(+v.toFixed(10));
      return out;
    }
    _label(c, v, ax, x, y, align) {
      c.textAlign = align;
      if (ax.log) {
        const k = Math.round(Math.log10(v));
        if (k === 0 || k === 1) { c.fillText(k === 0 ? "1" : "10", x, y); return; }
        const base = "10", exp = String(k).replace("-", "−");
        c.font = this.fontSmall;
        const ew = c.measureText(exp).width;
        c.font = this.font;
        const bw = c.measureText(base).width;
        let x0 = align === "right" ? x - ew - bw : align === "center" ? x - (bw + ew) / 2 : x;
        c.textAlign = "left";
        c.fillText(base, x0, y);
        c.font = this.fontSmall;
        c.fillText(exp, x0 + bw + 0.5, y - 6);
        c.font = this.font;
      } else {
        c.fillText(Number.isInteger(v) ? String(v) : String(+v.toFixed(3)).replace("-", "−"), x, y);
      }
    }
    axes() {
      const c = this.ctx, o = this.o;
      this.font = `12px ${css("--font-ui")}`;
      this.fontSmall = `9px ${css("--font-ui")}`;
      const grid = css("--grid"), muted = css("--muted");
      c.lineWidth = 1;
      c.font = this.font;
      c.fillStyle = muted;
      c.textBaseline = "middle";
      // y grid + labels
      for (const v of this._ticks(o.y)) {
        const y = Math.round(this.Y(v)) + 0.5;
        c.strokeStyle = grid;
        c.beginPath(); c.moveTo(this.pad.l, y); c.lineTo(this.w - this.pad.r, y); c.stroke();
        this._label(c, v, o.y, this.pad.l - 8, y, "right");
      }
      // x grid + labels
      c.textBaseline = "top";
      for (const v of this._ticks(o.x)) {
        const x = Math.round(this.X(v)) + 0.5;
        c.strokeStyle = grid;
        c.beginPath(); c.moveTo(x, this.pad.t); c.lineTo(x, this.h - this.pad.b); c.stroke();
        this._label(c, v, o.x, x, this.h - this.pad.b + 8, "center");
      }
      // axis titles
      c.fillStyle = muted;
      c.textBaseline = "alphabetic";
      if (o.x.label) { c.textAlign = "right"; c.fillText(o.x.label, this.w - this.pad.r, this.h - 4); }
      if (o.y.label) {
        c.save();
        c.translate(13, this.pad.t + (this.h - this.pad.t - this.pad.b) / 2);
        c.rotate(-Math.PI / 2);
        c.textAlign = "center";
        c.fillText(o.y.label, 0, 0);
        c.restore();
      }
    }
    // clip drawing to the plot box
    _clip(fn) {
      const c = this.ctx;
      c.save();
      c.beginPath();
      c.rect(this.pad.l, this.pad.t - 2, this.w - this.pad.l - this.pad.r, this.h - this.pad.t - this.pad.b + 4);
      c.clip();
      fn(c);
      c.restore();
    }
    /*
      line(xs, ys, style): xs, ys array-likes; style {color, width, dash, alpha, upto (x max to draw)}.
      Values below the y-range of a log axis are drawn on the floor.
    */
    line(xs, ys, st) {
      st = st || {};
      const n = Math.min(xs.length, ys.length), upto = st.upto == null ? Infinity : st.upto;
      // segments are clipped to the plot box in pixel space before drawing, so points far off-screen
      // (e.g. t = 1e8 s on a 5 s axis) never reach the canvas
      const L = this.pad.l - 4, R = this.w - this.pad.r + 4, T = this.pad.t - 4, B = this.h - this.pad.b + 4;
      function clipSeg(x0, y0, x1, y1) {
        let t0 = 0, t1 = 1;
        const dx = x1 - x0, dy = y1 - y0;
        const p = [-dx, dx, -dy, dy], q = [x0 - L, R - x0, y0 - T, B - y0];
        for (let k = 0; k < 4; k++) {
          if (p[k] === 0) { if (q[k] < 0) return null; continue; }
          const r = q[k] / p[k];
          if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
        return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
      }
      this._clip((c) => {
        c.strokeStyle = st.color || css("--ink");
        c.globalAlpha = st.alpha == null ? 1 : st.alpha;
        c.lineWidth = st.width || 1.8;
        c.lineJoin = "round";
        c.lineCap = "round";
        c.setLineDash(st.dash || []);
        c.beginPath();
        let px = null, py = null, penX = null, penY = null;
        for (let i = 0; i < n; i++) {
          if (xs[i] > upto) break;
          const x = this.X(xs[i]), y = this.Y(ys[i]);
          if (!isFinite(x) || !isFinite(y)) { px = null; continue; }
          if (px === null) { px = x; py = y; continue; }
          if (Math.abs(x - px) < 0.35 && Math.abs(y - py) < 0.6 && i < n - 1) continue;
          const s = clipSeg(px, py, x, y);
          if (s) {
            if (penX === null || Math.abs(s[0] - penX) > 0.01 || Math.abs(s[1] - penY) > 0.01) c.moveTo(s[0], s[1]);
            c.lineTo(s[2], s[3]);
            penX = s[2]; penY = s[3];
          }
          px = x; py = y;
        }
        c.stroke();
      });
    }
    vline(x, st) {
      st = st || {};
      const c = this.ctx, X = Math.round(this.X(x)) + 0.5;
      c.save();
      c.strokeStyle = st.color || css("--ink");
      c.lineWidth = st.width || 1.4;
      c.setLineDash(st.dash || [5, 5]);
      c.beginPath(); c.moveTo(X, this.pad.t); c.lineTo(X, this.h - this.pad.b); c.stroke();
      if (st.label) {
        c.setLineDash([]);
        c.fillStyle = st.color || css("--ink");
        c.font = `13px ${css("--font-ui")}`;
        c.textBaseline = "top";
        const right = X + 6 + c.measureText(st.label).width < this.w - this.pad.r;
        c.textAlign = right ? "left" : "right";
        c.fillText(st.label, right ? X + 6 : X - 6, this.pad.t + 4);
      }
      c.restore();
    }
    hline(y, st) {
      st = st || {};
      const c = this.ctx, Y = Math.round(this.Y(y)) + 0.5;
      c.save();
      c.strokeStyle = st.color || css("--ink");
      c.lineWidth = st.width || 1.2;
      c.setLineDash(st.dash || [5, 5]);
      c.beginPath(); c.moveTo(this.pad.l, Y); c.lineTo(this.w - this.pad.r, Y); c.stroke();
      if (st.label) {
        c.setLineDash([]);
        c.fillStyle = st.color || css("--ink");
        c.font = `13px ${css("--font-ui")}`;
        c.textAlign = "right";
        c.textBaseline = "bottom";
        c.fillText(st.label, this.w - this.pad.r - 4, Y - 4);
      }
      c.restore();
    }
    dot(x, y, st) {
      st = st || {};
      const c = this.ctx;
      this._clip(() => {
        c.fillStyle = st.color || css("--ink");
        c.strokeStyle = st.ring || css("--panel");
        c.lineWidth = 2;
        c.beginPath();
        c.arc(this.X(x), this.Y(y), st.r || 4.5, 0, 2 * Math.PI);
        c.fill();
        c.stroke();
      });
    }
    star(x, y, st) {
      st = st || {};
      const c = this.ctx, cx = this.X(x), cy = this.Y(y), R = st.r || 8;
      c.save();
      c.fillStyle = st.color || css("--ink");
      c.strokeStyle = css("--panel");
      c.lineWidth = 2;
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? R * 0.45 : R, a = -Math.PI / 2 + (k * Math.PI) / 5;
        c[k ? "lineTo" : "moveTo"](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      }
      c.closePath();
      c.stroke();
      c.fill();
      c.restore();
    }
    text(x, y, s, st) {
      st = st || {};
      const c = this.ctx;
      c.save();
      c.fillStyle = st.color || css("--muted");
      c.font = `${st.size || 12}px ${css("--font-ui")}`;
      c.textAlign = st.align || "left";
      c.textBaseline = st.baseline || "middle";
      c.fillText(s, this.X(x) + (st.dx || 0), this.Y(y) + (st.dy || 0));
      c.restore();
    }
    // filled contour bands of a scalar field on the (x,y) box (linear axes only)
    field(fn, levels, colors) {
      const c = this.ctx, step = 3;
      this._clip(() => {
        const x0 = this.pad.l, x1 = this.w - this.pad.r, y0 = this.pad.t, y1 = this.h - this.pad.b;
        const ax = this.o.x, ay = this.o.y;
        for (let py = y0; py < y1; py += step) {
          const vy = ay.max - ((py + step / 2 - y0) / (y1 - y0)) * (ay.max - ay.min);
          for (let px = x0; px < x1; px += step) {
            const vx = ax.min + ((px + step / 2 - x0) / (x1 - x0)) * (ax.max - ax.min);
            const v = fn(vx, vy);
            let k = 0;
            while (k < levels.length && v > levels[k]) k++;
            c.fillStyle = colors[Math.min(k, colors.length - 1)];
            c.fillRect(px, py, step, step);
          }
        }
      });
    }
  }

  root.Plot = Plot;
  root.cssVar = css;
})(this);
