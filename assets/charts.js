/* Gráficas ligeras en canvas: líneas y barras con tooltip al pasar el ratón */
(function () {
  const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmtN = (v, d) => Number(v).toLocaleString("es-ES", { maximumFractionDigits: d == null ? 1 : d });

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 4 ? 4 : m <= 8 ? 8 : 10) * p;
  }

  // cfg: {series:[{name,color,data:[y...]}], x:[...], xLabel, yLabel, yMax, hLines:[{y,label,color}], height, xFmt, yFmt, marker:{x,label}, area}
  function lineChart(cv, cfg) {
    cv._cfg = cfg;
    if (!cv._bound) {
      cv._bound = true;
      cv.addEventListener("mousemove", (e) => { const r = cv.getBoundingClientRect(); cv._hover = e.clientX - r.left; draw(cv); });
      cv.addEventListener("mouseleave", () => { cv._hover = null; draw(cv); });
    }
    draw(cv);
  }

  function draw(cv) {
    const cfg = cv._cfg;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 700, H = cfg.height || 260;
    cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padL = 52, padR = 16, padT = 14, padB = 36;
    const n = cfg.x.length;
    let ymax = cfg.yMax;
    if (ymax == null) {
      ymax = 0;
      cfg.series.forEach((s) => s.data.forEach((v) => { if (v > ymax) ymax = v; }));
      (cfg.hLines || []).forEach((h) => { if (h.y > ymax) ymax = h.y; });
      ymax = niceMax(ymax * 1.05);
    }
    const X = (i) => padL + (n <= 1 ? 0 : i / (n - 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - Math.min(v, ymax) / ymax) * (H - padT - padB);
    ctx.fillStyle = cssv("--bg-2"); ctx.fillRect(0, 0, W, H);
    ctx.font = "11px sans-serif"; ctx.fillStyle = cssv("--fg-3"); ctx.strokeStyle = cssv("--line"); ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = ymax * k / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(cfg.yFmt ? cfg.yFmt(v) : fmtN(v, 0), padL - 6, y + 4);
    }
    ctx.textAlign = "center";
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - padL) / 60))));
    for (let i = 0; i < n; i += step) ctx.fillText(cfg.xFmt ? cfg.xFmt(cfg.x[i], i) : cfg.x[i], X(i), H - padB + 15);
    if (cfg.xLabel) { ctx.fillText(cfg.xLabel, (padL + W - padR) / 2, H - 4); }
    if (cfg.yLabel) { ctx.save(); ctx.translate(12, (padT + H - padB) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(cfg.yLabel, 0, 0); ctx.restore(); }

    (cfg.hLines || []).forEach((h) => {
      ctx.strokeStyle = h.color || cssv("--bad"); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, Y(h.y)); ctx.lineTo(W - padR, Y(h.y)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssv("--fg-2"); ctx.textAlign = "left"; ctx.fillText(h.label, padL + 6, Y(h.y) - 5);
    });
    cfg.series.forEach((s) => {
      if (cfg.area) {
        ctx.beginPath(); ctx.moveTo(X(0), Y(0));
        s.data.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
        ctx.lineTo(X(n - 1), Y(0)); ctx.closePath(); ctx.globalAlpha = 0.12; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round";
      s.data.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](X(i), Y(v)));
      ctx.stroke();
      if (cfg.series.length <= 4 && s.data.length) {
        const i = s.data.length - 1;
        ctx.fillStyle = cssv("--fg"); ctx.textAlign = "right"; ctx.font = "11px sans-serif";
        if (s.label !== false) ctx.fillText(s.name, X(i) - 4, Y(s.data[i]) - 6);
      }
    });
    if (cfg.marker != null) {
      const i = cfg.marker.i;
      ctx.strokeStyle = cssv("--fg-2"); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(X(i), padT); ctx.lineTo(X(i), H - padB); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssv("--fg-2"); ctx.textAlign = "left"; ctx.fillText(cfg.marker.label, X(i) + 4, padT + 10);
    }
    // tooltip
    if (cv._hover != null && cv._hover >= padL && cv._hover <= W - padR) {
      const i = Math.round((cv._hover - padL) / (W - padL - padR) * (n - 1));
      ctx.strokeStyle = cssv("--fg-3"); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(i), padT); ctx.lineTo(X(i), H - padB); ctx.stroke();
      const lines = [(cfg.xFmt ? cfg.xFmt(cfg.x[i], i, true) : cfg.x[i]) + ""].concat(cfg.series.map((s) => s.name + ": " + (cfg.yFmt ? cfg.yFmt(s.data[i], true) : fmtN(s.data[i]))));
      ctx.font = "12px sans-serif";
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 26, bh = lines.length * 17 + 8;
      let bx = X(i) + 10; if (bx + bw > W) bx = X(i) - bw - 10;
      ctx.fillStyle = cssv("--bg-2"); ctx.strokeStyle = cssv("--line");
      ctx.fillRect(bx, padT, bw, bh); ctx.strokeRect(bx, padT, bw, bh);
      lines.forEach((l, k) => {
        if (k > 0) { const s = cfg.series[k - 1]; ctx.fillStyle = s.color; ctx.fillRect(bx + 8, padT + 6 + k * 17 - 9, 9, 9); ctx.beginPath(); ctx.arc(X(i), Y(s.data[i]), 4, 0, 7); ctx.fill(); }
        ctx.fillStyle = cssv("--fg"); ctx.textAlign = "left"; ctx.font = (k ? "" : "bold ") + "12px sans-serif";
        ctx.fillText(l, bx + (k ? 22 : 8), padT + 6 + k * 17 + (k ? 0 : 0) + 4);
      });
    }
  }

  window.Charts = { lineChart, niceMax };
})();
