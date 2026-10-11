/* Seguimiento Cámara Tata: visor con escala calibrada, medición de altura
   de columna, índice de incandescencia nocturna y registro local. */
(function () {
  "use strict";

  const CFG = window.CAM_CONFIG || {};
  const LS = {
    ajustes: "tata.ajustes",
    calib: "tata.calib.v2",
    roi: "tata.roi.v2",
    registro: "tata.registro",
    muestras: "tata.muestras"
  };
  try { localStorage.removeItem("tata.calib"); localStorage.removeItem("tata.roi"); } catch (e) {}
  const REF_W = (CFG.calibracion && CFG.calibracion.refW) || 1920;

  // ---------- Estado ----------
  const estado = {
    ajustes: Object.assign({
      alias: CFG.alias || "",
      modo: CFG.modo || "hls",
      hlsUrl: CFG.hlsUrl || "",
      snapshotUrl: CFG.snapshotUrl || "",
      intervaloSnapshot: CFG.intervaloSnapshot || 10,
      intervaloMuestreo: CFG.intervaloMuestreo || 10,
      umbral: CFG.umbralIncandescencia != null ? CFG.umbralIncandescencia : 2,
      muestreo: false,
      brillo: 1,
      contraste: 1
    }, leer(LS.ajustes, {})),
    calib: Object.assign({}, CFG.calibracion || { x: 868.5, y0: 565.6, pxPor100m: 54.1, alturaMax: 500 }, leer(LS.calib, {})),
    roi: Object.assign({}, CFG.roi || { x: 808, y: 525, w: 120, h: 68 }, leer(LS.roi, {})),
    registro: leer(LS.registro, []),
    muestras: leer(LS.muestras, []),
    modoUi: "ver",
    aspecto: CFG.aspectoPorDefecto || 16 / 9,
    marcadorY: null,          // fila del marcador de medición (px ref)
    media: null,              // elemento video/img/iframe
    tipoMedia: null,
    hls: null,
    timerSnap: null,
    timerMuestreo: null,
    pixelesOk: null,          // null desconocido, true/false tras probar
    ultimoCuadro: null,
    ultimoIndice: null
  };

  function leer(k, def) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function guardar(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
  }
  function refH() { return REF_W / estado.aspecto; }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const escenario = $("escenario"), medios = $("medios"), overlay = $("overlay"),
        aviso = $("aviso"), lectura = $("lectura"), estadoEl = $("estado"),
        lienzo = $("lienzo"), indiceEl = $("indice"), grafico = $("grafico");

  const zona = CFG.zonaHoraria || "America/Santiago";
  function horaLocal(d) {
    return new Intl.DateTimeFormat("es-CL", { timeZone: zona, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
  }
  function tictac() { $("reloj").textContent = horaLocal(new Date()).split(" ").pop(); }
  setInterval(tictac, 1000); tictac();

  function setEstado(msg) { estadoEl.textContent = msg; }
  function mostrarAviso(msg) { aviso.textContent = msg; aviso.hidden = !msg; }

  // ---------- Fuente ----------
  function urlSnapshot() {
    return estado.ajustes.snapshotUrl || ("https://ipcamlive.com/player/snapshot.php?alias=" + encodeURIComponent(estado.ajustes.alias));
  }
  function urlIframe() {
    return "https://ipcamlive.com/player/player.php?alias=" + encodeURIComponent(estado.ajustes.alias) + "&autoplay=1";
  }
  // URL del stream HLS. IPCamLive no publica una URL fija: la consulta
  // getcamerastreamstate.php?alias=... devuelve details.address (con
  // esquema y barra final, p. ej. "https://s58.ipcamlive.com/") y
  // details.streamid, que cambian de vez en cuando.
  async function urlHls() {
    if (estado.ajustes.hlsUrl) return estado.ajustes.hlsUrl;
    const u = "https://ipcamlive.com/player/getcamerastreamstate.php?alias=" + encodeURIComponent(estado.ajustes.alias) + "&_=" + Date.now();
    for (let intento = 1; intento <= 3; intento++) {
      let j;
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        j = await r.json();
      } catch (e) {
        throw new Error("no se pudo consultar el estado del stream (" + e.message + ")");
      }
      const d = j.details || j;
      let addr = d.address || "";
      const sid = d.streamid || "";
      if (addr && sid) {
        if (!/^https?:\/\//i.test(addr)) addr = "https://" + addr;
        if (!addr.endsWith("/")) addr += "/";
        return addr + "streams/" + sid + "/stream.m3u8";
      }
      // El stream se activa a pedido; puede tardar unos segundos en aparecer.
      setEstado("Esperando que IPCamLive active el stream (intento " + intento + " de 3)...");
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    throw new Error("IPCamLive no entregó un stream activo para el alias " + estado.ajustes.alias);
  }

  function desconectar() {
    if (estado.hls) { try { estado.hls.destroy(); } catch (e) {} estado.hls = null; }
    if (estado.timerSnap) { clearInterval(estado.timerSnap); estado.timerSnap = null; }
    medios.innerHTML = "";
    estado.media = null; estado.tipoMedia = null; estado.pixelesOk = null; estado.ultimoCuadro = null;
    mostrarAviso("");
  }

  function fijarAspecto(w, h) {
    if (!w || !h) return;
    estado.aspecto = w / h;
    escenario.style.aspectRatio = w + " / " + h;
    dibujarOverlay();
  }

  async function conectar() {
    desconectar();
    estado.mensajeRespaldo = "";
    const a = estado.ajustes;
    if (!a.alias && !a.hlsUrl && !a.snapshotUrl) {
      mostrarAviso("Indique el alias de IPCamLive en el panel Fuente y pulse Conectar.");
      setEstado("Sin fuente.");
      return;
    }
    aplicarFiltro();
    try {
      if (a.modo === "iframe") conectarIframe();
      else if (a.modo === "snapshot") conectarSnapshot();
      else await conectarHls();
    } catch (e) {
      if (a.modo === "hls" && a.alias) respaldoSnapshot(e.message);
      else {
        setEstado("Error al conectar: " + e.message);
        mostrarAviso("No se pudo abrir la fuente en modo " + a.modo + ". " + e.message + ". Pruebe otro modo.");
      }
    }
  }

  // Si el video falla, se sigue con snapshots para no perder la cámara.
  function respaldoSnapshot(motivo) {
    desconectar();
    conectarSnapshot();
    const msg = "HLS falló: " + motivo + ". Usando snapshot.";
    estado.mensajeRespaldo = msg;
    setEstado(msg);
    console.warn(msg);
  }

  function conectarIframe() {
    const f = document.createElement("iframe");
    f.src = urlIframe();
    f.allow = "autoplay; fullscreen";
    f.referrerPolicy = "no-referrer-when-downgrade";
    medios.appendChild(f);
    estado.media = f; estado.tipoMedia = "iframe"; estado.pixelesOk = false;
    escenario.style.aspectRatio = ""; estado.aspecto = CFG.aspectoPorDefecto || 16 / 9;
    dibujarOverlay();
    setEstado("Reproductor oficial (iframe). Se puede medir con la escala; no hay análisis de píxeles.");
  }

  function conectarSnapshot() {
    const img = document.createElement("img");
    img.alt = "Cámara Plaza Tata";
    let conCors = true;
    img.crossOrigin = "anonymous";
    const cargar = () => { img.src = urlSnapshot() + (urlSnapshot().includes("?") ? "&" : "?") + "_=" + Date.now(); };
    img.addEventListener("load", () => {
      fijarAspecto(img.naturalWidth, img.naturalHeight);
      estado.ultimoCuadro = new Date();
      if (estado.pixelesOk === null) probarPixeles();
      setEstado((estado.mensajeRespaldo ? estado.mensajeRespaldo + " · " : "") + "Snapshot " + img.naturalWidth + "×" + img.naturalHeight + " · último cuadro " + horaLocal(estado.ultimoCuadro) +
        (estado.pixelesOk ? " · análisis de píxeles disponible" : " · sin acceso a píxeles (CORS)"));
    });
    img.addEventListener("error", () => {
      if (conCors) { conCors = false; img.removeAttribute("crossorigin"); estado.pixelesOk = false; cargar(); }
      else setEstado("No se pudo cargar el snapshot. Verifique el alias o la URL.");
    });
    medios.appendChild(img);
    estado.media = img; estado.tipoMedia = "img";
    cargar();
    estado.timerSnap = setInterval(cargar, Math.max(2, estado.ajustes.intervaloSnapshot) * 1000);
  }

  async function conectarHls() {
    setEstado("Obteniendo URL del stream...");
    const url = await urlHls();
    const v = document.createElement("video");
    v.muted = true; v.autoplay = true; v.playsInline = true; v.controls = false;
    v.crossOrigin = "anonymous";
    medios.appendChild(v);
    estado.media = v; estado.tipoMedia = "video";
    v.addEventListener("loadedmetadata", () => {
      fijarAspecto(v.videoWidth, v.videoHeight);
      setEstado("HLS " + v.videoWidth + "×" + v.videoHeight + " · en vivo");
    });
    v.addEventListener("playing", () => { estado.ultimoCuadro = new Date(); if (estado.pixelesOk === null) probarPixeles(); });
    v.addEventListener("timeupdate", () => { estado.ultimoCuadro = new Date(); });
    if (window.Hls && window.Hls.isSupported()) {
      const h = new window.Hls({ liveSyncDurationCount: 3, enableWorker: true });
      estado.hls = h;
      let fallos = 0;
      h.on(window.Hls.Events.ERROR, (ev, d) => {
        if (!d.fatal) return;
        fallos++;
        const detalle = d.type + " " + (d.details || "") + (d.response && d.response.code != null ? " (HTTP " + d.response.code + ")" : "");
        if (fallos > 3) { respaldoSnapshot(detalle); return; }
        setEstado("Error HLS: " + detalle + ". Reintentando (" + fallos + " de 3)...");
        if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError(); else h.startLoad();
      });
      h.on(window.Hls.Events.FRAG_LOADED, () => { fallos = 0; });
      h.loadSource(url); h.attachMedia(v);
      h.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url; v.play().catch(() => {});
    } else {
      throw new Error("este navegador no soporta HLS");
    }
  }

  function aplicarFiltro() {
    const a = estado.ajustes;
    const f = (a.brillo !== 1 || a.contraste !== 1) ? "brightness(" + a.brillo + ") contrast(" + a.contraste + ")" : "";
    medios.style.filter = f;
  }

  // ---------- Píxeles ----------
  function dibujarCuadro() {
    const m = estado.media;
    if (!m || estado.tipoMedia === "iframe") return null;
    const w = estado.tipoMedia === "video" ? m.videoWidth : m.naturalWidth;
    const h = estado.tipoMedia === "video" ? m.videoHeight : m.naturalHeight;
    if (!w || !h) return null;
    lienzo.width = w; lienzo.height = h;
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(m, 0, 0, w, h);
    return { ctx, w, h };
  }
  function probarPixeles() {
    const c = dibujarCuadro();
    if (!c) return;
    try { c.ctx.getImageData(0, 0, 1, 1); estado.pixelesOk = true; }
    catch (e) { estado.pixelesOk = false; }
    if (!estado.pixelesOk) setEstado(estadoEl.textContent + " · sin acceso a píxeles (CORS)");
  }

  // Índice de incandescencia: % de píxeles rojizos o saturados en la ROI.
  function calcularIndice() {
    if (!estado.pixelesOk) return null;
    const c = dibujarCuadro();
    if (!c) return null;
    const f = c.w / REF_W;
    const r = estado.roi;
    const x = Math.max(0, Math.round(r.x * f)), y = Math.max(0, Math.round(r.y * f));
    const w = Math.min(c.w - x, Math.round(r.w * f)), h = Math.min(c.h - y, Math.round(r.h * f));
    if (w <= 0 || h <= 0) return null;
    let datos;
    try { datos = c.ctx.getImageData(x, y, w, h).data; } catch (e) { estado.pixelesOk = false; return null; }
    let calientes = 0, lumRoi = 0;
    for (let i = 0; i < datos.length; i += 4) {
      const R = datos[i], G = datos[i + 1], B = datos[i + 2];
      lumRoi += 0.299 * R + 0.587 * G + 0.114 * B;
      if ((R >= 140 && R > G * 1.25 && R > B * 1.6) || (R >= 250 && G >= 200)) calientes++;
    }
    const n = datos.length / 4;
    // Luminancia media de todo el cuadro para distinguir noche de día.
    let lumCuadro = null;
    try {
      const paso = Math.max(1, Math.floor(c.w / 160));
      const d2 = c.ctx.getImageData(0, 0, c.w, c.h).data;
      let s = 0, k = 0;
      for (let yy = 0; yy < c.h; yy += paso) for (let xx = 0; xx < c.w; xx += paso) {
        const i = (yy * c.w + xx) * 4; s += 0.299 * d2[i] + 0.587 * d2[i + 1] + 0.114 * d2[i + 2]; k++;
      }
      lumCuadro = s / k;
    } catch (e) {}
    return { indice: 100 * calientes / n, lumRoi: lumRoi / n, lumCuadro };
  }

  function muestrear() {
    const m = calcularIndice();
    if (!m) { indiceEl.innerHTML = "Índice: <strong>no disponible</strong>"; return; }
    estado.ultimoIndice = m.indice;
    const t = new Date();
    estado.muestras.push({ t: t.toISOString(), indice: +m.indice.toFixed(2), lumRoi: +m.lumRoi.toFixed(1), lumCuadro: m.lumCuadro != null ? +m.lumCuadro.toFixed(1) : null });
    if (estado.muestras.length > 5000) estado.muestras.splice(0, estado.muestras.length - 5000);
    guardar(LS.muestras, estado.muestras);
    const alerta = m.indice >= estado.ajustes.umbral;
    indiceEl.classList.toggle("alerta", alerta);
    indiceEl.innerHTML = "Índice: <strong>" + m.indice.toFixed(2) + " %</strong> · luminancia ROI " + m.lumRoi.toFixed(0) +
      (m.lumCuadro != null ? " · cuadro " + m.lumCuadro.toFixed(0) + (m.lumCuadro < 40 ? " (noche)" : "") : "") + (alerta ? " · INCANDESCENCIA" : "");
    dibujarGrafico();
  }
  function reprogramarMuestreo() {
    if (estado.timerMuestreo) { clearInterval(estado.timerMuestreo); estado.timerMuestreo = null; }
    if (estado.ajustes.muestreo) {
      muestrear();
      estado.timerMuestreo = setInterval(muestrear, Math.max(2, estado.ajustes.intervaloMuestreo) * 1000);
    }
  }

  function dibujarGrafico() {
    const ctx = grafico.getContext("2d");
    if (grafico.clientWidth) grafico.width = grafico.clientWidth;
    const W = grafico.width, H = grafico.height, pad = 28;
    ctx.clearRect(0, 0, W, H);
    const ms = estado.muestras.slice(-600);
    ctx.strokeStyle = "#2a333d"; ctx.lineWidth = 1;
    ctx.strokeRect(pad, 6, W - pad - 6, H - 6 - 18);
    if (!ms.length) return;
    const max = Math.max(5, estado.ajustes.umbral * 2, ...ms.map(s => s.indice));
    const t0 = new Date(ms[0].t).getTime(), t1 = new Date(ms[ms.length - 1].t).getTime() || t0 + 1;
    const X = (t) => pad + (W - pad - 6) * ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0));
    const Y = (v) => (H - 18) - (H - 24) * (v / max);
    // umbral
    ctx.strokeStyle = "#e5533d"; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(pad, Y(estado.ajustes.umbral)); ctx.lineTo(W - 6, Y(estado.ajustes.umbral)); ctx.stroke(); ctx.setLineDash([]);
    // serie
    ctx.strokeStyle = "#f4a261"; ctx.lineWidth = 2; ctx.beginPath();
    ms.forEach((s, i) => { const x = X(s.t), y = Y(s.indice); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = "#9aa7b4"; ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(max.toFixed(0) + "%", 2, 14); ctx.fillText("0", 14, H - 20);
    const fmt = (t) => horaLocal(new Date(t)).split(" ").pop().slice(0, 5);
    ctx.fillText(fmt(ms[0].t), pad, H - 4); const fin = fmt(ms[ms.length - 1].t); ctx.fillText(fin, W - 6 - ctx.measureText(fin).width, H - 4);
  }

  // ---------- Overlay (escala, marcador, ROI) ----------
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, texto) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (texto != null) e.textContent = texto;
    return e;
  }
  function alturaDesdeY(y) { return (estado.calib.y0 - y) / estado.calib.pxPor100m * 100; }
  function yDesdeAltura(h) { return estado.calib.y0 - h / 100 * estado.calib.pxPor100m; }

  function dibujarOverlay() {
    const c = estado.calib, H = refH();
    overlay.setAttribute("viewBox", "0 0 " + REF_W + " " + H);
    overlay.innerHTML = "";
    const g = el("g", { "font-family": "system-ui, sans-serif", "font-size": 15, "fill": "#fff",
      "stroke-linecap": "round", "paint-order": "stroke", "stroke": "rgba(0,0,0,0.75)", "stroke-width": 3 });
    const yTop = yDesdeAltura(c.alturaMax);
    g.appendChild(el("line", { x1: c.x, y1: c.y0, x2: c.x, y2: yTop, stroke: "rgba(0,0,0,0.6)", "stroke-width": 5 }));
    g.appendChild(el("line", { x1: c.x, y1: c.y0, x2: c.x, y2: yTop, stroke: "#fff", "stroke-width": 2 }));
    for (let h = 0; h <= c.alturaMax + 1e-6; h += 100) {
      const y = yDesdeAltura(h);
      g.appendChild(el("line", { x1: c.x - 12, y1: y, x2: c.x + 12, y2: y, stroke: "#fff", "stroke-width": 2 }));
      g.appendChild(el("text", { x: c.x + 18, y: y + 5 }, String(h)));
    }
    for (let h = 50; h < c.alturaMax; h += 100) {
      const y = yDesdeAltura(h);
      g.appendChild(el("line", { x1: c.x - 6, y1: y, x2: c.x + 6, y2: y, stroke: "#fff", "stroke-width": 1.5 }));
    }
    overlay.appendChild(g);

    // Marcador de medición
    if (estado.marcadorY != null) {
      const y = estado.marcadorY, h = alturaDesdeY(y);
      const gm = el("g", { stroke: "#f4a261", "stroke-width": 2 });
      gm.appendChild(el("line", { x1: 0, y1: y, x2: REF_W, y2: y, "stroke-dasharray": "8 6" }));
      gm.appendChild(el("circle", { cx: c.x, cy: y, r: 6, fill: "#f4a261", stroke: "#000" }));
      const et = el("text", { x: c.x - 18, y: y - 10, "text-anchor": "end", fill: "#f4a261", "font-size": 18, "font-weight": "700",
        stroke: "rgba(0,0,0,0.8)", "stroke-width": 4, "paint-order": "stroke", "font-family": "system-ui, sans-serif" }, Math.round(h / 10) * 10 + " m");
      gm.appendChild(et);
      overlay.appendChild(gm);
    }

    // ROI y manijas en modo calibrar
    const r = estado.roi;
    if (estado.modoUi === "calibrar" || estado.ajustes.muestreo) {
      overlay.appendChild(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "rgba(229,83,61,0.12)", stroke: "#e5533d",
        "stroke-width": 1.5, "stroke-dasharray": "5 4", class: estado.modoUi === "calibrar" ? "arrastrable" : "", "data-manija": "roi" }));
    }
    if (estado.modoUi === "calibrar") {
      overlay.appendChild(el("circle", { cx: c.x, cy: c.y0, r: 10, fill: "#4cc9f0", stroke: "#000", "stroke-width": 2, class: "arrastrable", "data-manija": "base" }));
      overlay.appendChild(el("circle", { cx: c.x, cy: yTop, r: 10, fill: "#52b788", stroke: "#000", "stroke-width": 2, class: "arrastrable", "data-manija": "tope" }));
      overlay.appendChild(el("text", { x: c.x - 18, y: c.y0 + 5, "text-anchor": "end", fill: "#4cc9f0", "font-size": 14, stroke: "rgba(0,0,0,0.8)",
        "stroke-width": 3, "paint-order": "stroke", "font-family": "system-ui, sans-serif" }, "0 m: arrastre a la cumbre"));
      overlay.appendChild(el("text", { x: c.x - 18, y: yTop + 5, "text-anchor": "end", fill: "#52b788", "font-size": 14, stroke: "rgba(0,0,0,0.8)",
        "stroke-width": 3, "paint-order": "stroke", "font-family": "system-ui, sans-serif" }, c.alturaMax + " m: arrastre para escalar"));
      // esquina de la ROI para redimensionar
      overlay.appendChild(el("rect", { x: r.x + r.w - 7, y: r.y + r.h - 7, width: 14, height: 14, fill: "#e5533d", stroke: "#000", class: "arrastrable", "data-manija": "roi-esq" }));
    }
    actualizarLectura();
  }

  function actualizarLectura() {
    if (estado.marcadorY == null) { lectura.innerHTML = "Altura: <strong>--</strong>"; return; }
    const h = alturaDesdeY(estado.marcadorY);
    lectura.innerHTML = "Altura: <strong>" + Math.round(h / 10) * 10 + " m</strong> sobre la cumbre";
  }

  function puntoSvg(ev) {
    const rect = overlay.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) / rect.width * REF_W, y: (ev.clientY - rect.top) / rect.height * refH() };
  }

  let arrastre = null;
  overlay.addEventListener("pointerdown", (ev) => {
    if (estado.modoUi === "ver") return;
    const p = puntoSvg(ev);
    overlay.setPointerCapture(ev.pointerId);
    if (estado.modoUi === "medir") { estado.marcadorY = p.y; arrastre = { tipo: "marcador" }; dibujarOverlay(); return; }
    const m = ev.target.getAttribute && ev.target.getAttribute("data-manija");
    if (!m) return;
    arrastre = { tipo: m, p0: p, calib0: Object.assign({}, estado.calib), roi0: Object.assign({}, estado.roi) };
  });
  overlay.addEventListener("pointermove", (ev) => {
    if (!arrastre) return;
    const p = puntoSvg(ev);
    if (arrastre.tipo === "marcador") { estado.marcadorY = p.y; dibujarOverlay(); return; }
    const dx = p.x - arrastre.p0.x, dy = p.y - arrastre.p0.y, c0 = arrastre.calib0, r0 = arrastre.roi0;
    if (arrastre.tipo === "base") {
      estado.calib.x = c0.x + dx; estado.calib.y0 = c0.y0 + dy;
      estado.roi.x = r0.x + dx; estado.roi.y = r0.y + dy;
    } else if (arrastre.tipo === "tope") {
      const yTop = c0.y0 - c0.alturaMax / 100 * c0.pxPor100m + dy;
      estado.calib.pxPor100m = Math.max(2, (c0.y0 - yTop) / (c0.alturaMax / 100));
    } else if (arrastre.tipo === "roi") {
      estado.roi.x = r0.x + dx; estado.roi.y = r0.y + dy;
    } else if (arrastre.tipo === "roi-esq") {
      estado.roi.w = Math.max(10, r0.w + dx); estado.roi.h = Math.max(10, r0.h + dy);
    }
    dibujarOverlay(); llenarCalib();
  });
  const soltar = () => {
    if (!arrastre) return;
    if (arrastre.tipo !== "marcador") { guardar(LS.calib, estado.calib); guardar(LS.roi, estado.roi); }
    arrastre = null;
  };
  overlay.addEventListener("pointerup", soltar);
  overlay.addEventListener("pointercancel", soltar);

  function fijarModoUi(m) {
    estado.modoUi = m;
    document.querySelectorAll("[data-modo]").forEach(b => b.classList.toggle("activo", b.dataset.modo === m));
    overlay.classList.toggle("interactivo", m !== "ver");
    overlay.classList.toggle("calibrar", m === "calibrar");
    if (m === "calibrar") $("panel-cal").open = true;
    dibujarOverlay();
  }
  document.querySelectorAll("[data-modo]").forEach(b => b.addEventListener("click", () => fijarModoUi(b.dataset.modo)));

  // ---------- Captura PNG ----------
  $("btn-capturar").addEventListener("click", () => {
    const c = dibujarCuadro();
    if (!c) { alert("No hay cuadro capturable en este modo. Use HLS o snapshot."); return; }
    const { ctx, w, h } = c, f = w / REF_W, cal = estado.calib;
    const px = (v) => v * f;
    ctx.lineCap = "round"; ctx.font = "bold " + Math.round(16 * f) + "px sans-serif"; ctx.textBaseline = "middle";
    const trazo = (x1, y1, x2, y2, ancho, color) => { ctx.strokeStyle = color; ctx.lineWidth = ancho; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const texto = (t, x, y, color) => { ctx.lineWidth = 4 * f; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(t, x, y); ctx.fillStyle = color || "#fff"; ctx.fillText(t, x, y); };
    const yTop = yDesdeAltura(cal.alturaMax);
    trazo(px(cal.x), px(cal.y0), px(cal.x), px(yTop), 5 * f, "rgba(0,0,0,0.6)");
    trazo(px(cal.x), px(cal.y0), px(cal.x), px(yTop), 2 * f, "#fff");
    for (let hh = 0; hh <= cal.alturaMax + 1e-6; hh += 100) {
      const y = px(yDesdeAltura(hh));
      trazo(px(cal.x) - 12 * f, y, px(cal.x) + 12 * f, y, 2 * f, "#fff");
      texto(String(hh), px(cal.x) + 18 * f, y);
    }
    if (estado.marcadorY != null) {
      const y = px(estado.marcadorY);
      ctx.setLineDash([8 * f, 6 * f]); trazo(0, y, w, y, 2 * f, "#f4a261"); ctx.setLineDash([]);
      ctx.textAlign = "right"; texto(Math.round(alturaDesdeY(estado.marcadorY) / 10) * 10 + " m", px(cal.x) - 18 * f, y - 12 * f, "#f4a261"); ctx.textAlign = "left";
    }
    const ahora = new Date();
    texto("Cámara Tata · " + horaLocal(ahora) + (estado.ultimoIndice != null ? " · índice " + estado.ultimoIndice.toFixed(2) + " %" : ""), 12 * f, h - 16 * f);
    let url;
    try { url = lienzo.toDataURL("image/png"); } catch (e) { alert("El navegador no permite exportar el cuadro (CORS). Use una captura de pantalla."); return; }
    const a = document.createElement("a");
    a.href = url; a.download = "tata_" + ahora.toISOString().replace(/[:.]/g, "-") + ".png"; a.click();
  });

  // ---------- Registro ----------
  function renderRegistro() {
    const tb = $("tabla").querySelector("tbody");
    tb.innerHTML = "";
    estado.registro.slice().reverse().forEach((r, i) => {
      const idx = estado.registro.length - 1 - i;
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + horaLocal(new Date(r.t)) + "</td><td>" + r.tipo + "</td><td class='num'>" + (r.altura != null ? r.altura : "") +
        "</td><td class='num'>" + (r.indice != null ? r.indice.toFixed(2) : "") + "</td><td>" + escapar(r.nota || "") +
        "</td><td><button class='quitar' title='Quitar' data-i='" + idx + "'>✕</button></td>";
      tb.appendChild(tr);
    });
  }
  function escapar(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  $("tabla").addEventListener("click", (ev) => {
    const b = ev.target.closest(".quitar"); if (!b) return;
    estado.registro.splice(+b.dataset.i, 1); guardar(LS.registro, estado.registro); renderRegistro();
  });
  $("btn-registrar").addEventListener("click", () => {
    const tipo = $("r-tipo").value;
    const m = estado.ajustes.muestreo || estado.pixelesOk ? calcularIndice() : null;
    estado.registro.push({
      t: new Date().toISOString(), tipo,
      altura: estado.marcadorY != null && tipo !== "nubosidad" ? Math.round(alturaDesdeY(estado.marcadorY) / 10) * 10 : null,
      indice: m ? +m.indice.toFixed(2) : null,
      nota: $("r-nota").value.trim()
    });
    guardar(LS.registro, estado.registro); renderRegistro(); $("r-nota").value = "";
  });
  function descargarCsv(nombre, filas) {
    const csv = "﻿" + filas.map(f => f.map(v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = nombre; a.click();
  }
  $("btn-exp-registro").addEventListener("click", () => {
    descargarCsv("registro_tata.csv", [["fecha_hora_local", "iso_utc", "tipo", "altura_m", "indice_pct", "nota"]]
      .concat(estado.registro.map(r => [horaLocal(new Date(r.t)), r.t, r.tipo, r.altura, r.indice, r.nota])));
  });
  $("btn-borrar-registro").addEventListener("click", () => {
    if (confirm("¿Borrar todo el registro de observaciones de este navegador?")) { estado.registro = []; guardar(LS.registro, []); renderRegistro(); }
  });
  $("btn-exp-muestras").addEventListener("click", () => {
    descargarCsv("muestras_incandescencia.csv", [["fecha_hora_local", "iso_utc", "indice_pct", "lum_roi", "lum_cuadro"]]
      .concat(estado.muestras.map(s => [horaLocal(new Date(s.t)), s.t, s.indice, s.lumRoi, s.lumCuadro])));
  });
  $("btn-borrar-muestras").addEventListener("click", () => {
    if (confirm("¿Borrar las muestras del índice de incandescencia?")) { estado.muestras = []; guardar(LS.muestras, []); dibujarGrafico(); }
  });

  // ---------- Formularios ----------
  function llenarFuente() {
    const a = estado.ajustes;
    $("in-alias").value = a.alias; $("in-modo").value = a.modo; $("in-hls").value = a.hlsUrl; $("in-snap").value = a.snapshotUrl;
    $("in-int-snap").value = a.intervaloSnapshot; $("n-int").value = a.intervaloMuestreo; $("n-umbral").value = a.umbral;
    $("n-muestreo").checked = !!a.muestreo; $("n-brillo").value = a.brillo; $("n-contraste").value = a.contraste;
  }
  function leerFuente() {
    const a = estado.ajustes;
    a.alias = $("in-alias").value.trim(); a.modo = $("in-modo").value; a.hlsUrl = $("in-hls").value.trim(); a.snapshotUrl = $("in-snap").value.trim();
    a.intervaloSnapshot = +$("in-int-snap").value || 10;
    guardar(LS.ajustes, a);
  }
  function llenarCalib() {
    const c = estado.calib, r = estado.roi;
    $("cal-x").value = c.x.toFixed(1); $("cal-y0").value = c.y0.toFixed(1); $("cal-px").value = c.pxPor100m.toFixed(2); $("cal-max").value = c.alturaMax;
    $("cal-roi").value = [r.x, r.y, r.w, r.h].map(v => Math.round(v)).join(", ");
  }
  $("btn-conectar").addEventListener("click", () => { leerFuente(); conectar(); });
  $("btn-abrir-cam").addEventListener("click", () => window.open("https://www.nevadosdechillan.com/camaras", "_blank", "noopener"));
  $("btn-cal-aplicar").addEventListener("click", () => {
    const c = estado.calib;
    c.x = +$("cal-x").value; c.y0 = +$("cal-y0").value; c.pxPor100m = Math.max(2, +$("cal-px").value); c.alturaMax = Math.max(100, +$("cal-max").value);
    const partes = $("cal-roi").value.split(/[,\s]+/).map(Number).filter(v => !isNaN(v));
    if (partes.length === 4) estado.roi = { x: partes[0], y: partes[1], w: partes[2], h: partes[3] };
    guardar(LS.calib, c); guardar(LS.roi, estado.roi); dibujarOverlay(); llenarCalib();
  });
  $("btn-cal-reset").addEventListener("click", () => {
    estado.calib = Object.assign({}, CFG.calibracion); estado.roi = Object.assign({}, CFG.roi);
    localStorage.removeItem(LS.calib); localStorage.removeItem(LS.roi); dibujarOverlay(); llenarCalib();
  });
  const guardarNoche = () => {
    const a = estado.ajustes;
    a.brillo = +$("n-brillo").value; a.contraste = +$("n-contraste").value; a.muestreo = $("n-muestreo").checked;
    a.intervaloMuestreo = +$("n-int").value || 10; a.umbral = +$("n-umbral").value || 0;
    guardar(LS.ajustes, a); aplicarFiltro(); dibujarOverlay();
  };
  ["n-brillo", "n-contraste", "n-int", "n-umbral"].forEach(id => $(id).addEventListener("input", guardarNoche));
  $("n-muestreo").addEventListener("change", () => { guardarNoche(); reprogramarMuestreo(); });
  ["n-int"].forEach(id => $(id).addEventListener("change", reprogramarMuestreo));
  $("btn-noche").addEventListener("click", () => { $("n-brillo").value = 2.2; $("n-contraste").value = 1.4; guardarNoche(); });
  $("btn-dia").addEventListener("click", () => { $("n-brillo").value = 1; $("n-contraste").value = 1; guardarNoche(); });

  // ---------- Inicio ----------
  llenarFuente(); llenarCalib(); renderRegistro(); dibujarGrafico(); dibujarOverlay();
  conectar().then(reprogramarMuestreo);
})();
