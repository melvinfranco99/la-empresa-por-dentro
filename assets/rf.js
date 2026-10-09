/* ==========================================================
   RF.js — motor de radio Wi-Fi simplificado para la guía
   - Pérdida en espacio libre + exponente de entorno
   - Atenuación por paredes (intersección de segmentos) y forjados
   - Solapamiento espectral entre canales (máscara 802.11 OFDM)
   - RSSI, SINR, contención cocanal (CCI) y velocidad estimada
   - Simulador de planta interactivo + vista de espectro tipo inSSIDer/Acrylic
   ========================================================== */
(function () {
  "use strict";

  // ---------------- Datos ----------------
  const MATS = {
    pladur:   { name: "Pladur / tabique",            a: { "2.4": 3,  "5": 4,  "6": 5 },  color: "#8b95a7", w: 2 },
    vidrio:   { name: "Vidrio normal (mampara)",     a: { "2.4": 2,  "5": 3,  "6": 4 },  color: "#38bdf8", w: 2 },
    madera:   { name: "Puerta / panel de madera",    a: { "2.4": 3,  "5": 4,  "6": 5 },  color: "#a16207", w: 2 },
    ladrillo: { name: "Ladrillo",                    a: { "2.4": 6,  "5": 10, "6": 12 }, color: "#c2410c", w: 3 },
    lowe:     { name: "Vidrio bajo emisivo (fachada)", a: { "2.4": 25, "5": 30, "6": 35 }, color: "#0e7490", w: 3 },
    hormigon: { name: "Hormigón / muro de carga",    a: { "2.4": 12, "5": 18, "6": 22 }, color: "#57534e", w: 4 },
    metal:    { name: "Metal (ascensor, armario)",   a: { "2.4": 30, "5": 35, "6": 40 }, color: "#111827", w: 4 },
  };
  const SLAB = { "2.4": 15, "5": 20, "6": 25 }; // forjado entre plantas
  const FLOOR_H = 3.5; // metros entre plantas

  const BANDS = {
    "2.4": { name: "2,4 GHz", f0: 2400, f1: 2484, chans: [1,2,3,4,5,6,7,8,9,10,11,12,13], widths: [20, 40], ticks: [1,6,11,13] },
    "5":   { name: "5 GHz",   f0: 5165, f1: 5715, chans: [36,40,44,48,52,56,60,64,100,104,108,112,116,120,124,128,132,136,140], widths: [20, 40, 80, 160], ticks: [36,52,64,100,116,128,140] },
    "6":   { name: "6 GHz",   f0: 5935, f1: 6435, chans: [1,5,9,13,17,21,25,29,33,37,41,45,49,53,57,61,65,69,73,77,81,85,89,93], widths: [20, 40, 80, 160], ticks: [1,21,37,53,69,85,93] },
  };
  const DFS = (ch) => ch >= 52 && ch <= 144;
  const WEATHER = (ch) => ch >= 120 && ch <= 128;

  // Tabla 802.11ax, 20 MHz, 1 flujo espacial, GI 0,8 µs (Mbps) y SNR mínima aproximada (dB)
  const MCS_RATE = [8.6, 17.2, 25.8, 34.4, 51.6, 68.8, 77.4, 86.0, 103.2, 114.7, 129.0, 143.4];
  const MCS_SNR  = [2, 5, 9, 11, 15, 18, 20, 25, 29, 31, 34, 37];
  const MCS_MOD  = ["BPSK 1/2","QPSK 1/2","QPSK 3/4","16-QAM 1/2","16-QAM 3/4","64-QAM 2/3","64-QAM 3/4","64-QAM 5/6","256-QAM 3/4","256-QAM 5/6","1024-QAM 3/4","1024-QAM 5/6"];
  const WFACT = { 20: 1, 40: 2.0, 80: 4.19, 160: 8.38 };

  // Paleta categórica validada (claro / oscuro)
  const CAT_L = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  const CAT_D = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

  // ---------------- Utilidades ----------------
  const dbmToMw = (d) => Math.pow(10, d / 10);
  const mwToDbm = (m) => 10 * Math.log10(m);
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    if (t) return t === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const cat = (i) => (isDark() ? CAT_D : CAT_L)[i % 8];
  const cssv = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

  function fspl(dist, fMHz, n) {
    const d = Math.max(dist, 0.5);
    return 20 * Math.log10(fMHz) - 27.55 + 10 * (n || 2) * Math.log10(d);
  }
  function noiseFloor(width) {
    return -174 + 10 * Math.log10(width * 1e6) + 7; // NF de 7 dB
  }

  function chanRange(band, ch, width) {
    width = width || 20;
    if (band === "2.4") {
      const f = 2407 + 5 * ch;
      if (width >= 40) return ch <= 7 ? [f - 10, f + 30] : [f - 30, f + 10];
      return [f - 10, f + 10];
    }
    if (band === "5") {
      const n = width / 20;
      const base = ch <= 64 ? 36 : ch <= 144 ? 100 : 149;
      const start = base + Math.floor((ch - base) / 4 / n) * n * 4;
      return [5000 + 5 * start - 10, 5000 + 5 * (start + 4 * (n - 1)) + 10];
    }
    const n = width / 20;
    const start = 1 + Math.floor((ch - 1) / 4 / n) * n * 4;
    return [5950 + 5 * start - 10, 5950 + 5 * (start + 4 * (n - 1)) + 10];
  }
  function chanFreq(band, ch) {
    if (band === "2.4") return 2407 + 5 * ch;
    if (band === "5") return 5000 + 5 * ch;
    return 5950 + 5 * ch;
  }

  // Máscara espectral OFDM (dBr) a una distancia df del centro para un canal de ancho W
  function mask(df, W) {
    const a = Math.abs(df), h = W / 2;
    if (a <= h - 1) return 0;
    if (a <= h + 1) return -20 * (a - (h - 1)) / 2;
    if (a <= W) return -20 - 8 * (a - (h + 1)) / (W - h - 1);
    if (a <= 1.5 * W) return -28 - 12 * (a - W) / (0.5 * W);
    return -40 - Math.min(10, (a - 1.5 * W) / 2);
  }

  const coupCache = new Map();
  // Fracción de la potencia del transmisor t que cae dentro del canal de s
  function coupling(band, chS, wS, chT, wT) {
    const key = band + "|" + chS + "|" + wS + "|" + chT + "|" + wT;
    if (coupCache.has(key)) return coupCache.get(key);
    const [sl, sh] = chanRange(band, chS, wS);
    const [tl, th] = chanRange(band, chT, wT);
    const tc = (tl + th) / 2, tw = th - tl;
    let tot = 0, inS = 0;
    for (let f = tc - 2 * tw; f <= tc + 2 * tw; f += 0.5) {
      const p = dbmToMw(mask(f - tc, tw));
      tot += p;
      if (f >= sl && f <= sh) inS += p;
    }
    const c = tot ? inS / tot : 0;
    coupCache.set(key, c);
    return c;
  }

  function phyRate(sinr, width, streams, std) {
    let maxM = 11, k = 1;
    if (std === "ac") { maxM = 9; k = 0.88; }
    if (std === "n") { maxM = 7; k = 0.83; width = Math.min(width, 40); }
    let m = -1;
    for (let i = 0; i <= maxM; i++) if (sinr >= MCS_SNR[i]) m = i;
    if (m < 0) return { mcs: -1, rate: 0, mod: "—" };
    return { mcs: m, rate: MCS_RATE[m] * (WFACT[width] || 1) * (streams || 2) * k, mod: MCS_MOD[m] };
  }

  function segX(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
    const den = d1x * d2y - d1y * d2x;
    if (den === 0) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
    return t > 0 && t < 1 && u >= 0 && u <= 1;
  }

  // ---------------- Cálculo ----------------
  function transmitters(scene, band, opts) {
    const out = [];
    (scene.aps || []).forEach((ap, i) => {
      const r = ap.radios && ap.radios[band];
      if (!r || !r.on) return;
      const fl = ap.floor || 0;
      if (fl !== 0 && opts.floors === false) return;
      out.push({ ap, i, r, own: true, floor: fl });
    });
    if (opts.neighbors !== false) (scene.neighbors || []).forEach((ap, i) => {
      const r = ap.radios && ap.radios[band];
      if (!r || !r.on) return;
      out.push({ ap, i, r, own: false, floor: ap.floor || 0 });
    });
    return out;
  }

  function rssiAt(scene, band, t, x, y) {
    const ap = t.ap, fl = t.floor;
    const dx = x - ap.x, dy = y - ap.y, dz = fl * FLOOR_H;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let L = fspl(d, chanFreq(band, t.r.ch), scene.n || 2.2);
    if (fl === 0) {
      const W = scene.walls || [];
      for (let k = 0; k < W.length; k++) {
        const w = W[k];
        if (segX(ap.x, ap.y, x, y, w.x1, w.y1, w.x2, w.y2)) L += MATS[w.m].a[band];
      }
    } else {
      L += SLAB[band] * Math.abs(fl);
    }
    return t.r.p + (ap.gain == null ? 4 : ap.gain) - L;
  }

  function evaluatePoint(scene, band, txs, x, y, std, streams) {
    const rs = txs.map((t) => rssiAt(scene, band, t, x, y));
    let s = -1, best = -999;
    txs.forEach((t, k) => { if (t.own && t.floor === 0 && rs[k] > best) { best = rs[k]; s = k; } });
    if (s < 0) return { rs, s: -1, rssi: -120, sinr: -20, cci: 0, rate: 0 };
    const S = txs[s];
    const N = dbmToMw(noiseFloor(S.r.w));
    let I = 0, cci = 0;
    txs.forEach((t, k) => {
      if (k === s) return;
      const c = coupling(band, S.r.ch, S.r.w, t.r.ch, t.r.w);
      if (c <= 0) return;
      I += dbmToMw(rs[k]) * c;
      if (c > 0.25 && rs[k] > -82) cci++;
    });
    const sinr = best - mwToDbm(N + I);
    const pr = phyRate(sinr, S.r.w, streams || 2, std || "ax");
    const share = 1 / (1 + cci);
    return { rs, s, rssi: best, sinr, cci, phy: pr, rate: pr.rate * 0.65 * share, share };
  }

  function computeField(scene, band, opts) {
    const v = scene.view || { x0: 0, y0: 0, x1: scene.w, y1: scene.h };
    const W = v.x1 - v.x0, H = v.y1 - v.y0;
    const res = Math.max(0.35, Math.sqrt((W * H) / 9000));
    const nx = Math.ceil(W / res), ny = Math.ceil(H / res);
    const txs = transmitters(scene, band, opts);
    const cells = new Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = v.x0 + (i + 0.5) * res, y = v.y0 + (j + 0.5) * res;
      const e = evaluatePoint(scene, band, txs, x, y, opts.std, opts.streams);
      cells[j * nx + i] = { rssi: e.rssi, sinr: e.sinr, cci: e.cci, rate: e.rate, s: e.s };
    }
    return { nx, ny, res, v, cells, txs };
  }

  // ---------------- Escalas de color (estado, con etiquetas) ----------------
  const SCALES = {
    rssi: { unit: "dBm", steps: [
      [-55, "#0f7b3f", "≥ −55 excelente"], [-62, "#3fa34d", "−62 muy buena"], [-67, "#9ac43a", "−67 buena (voz/vídeo)"],
      [-72, "#eab308", "−72 justa (datos)"], [-78, "#f97316", "−78 débil"], [-85, "#dc2626", "−85 muy débil"] ], none: "sin servicio" },
    sinr: { unit: "dB", steps: [
      [30, "#0f7b3f", "≥ 30 dB excelente"], [25, "#3fa34d", "25 muy buena"], [20, "#9ac43a", "20 buena"],
      [15, "#eab308", "15 justa"], [10, "#f97316", "10 mala"], [5, "#dc2626", "5 muy mala"] ], none: "< 5 dB inutilizable" },
    cci: { unit: "APs", steps: [
      [0, "#0f7b3f", "0 sin contención"], [1, "#9ac43a", "1 AP compite"], [2, "#eab308", "2 compiten"],
      [3, "#f97316", "3 compiten"], [4, "#dc2626", "4+ compiten"] ], none: "", inverse: true },
    rate: { unit: "Mbps", steps: [
      [300, "#0f7b3f", "≥ 300 Mbps"], [150, "#3fa34d", "150"], [75, "#9ac43a", "75"],
      [30, "#eab308", "30"], [10, "#f97316", "10"], [1, "#dc2626", "1"] ], none: "< 1 Mbps" },
  };
  function colorFor(mode, val) {
    const sc = SCALES[mode];
    if (sc.inverse) { for (const [lim, c] of sc.steps) if (val <= lim) return c; return sc.steps[sc.steps.length - 1][1]; }
    for (const [lim, c] of sc.steps) if (val >= lim) return c;
    return null;
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  // ---------------- Dibujo de planta ----------------
  function drawPlan(canvas, scene, field, o) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const v = scene.view || { x0: 0, y0: 0, x1: scene.w, y1: scene.h };
    const cssW = canvas.clientWidth || 800;
    const s = cssW / (v.x1 - v.x0);
    const cssH = (v.y1 - v.y0) * s;
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const X = (x) => (x - v.x0) * s, Y = (y) => (y - v.y0) * s;
    o._map = { s, v };

    ctx.fillStyle = cssv("--bg-2"); ctx.fillRect(0, 0, cssW, cssH);
    // exterior (fuera del edificio)
    ctx.fillStyle = cssv("--bg-3"); ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = cssv("--bg-2"); ctx.fillRect(X(0), Y(0), scene.w * s, scene.h * s);

    // mapa de calor
    if (field && o.mode !== "plan") {
      const off = document.createElement("canvas");
      off.width = field.nx; off.height = field.ny;
      const oc = off.getContext("2d");
      const img = oc.createImageData(field.nx, field.ny);
      for (let k = 0; k < field.cells.length; k++) {
        const c = field.cells[k];
        let col = null, a = 165;
        if (o.mode === "server") {
          if (c.s >= 0 && c.rssi > -85) { col = cat(field.txs[c.s].i); a = c.rssi > -67 ? 170 : 90; }
        } else {
          col = colorFor(o.mode, o.mode === "rssi" ? c.rssi : o.mode === "sinr" ? c.sinr : o.mode === "cci" ? c.cci : c.rate);
          if (o.mode === "cci" && c.rssi < -85) col = null;
        }
        if (col) { const [r, g, b] = hexRgb(col); img.data.set([r, g, b, a], k * 4); }
      }
      oc.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, 0, 0, cssW, cssH);
    }

    // contorno del edificio
    ctx.strokeStyle = cssv("--d-muted"); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.strokeRect(X(0), Y(0), scene.w * s, scene.h * s); ctx.setLineDash([]);

    // etiquetas de zonas
    ctx.font = "11px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "center"; ctx.fillStyle = cssv("--d-muted");
    (scene.labels || []).forEach((l) => ctx.fillText(l.t, X(l.x), Y(l.y)));

    // paredes
    ctx.lineCap = "round";
    (scene.walls || []).forEach((w, k) => {
      const m = MATS[w.m];
      ctx.strokeStyle = isDark() && w.m === "metal" ? "#cbd5e1" : m.color;
      ctx.lineWidth = m.w + (o.selWall === k ? 3 : 0);
      ctx.beginPath(); ctx.moveTo(X(w.x1), Y(w.y1)); ctx.lineTo(X(w.x2), Y(w.y2)); ctx.stroke();
    });

    // cables desde el IDF
    if (scene.idf && o.cables !== false) {
      ctx.strokeStyle = cssv("--d-cu"); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      (scene.aps || []).forEach((ap) => {
        if ((ap.floor || 0) !== 0) return;
        ctx.beginPath(); ctx.moveTo(X(scene.idf.x), Y(scene.idf.y));
        ctx.lineTo(X(scene.idf.x), Y(ap.y)); ctx.lineTo(X(ap.x), Y(ap.y)); ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.fillStyle = cssv("--d-box"); ctx.strokeStyle = cssv("--l3"); ctx.lineWidth = 2;
      ctx.fillRect(X(scene.idf.x) - 16, Y(scene.idf.y) - 9, 32, 18);
      ctx.strokeRect(X(scene.idf.x) - 16, Y(scene.idf.y) - 9, 32, 18);
      ctx.fillStyle = cssv("--d-text"); ctx.font = "bold 10px sans-serif"; ctx.fillText("IDF", X(scene.idf.x), Y(scene.idf.y) + 3.5);
    }

    // vecinos
    if (o.neighbors !== false) (scene.neighbors || []).forEach((ap) => {
      const r = ap.radios[o.band];
      ctx.save(); ctx.translate(X(ap.x), Y(ap.y)); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = cssv("--d-box-2"); ctx.strokeStyle = cssv("--d-muted"); ctx.lineWidth = 1.5;
      ctx.fillRect(-6, -6, 12, 12); ctx.strokeRect(-6, -6, 12, 12); ctx.restore();
      ctx.fillStyle = cssv("--d-muted"); ctx.font = "10px sans-serif";
      ctx.fillText(ap.ssid + (r && r.on ? " · ch " + r.ch : ""), X(ap.x), Y(ap.y) - 11);
    });

    // APs de otras plantas
    if (o.floors !== false) (scene.aps || []).forEach((ap) => {
      if ((ap.floor || 0) === 0) return;
      const r = ap.radios[o.band];
      ctx.strokeStyle = cssv("--d-muted"); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(X(ap.x) + (ap.floor > 0 ? 6 : -6), Y(ap.y) + (ap.floor > 0 ? -6 : 6), 7, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssv("--d-muted"); ctx.font = "9px sans-serif";
      ctx.fillText((ap.floor > 0 ? "↑" : "↓") + (r && r.on ? r.ch : "off"), X(ap.x) + (ap.floor > 0 ? 6 : -6), Y(ap.y) + (ap.floor > 0 ? -16 : 22));
    });

    // APs propios
    (scene.aps || []).forEach((ap, i) => {
      if ((ap.floor || 0) !== 0) return;
      const r = ap.radios[o.band];
      const on = r && r.on;
      ctx.beginPath(); ctx.arc(X(ap.x), Y(ap.y), o.sel === i ? 11 : 9, 0, 7);
      ctx.fillStyle = on ? cat(i) : cssv("--bg-3"); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = cssv("--bg-2"); ctx.stroke();
      if (o.sel === i) { ctx.lineWidth = 2; ctx.strokeStyle = cssv("--d-text"); ctx.beginPath(); ctx.arc(X(ap.x), Y(ap.y), 14, 0, 7); ctx.stroke(); }
      ctx.font = "bold 11px sans-serif"; ctx.fillStyle = cssv("--d-text");
      const lab = ap.name + "  " + (on ? "ch " + r.ch + (r.w > 20 ? "/" + r.w : "") + " · " + r.p + " dBm" : "radio off");
      const tw = ctx.measureText(lab).width + 8;
      ctx.fillStyle = cssv("--d-box"); ctx.globalAlpha = 0.85;
      ctx.fillRect(X(ap.x) - tw / 2, Y(ap.y) + 13, tw, 15); ctx.globalAlpha = 1;
      ctx.fillStyle = cssv("--d-text"); ctx.fillText(lab, X(ap.x), Y(ap.y) + 24);
    });

    // sonda
    if (o.probe) {
      ctx.strokeStyle = cssv("--d-text"); ctx.lineWidth = 1.5;
      const px = X(o.probe.x), py = Y(o.probe.y);
      ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py); ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.stroke();
    }
    // pared en construcción
    if (o.draft) {
      ctx.strokeStyle = MATS[o.draft.m].color; ctx.lineWidth = MATS[o.draft.m].w; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(X(o.draft.x1), Y(o.draft.y1)); ctx.lineTo(X(o.draft.x2), Y(o.draft.y2)); ctx.stroke(); ctx.setLineDash([]);
    }
    // escala
    ctx.fillStyle = cssv("--d-muted"); ctx.fillRect(10, cssH - 14, 5 * s, 3);
    ctx.textAlign = "left"; ctx.font = "10px sans-serif"; ctx.fillText("5 m", 14 + 5 * s, cssH - 10);
  }

  // ---------------- Espectro tipo inSSIDer / Acrylic ----------------
  function drawSpectrum(canvas, band, signals, opt) {
    opt = opt || {};
    const B = BANDS[band];
    const ctx = canvas.getContext("2d"), dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 600, H = opt.height || 220;
    canvas.style.height = H + "px";
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padL = 38, padR = 10, padT = 10, padB = 28;
    const yMin = -100, yMax = opt.yMax || -20;
    const fx = (f) => padL + (f - B.f0) / (B.f1 - B.f0) * (W - padL - padR);
    const fy = (d) => padT + (yMax - Math.max(yMin, Math.min(yMax, d))) / (yMax - yMin) * (H - padT - padB);
    ctx.fillStyle = cssv("--bg-2"); ctx.fillRect(0, 0, W, H);
    ctx.font = "10px sans-serif"; ctx.fillStyle = cssv("--fg-3"); ctx.strokeStyle = cssv("--line"); ctx.lineWidth = 1;
    for (let d = -90; d <= yMax; d += 10) {
      ctx.beginPath(); ctx.moveTo(padL, fy(d)); ctx.lineTo(W - padR, fy(d)); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(d, padL - 4, fy(d) + 3);
    }
    ctx.textAlign = "center";
    const ticks = W > 520 ? B.chans.filter((c, i) => band === "2.4" || i % (band === "6" ? 3 : 2) === 0) : B.ticks;
    ticks.forEach((c) => { const x = fx(chanFreq(band, c)); ctx.fillText(c, x, H - padB + 13); });
    ctx.fillText("canal", padL - 18, H - padB + 13);
    if (band === "5") { // zonas DFS
      ctx.fillStyle = isDark() ? "rgba(251,191,36,.08)" : "rgba(234,179,8,.10)";
      ctx.fillRect(fx(5250), padT, fx(5330) - fx(5250), H - padT - padB);
      ctx.fillRect(fx(5490), padT, fx(5710) - fx(5490), H - padT - padB);
      ctx.fillStyle = isDark() ? "rgba(248,113,113,.12)" : "rgba(220,38,38,.10)";
      ctx.fillRect(fx(5590), padT, fx(5650) - fx(5590), H - padT - padB);
      ctx.fillStyle = cssv("--fg-3"); ctx.fillText("DFS", fx(5290), padT + 10); ctx.fillText("DFS", fx(5520), padT + 10); ctx.fillText("radar met.", fx(5620), padT + 10);
    }
    // ruido
    const nf = noiseFloor(20);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = cssv("--fg-3");
    ctx.beginPath(); ctx.moveTo(padL, fy(nf)); ctx.lineTo(W - padR, fy(nf)); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = "left"; ctx.fillStyle = cssv("--fg-3"); ctx.fillText("ruido", W - padR - 30, fy(nf) - 3);

    const sigs = signals.filter((g) => g.rssi > yMin + 2).sort((a, b) => a.rssi - b.rssi);
    sigs.forEach((g) => {
      const [lo, hi] = chanRange(band, g.ch, g.w);
      const c = (lo + hi) / 2, w = hi - lo;
      const col = g.color || cssv("--fg-3");
      ctx.beginPath();
      let first = true;
      for (let f = c - 1.6 * w; f <= c + 1.6 * w; f += 0.5) {
        if (f < B.f0 || f > B.f1) continue;
        const d = g.rssi + mask(f - c, w);
        const x = fx(f), y = fy(d);
        if (first) { ctx.moveTo(x, fy(yMin)); ctx.lineTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.lineTo(fx(Math.min(B.f1, c + 1.6 * w)), fy(yMin)); ctx.closePath();
      ctx.globalAlpha = g.own ? 0.22 : 0.12; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = col;
      if (!g.own) ctx.setLineDash([5, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = "center"; ctx.fillStyle = cssv("--fg");
      ctx.font = (g.own ? "bold " : "") + "10px sans-serif";
      if (g.own || g.rssi > -72) ctx.fillText(g.label, fx(c), fy(g.rssi) - 4);
    });
    ctx.fillStyle = cssv("--fg-3"); ctx.textAlign = "left"; ctx.fillText("dBm", 4, padT + 4);
  }

  // ---------------- Simulador interactivo ----------------
  function el(tag, attrs, html) { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; }

  function FloorSim(root, scene, cfg) {
    cfg = Object.assign({ editable: false, band: "5", mode: "rssi", neighbors: true, floors: true, std: "ax", streams: 2, spectrum: true, height: 220 }, cfg || {});
    this.root = root; this.scene = scene; this.cfg = cfg;
    const st = this.state = { band: cfg.band, mode: cfg.mode, neighbors: cfg.neighbors, floors: cfg.floors, sel: -1, tool: "select", mat: "pladur", probe: null, drag: null, draft: null, std: cfg.std, streams: cfg.streams };
    root.classList.add("sim");
    const bar = el("div", { className: "sim-bar" });
    const bandSel = el("select", {}, Object.keys(BANDS).map((b) => `<option value="${b}">${BANDS[b].name}</option>`).join(""));
    bandSel.value = st.band;
    const modeSel = el("select", {}, `<option value="plan">Solo plano</option><option value="rssi">Señal (RSSI)</option><option value="sinr">Calidad (SINR)</option><option value="cci">Contención cocanal</option><option value="rate">Velocidad estimada</option><option value="server">AP que da servicio</option>`);
    modeSel.value = st.mode;
    const lab = (t, c) => { const l = el("label", {}, `<span>${t}</span>`); l.appendChild(c); return l; };
    bar.appendChild(lab("Banda", bandSel)); bar.appendChild(lab("Vista", modeSel));
    const nb = el("input", { type: "checkbox", checked: st.neighbors });
    const fl = el("input", { type: "checkbox", checked: st.floors });
    const chk = (t, c) => { const l = el("label", { className: "chk" }); l.appendChild(c); l.appendChild(document.createTextNode(" " + t)); return l; };
    if ((scene.neighbors || []).length) bar.appendChild(chk("Wi-Fi vecinos", nb));
    if ((scene.aps || []).some((a) => a.floor)) bar.appendChild(chk("Plantas contiguas", fl));
    let toolBtns = [];
    if (cfg.editable) {
      const tools = el("div", { className: "sim-tools" });
      [["select", "✋ Mover/editar"], ["ap", "+ AP"], ["nb", "+ Vecino"], ["wall", "▬ Pared"], ["erase", "✕ Borrar"]].forEach(([k, t]) => {
        const b = el("button", { type: "button" }, t); b.dataset.tool = k; if (k === st.tool) b.classList.add("on");
        b.onclick = () => { st.tool = k; toolBtns.forEach((x) => x.classList.toggle("on", x === b)); };
        toolBtns.push(b); tools.appendChild(b);
      });
      const matSel = el("select", {}, Object.keys(MATS).map((m) => `<option value="${m}">${MATS[m].name}</option>`).join(""));
      matSel.onchange = () => (st.mat = matSel.value);
      bar.appendChild(tools); bar.appendChild(lab("Material de pared", matSel));
      const nIn = el("input", { type: "range", min: 1.8, max: 3.5, step: 0.1, value: scene.n || 2.2 });
      const nOut = el("span", { className: "mono" }, (scene.n || 2.2).toFixed(1));
      nIn.oninput = () => { scene.n = +nIn.value; nOut.textContent = (+nIn.value).toFixed(1); this.update(); };
      const ln = lab("Mobiliario/personas (n)", nIn); ln.appendChild(nOut); bar.appendChild(ln);
    }
    const stdSel = el("select", {}, `<option value="ax">Wi-Fi 6/6E/7 (ax/be)</option><option value="ac">Wi-Fi 5 (ac)</option><option value="n">Wi-Fi 4 (n)</option>`);
    stdSel.value = st.std; stdSel.onchange = () => { st.std = stdSel.value; this.update(); };
    const ssSel = el("select", {}, `<option value="1">1 (móvil básico)</option><option value="2">2 (portátil/móvil)</option><option value="4">4</option>`);
    ssSel.value = st.streams; ssSel.onchange = () => { st.streams = +ssSel.value; this.update(); };
    bar.appendChild(lab("Cliente", stdSel)); bar.appendChild(lab("Flujos MIMO", ssSel));
    root.appendChild(bar);

    const wrap = el("div", { className: "sim-canvas" });
    const cv = this.canvas = el("canvas");
    wrap.appendChild(cv); root.appendChild(wrap);
    this.legend = el("div", { className: "sim-legend" }); root.appendChild(this.legend);
    const lower = el("div", { className: "sim-lower" });
    this.info = el("div", { className: "sim-info" }, "<p class='muted small'>Pasa el ratón (o toca) sobre el plano para medir en ese punto, como harías con inSSIDer o Acrylic con un portátil.</p>");
    lower.appendChild(this.info);
    if (cfg.spectrum) {
      const sp = el("div", { className: "sim-spec" });
      sp.appendChild(el("div", { className: "small muted" }, "Espectro en el punto medido (vista tipo inSSIDer / Acrylic). Línea continua: tus APs · discontinua: vecinos."));
      this.spec = el("canvas"); sp.appendChild(this.spec); lower.appendChild(sp);
    }
    root.appendChild(lower);
    if (cfg.editable) { this.editor = el("div", { className: "sim-editor" }); root.appendChild(this.editor); }

    bandSel.onchange = () => { st.band = bandSel.value; this.update(); this.renderEditor(); };
    modeSel.onchange = () => { st.mode = modeSel.value; this.redraw(); };
    nb.onchange = () => { st.neighbors = nb.checked; this.update(); };
    fl.onchange = () => { st.floors = fl.checked; this.update(); };

    const pos = (e) => {
      const r = cv.getBoundingClientRect(), m = this.map || { s: 1, v: { x0: 0, y0: 0 } };
      return { x: (e.clientX - r.left) / m.s + m.v.x0, y: (e.clientY - r.top) / m.s + m.v.y0, px: m.s };
    };
    const hitAp = (p, list) => {
      let best = -1, bd = 1e9;
      (list || []).forEach((a, i) => { if ((a.floor || 0) !== 0) return; const d = Math.hypot(a.x - p.x, a.y - p.y) * p.px; if (d < 16 && d < bd) { bd = d; best = i; } });
      return best;
    };
    cv.addEventListener("pointerdown", (e) => {
      const p = pos(e);
      st.probe = { x: p.x, y: p.y };
      if (!cfg.editable) { this.redraw(); this.showProbe(); return; }
      cv.setPointerCapture(e.pointerId);
      if (st.tool === "select") {
        const i = hitAp(p, scene.aps); const k = hitAp(p, scene.neighbors);
        if (i >= 0) { st.sel = i; st.drag = { list: "aps", i }; this.renderEditor(); }
        else if (k >= 0) { st.drag = { list: "neighbors", i: k }; }
      } else if (st.tool === "ap") {
        scene.aps.push(newAp(scene.aps.length, p.x, p.y)); st.sel = scene.aps.length - 1; this.renderEditor(); this.update();
      } else if (st.tool === "nb") {
        scene.neighbors = scene.neighbors || [];
        scene.neighbors.push(newNb(scene.neighbors.length, p.x, p.y)); this.update();
      } else if (st.tool === "wall") {
        st.draft = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, m: st.mat };
      } else if (st.tool === "erase") {
        const i = hitAp(p, scene.aps), k = hitAp(p, scene.neighbors);
        if (i >= 0) { scene.aps.splice(i, 1); st.sel = -1; }
        else if (k >= 0) scene.neighbors.splice(k, 1);
        else {
          let bw = -1, bd = 1e9;
          (scene.walls || []).forEach((w, j) => { const d = distSeg(p.x, p.y, w) * p.px; if (d < 10 && d < bd) { bd = d; bw = j; } });
          if (bw >= 0) scene.walls.splice(bw, 1);
        }
        this.renderEditor(); this.update();
      }
      this.showProbe();
    });
    cv.addEventListener("pointermove", (e) => {
      const p = pos(e);
      st.probe = { x: p.x, y: p.y };
      if (st.drag) {
        const a = scene[st.drag.list][st.drag.i]; a.x = round1(p.x); a.y = round1(p.y); this.update(true);
      } else if (st.draft) {
        let x2 = p.x, y2 = p.y;
        if (Math.abs(x2 - st.draft.x1) < Math.abs(y2 - st.draft.y1)) x2 = st.draft.x1; else y2 = st.draft.y1; // ortogonal
        st.draft.x2 = round1(x2); st.draft.y2 = round1(y2); this.redraw();
      } else { this.redraw(); }
      this.showProbe();
    });
    const up = () => {
      if (st.drag) { st.drag = null; this.update(); }
      if (st.draft) {
        const d = st.draft; st.draft = null;
        if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.4) scene.walls.push({ x1: round1(d.x1), y1: round1(d.y1), x2: d.x2, y2: d.y2, m: d.m });
        this.update();
      }
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);

    if (window.ResizeObserver) new ResizeObserver(() => this.redraw()).observe(wrap);
    new MutationObserver(() => this.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.update();
    this.renderEditor();
  }
  const round1 = (v) => Math.round(v * 10) / 10;
  function distSeg(px, py, w) {
    const vx = w.x2 - w.x1, vy = w.y2 - w.y1, L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - w.x1) * vx + (py - w.y1) * vy) / L));
    return Math.hypot(px - (w.x1 + t * vx), py - (w.y1 + t * vy));
  }
  function newAp(i, x, y) {
    const c5 = [36, 52, 100, 116, 44, 60, 108, 132][i % 8], c24 = [1, 6, 11][i % 3];
    return { name: "AP" + (i + 1), x: round1(x), y: round1(y), gain: 4, ssid: "Empresa",
      radios: { "2.4": { on: true, ch: c24, w: 20, p: 10 }, "5": { on: true, ch: c5, w: 20, p: 15 }, "6": { on: true, ch: [5, 21, 37, 53][i % 4], w: 80, p: 15 } } };
  }
  function newNb(i, x, y) {
    return { ssid: "Vecino-" + (i + 1), x: round1(x), y: round1(y), gain: 3,
      radios: { "2.4": { on: true, ch: [1, 6, 11, 3][i % 4], w: 20, p: 20 }, "5": { on: true, ch: [36, 100, 44][i % 3], w: 80, p: 20 }, "6": { on: false, ch: 37, w: 160, p: 18 } } };
  }

  FloorSim.prototype.update = function (fast) {
    const st = this.state;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      this.field = computeField(this.scene, st.band, { neighbors: st.neighbors, floors: st.floors, std: st.std, streams: st.streams });
      this.redraw(); this.showProbe();
      if (this.cfg.onUpdate) this.cfg.onUpdate(this);
    });
  };
  FloorSim.prototype.redraw = function () {
    const st = this.state, o = { mode: st.mode, band: st.band, sel: st.sel, probe: st.probe, draft: st.draft, neighbors: st.neighbors, floors: st.floors };
    drawPlan(this.canvas, this.scene, this.field, o);
    this.map = o._map;
    this.renderLegend();
  };
  FloorSim.prototype.renderLegend = function () {
    const m = this.state.mode;
    if (m === "plan") { this.legend.innerHTML = matLegend(); return; }
    if (m === "server") {
      this.legend.innerHTML = (this.scene.aps || []).filter((a) => !a.floor).map((a, i) => `<span><i class="sw" style="background:${cat(i)}"></i>${a.name}</span>`).join("") + matLegend();
      return;
    }
    const sc = SCALES[m];
    this.legend.innerHTML = sc.steps.map(([, c, t]) => `<span><i class="sw" style="background:${c}"></i>${t}</span>`).join("") + (sc.none ? `<span><i class="sw" style="background:var(--bg-3)"></i>${sc.none}</span>` : "");
  };
  function matLegend() {
    return `<span class="sep"></span>` + Object.keys(MATS).map((k) => `<span><i class="ln" style="border-color:${MATS[k].color}"></i>${MATS[k].name}</span>`).join("");
  }
  FloorSim.prototype.showProbe = function () {
    const st = this.state;
    if (!st.probe || !this.field) return;
    const txs = this.field.txs;
    const e = evaluatePoint(this.scene, st.band, txs, st.probe.x, st.probe.y, st.std, st.streams);
    const rows = txs.map((t, k) => ({ t, rssi: e.rs[k], k })).sort((a, b) => b.rssi - a.rssi);
    const S = e.s >= 0 ? txs[e.s] : null;
    let h = `<div class="mono small">x=${st.probe.x.toFixed(1)} m · y=${st.probe.y.toFixed(1)} m</div>`;
    if (S) {
      h += `<div class="sim-kpis">
        <div><b>${e.rssi.toFixed(0)}</b><span>dBm RSSI</span></div>
        <div><b>${e.sinr.toFixed(0)}</b><span>dB SINR</span></div>
        <div><b>${e.phy.mcs >= 0 ? "MCS " + e.phy.mcs : "—"}</b><span>${e.phy.mod}</span></div>
        <div><b>${Math.round(e.phy.rate)}</b><span>Mbps PHY</span></div>
        <div><b>${e.cci}</b><span>APs compiten</span></div>
        <div><b>${Math.round(e.rate)}</b><span>Mbps reales*</span></div></div>`;
      h += `<div class="small">Conectado a <b>${S.ap.name}</b> (canal ${S.r.ch}, ${S.r.w} MHz${DFS(S.r.ch) && st.band === "5" ? ", DFS" : ""}).</div>`;
    } else h += `<p class="small">Sin cobertura de tus APs en esta banda.</p>`;
    h += `<div class="table-wrap" style="margin:.5rem 0 0"><table class="tight"><thead><tr><th>Red (SSID)</th><th>AP</th><th>Canal</th><th>Ancho</th><th class="num">RSSI</th><th class="num">Solape</th></tr></thead><tbody>`;
    rows.slice(0, 10).forEach(({ t, rssi }) => {
      const c = S ? coupling(st.band, S.r.ch, S.r.w, t.r.ch, t.r.w) : 0;
      const isS = S && t === S;
      h += `<tr${rssi < -90 ? ' class="muted"' : ""}><td>${t.own ? (t.ap.ssid || "Empresa") : t.ap.ssid}${t.floor ? ` <span class="muted">(${t.floor > 0 ? "planta superior" : "planta inferior"})</span>` : ""}</td><td>${t.own ? `<i class="sw" style="background:${t.floor ? "transparent;border:1px dashed var(--fg-3)" : cat(t.i)}"></i>${t.ap.name}` : "vecino"}${isS ? " ★" : ""}</td><td>${t.r.ch}</td><td>${t.r.w}</td><td class="num">${rssi.toFixed(0)}</td><td class="num">${isS ? "—" : Math.round(c * 100) + " %"}</td></tr>`;
    });
    h += `</tbody></table></div><p class="small muted">* Velocidad real aproximada para un cliente: PHY × 65 % de eficiencia ÷ (1 + APs que compiten por el mismo canal). No incluye el reparto entre los clientes del propio AP.</p>`;
    this.info.innerHTML = h;
    if (this.spec) {
      const sigs = rows.map(({ t, rssi }) => ({ rssi, ch: t.r.ch, w: t.r.w, own: t.own && !t.floor, color: t.own && !t.floor ? cat(t.i) : null, label: t.own ? t.ap.name + (t.floor ? (t.floor > 0 ? "↑" : "↓") : "") : t.ap.ssid }));
      drawSpectrum(this.spec, st.band, sigs, { height: this.cfg.height });
    }
  };
  FloorSim.prototype.renderEditor = function () {
    if (!this.editor) return;
    const st = this.state, ap = this.scene.aps[st.sel];
    if (!ap || ap.floor) { this.editor.innerHTML = "<p class='small muted'>Selecciona un AP con «Mover/editar» para cambiar su canal, ancho y potencia. Arrastra los APs para moverlos. Con «Pared» arrastra para dibujar (se ajusta en horizontal o vertical).</p>"; return; }
    const B = BANDS[st.band], r = ap.radios[st.band];
    this.editor.innerHTML = `<div class="sim-ed-row"><b>${ap.name}</b> · radio ${B.name}
      <label class="chk"><input type="checkbox" data-k="on" ${r.on ? "checked" : ""}> Encendida</label>
      <label>Canal <select data-k="ch">${B.chans.map((c) => `<option ${c === r.ch ? "selected" : ""} value="${c}">${c}${st.band === "5" && DFS(c) ? (WEATHER(c) ? " (DFS radar met.)" : " (DFS)") : ""}</option>`).join("")}</select></label>
      <label>Ancho <select data-k="w">${B.widths.map((w) => `<option ${w === r.w ? "selected" : ""}>${w}</option>`).join("")}</select> MHz</label>
      <label>Potencia <input type="range" min="1" max="${st.band === "2.4" ? 20 : 23}" value="${r.p}" data-k="p"> <span class="mono">${r.p} dBm (${dbmToMw(r.p).toFixed(r.p < 10 ? 1 : 0)} mW)</span></label>
      <label>Ganancia antena <input type="number" min="0" max="12" value="${ap.gain}" data-k="gain" style="width:60px"> dBi</label></div>`;
    this.editor.querySelectorAll("[data-k]").forEach((inp) => {
      const k = inp.dataset.k;
      const fn = () => {
        if (k === "on") r.on = inp.checked;
        else if (k === "gain") ap.gain = +inp.value;
        else r[k] = +inp.value;
        if (k === "p") inp.nextElementSibling.textContent = `${r.p} dBm (${dbmToMw(r.p).toFixed(r.p < 10 ? 1 : 0)} mW)`;
        this.update();
      };
      inp.addEventListener(k === "p" ? "input" : "change", fn);
    });
  };

  window.RF = { MATS, SLAB, BANDS, DFS, WEATHER, MCS_RATE, MCS_SNR, MCS_MOD, dbmToMw, mwToDbm, fspl, noiseFloor, chanRange, chanFreq, mask, coupling, phyRate, computeField, evaluatePoint, transmitters, drawPlan, drawSpectrum, FloorSim, cat, cssv, isDark, newAp, newNb };
})();
