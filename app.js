/* Seguimiento Cámara Tata: visor con escala calibrada, medición de altura
   de columna, índice de incandescencia nocturna y registro local. */
(function () {
  "use strict";

  const VERSION = "2026-10-12 b";
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
      umbralBrillo: CFG.umbralBrillo != null ? CFG.umbralBrillo : 200,
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
  const fmtHora = (tz) => new Intl.DateTimeFormat("es-CL", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtLocal = fmtHora(zona), fmtUtc = fmtHora("UTC");
  function tictac() {
    const d = new Date();
    $("reloj-local").textContent = fmtLocal.format(d);
    $("reloj-utc").textContent = fmtUtc.format(d);
  }
  setInterval(tictac, 1000); tictac();

  function setEstado(msg) { estadoEl.textContent = msg; marcarFuente(); }

  // Resalta Video o Snapshot según lo que realmente se está mostrando
  // (si el video falla y se pasa a snapshot, se ve reflejado).
  function marcarFuente() {
    const actual = estado.tipoMedia === "video" ? "hls" : estado.tipoMedia === "img" ? "snapshot" : "";
    document.querySelectorAll("[data-fuente]").forEach(b => b.classList.toggle("activo", b.dataset.fuente === actual));
  }
  function mostrarAviso(msg) { aviso.textContent = msg; aviso.hidden = !msg; }

  // ---------- Fuente ----------
  function urlSnapshot() {
    return estado.ajustes.snapshotUrl || ("https://ipcamlive.com/player/snapshot.php?alias=" + encodeURIComponent(estado.ajustes.alias));
  }
  function urlIframe() {
    return "https://ipcamlive.com/player/player.php?alias=" + encodeURIComponent(estado.ajustes.alias) + "&autoplay=1";
  }
  // Una página servida por https (GitHub Pages) no puede cargar recursos
  // http: el navegador los bloquea como contenido mixto. En ese caso se
  // pide la misma dirección por https.
  function seguro(url) {
    return location.protocol === "https:" ? url.replace(/^http:\/\//i, "https://") : url;
  }

  // URL del stream HLS. IPCamLive no publica una URL fija: la consulta
  // getcamerastreamstate.php?alias=... devuelve details.address (con
  // esquema y barra final, p. ej. "https://s58.ipcamlive.com/") y
  // details.streamid, que cambian de vez en cuando.
  async function urlHls() {
    if (estado.ajustes.hlsUrl) return seguro(estado.ajustes.hlsUrl);
    const u = "https://ipcamlive.com/player/getcamerastreamstate.php?alias=" + encodeURIComponent(estado.ajustes.alias) + "&_=" + Date.now();
    for (let intento = 1; intento <= 3; intento++) {
      let j;
      try {
        const r = await fetch(u, { cache: "no-store", referrerPolicy: "no-referrer" });
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
        return seguro(addr + "streams/" + sid + "/stream.m3u8");
      }
      // El stream se activa a pedido; puede tardar unos segundos en aparecer.
      setEstado("Esperando que IPCamLive active el stream (intento " + intento + " de 3)...");
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    throw new Error("IPCamLive no entregó un stream activo para el alias " + estado.ajustes.alias);
  }

  function desconectar() {
    estado.conexion = (estado.conexion || 0) + 1;
    if (estado.hls) { try { estado.hls.destroy(); } catch (e) {} estado.hls = null; }
    if (estado.timerSnap) { clearInterval(estado.timerSnap); estado.timerSnap = null; }
    medios.innerHTML = "";
    estado.media = null; estado.tipoMedia = null; estado.pixelesOk = null; estado.ultimoCuadro = null;
    mostrarAviso("");
  }

  function fijarAspecto(w, h) {
    if (!w || !h) return;
    estado.aspecto = w / h;
    document.documentElement.style.setProperty("--aspecto", String(w / h));
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
    f.referrerPolicy = "no-referrer";
    medios.appendChild(f);
    estado.media = f; estado.tipoMedia = "iframe"; estado.pixelesOk = false;
    estado.aspecto = CFG.aspectoPorDefecto || 16 / 9;
    document.documentElement.style.setProperty("--aspecto", String(estado.aspecto));
    dibujarOverlay();
    setEstado("Reproductor oficial (iframe). Se puede medir con la escala; no hay análisis de píxeles.");
  }

  function conectarSnapshot() {
    const img = document.createElement("img");
    img.alt = "Cámara Plaza Tata";
    let conCors = true;
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    const cargar = () => { img.src = urlSnapshot() + (urlSnapshot().includes("?") ? "&" : "?") + "_=" + Date.now(); };
    img.addEventListener("load", () => {
      fijarAspecto(img.naturalWidth, img.naturalHeight);
      estado.ultimoCuadro = new Date();
      if (estado.pixelesOk === null) probarPixeles();
      actualizarInserto();
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

  // Cada reintento vuelve a consultar la URL del stream, porque IPCamLive
  // puede haberla cambiado. Tras tres fallos se pasa a snapshot.
  async function conectarHls(intento) {
    intento = intento || 1;
    const conexion = estado.conexion;
    setEstado("Obteniendo URL del stream..." + (intento > 1 ? " (intento " + intento + " de 3)" : ""));
    const url = await urlHls();
    if (conexion !== estado.conexion) return;
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

    const reintentar = (detalle) => {
      if (conexion !== estado.conexion) return;
      const donde = " en " + url.replace(/^https?:\/\//, "").split("/")[0];
      if (intento >= 3) { respaldoSnapshot(detalle + donde); return; }
      desconectar();
      estado.conexion = conexion;          // misma conexión lógica
      setEstado("Error HLS: " + detalle + donde + ". Reintentando (" + intento + " de 3)...");
      setTimeout(() => {
        if (conexion !== estado.conexion) return;
        conectarHls(intento + 1).catch((e) => respaldoSnapshot(e.message));
      }, 3000);
    };

    if (window.Hls && window.Hls.isSupported()) {
      const h = new window.Hls({ liveSyncDurationCount: 3, enableWorker: true,
        fetchSetup: (ctx, init) => new Request(ctx.url, Object.assign({}, init, { referrerPolicy: "no-referrer" })) });
      estado.hls = h;
      let recuperado = false;
      h.on(window.Hls.Events.ERROR, (ev, d) => {
        if (!d.fatal) return;
        const detalle = d.type + " " + (d.details || "") + (d.response && d.response.code != null ? " (HTTP " + d.response.code + ")" : "");
        if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && !recuperado) { recuperado = true; h.recoverMediaError(); return; }
        reintentar(detalle);
      });
      h.loadSource(url); h.attachMedia(v);
      h.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.addEventListener("error", () => reintentar("error de reproducción"));
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

  // Clasificación de un píxel de la ROI:
  //   1 rojizo    : brillante y con dominante roja (resplandor anaranjado).
  //                 Solo puede ocurrir cuando la cámara transmite en color.
  //   2 brillante : luminancia sobre el umbral de brillo. De noche la cámara
  //                 pasa a blanco y negro, y este es el criterio que cuenta.
  //   0 resto
  // El índice de incandescencia es el porcentaje de píxeles de clase 1 o 2.
  function clasePixel(R, G, B, umbralBrillo) {
    if (R >= 140 && R > G * 1.25 && R > B * 1.6) return 1;
    if (0.299 * R + 0.587 * G + 0.114 * B >= umbralBrillo) return 2;
    return 0;
  }

  // Mancha conectada más grande (vecindad de 8) entre los píxeles
  // detectados. Se ignoran manchas de menos de MIN_PX_MANCHA píxeles,
  // que suelen ser ruido del sensor.
  const MIN_PX_MANCHA = 6;
  function manchaMayor(clases, w, h) {
    const visto = new Uint8Array(clases.length), cola = new Int32Array(clases.length);
    let mejor = null;
    for (let p0 = 0; p0 < clases.length; p0++) {
      if (!clases[p0] || visto[p0]) continue;
      let ini = 0, fin = 0, n = 0, top = h, bot = -1, izq = w, der = -1;
      cola[fin++] = p0; visto[p0] = 1;
      while (ini < fin) {
        const p = cola[ini++], x = p % w, y = (p - x) / w;
        n++;
        if (y < top) top = y; if (y > bot) bot = y; if (x < izq) izq = x; if (x > der) der = x;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (clases[q] && !visto[q]) { visto[q] = 1; cola[fin++] = q; }
        }
      }
      if (!mejor || n > mejor.n) mejor = { n, top, bot, izq, der };
    }
    return mejor && mejor.n >= MIN_PX_MANCHA ? mejor : null;
  }

  // Convierte la mancha a coordenadas de referencia y a metros con la
  // calibración: tope sobre la cumbre, alto y ancho. En el plano del cráter
  // un píxel cubre la misma distancia en horizontal y en vertical.
  function medirMancha(r) {
    const m = manchaMayor(r.clases, r.z.w, r.z.h);
    if (!m) return null;
    const f = r.z.W / REF_W, c = estado.calib;
    const ref = (v) => v / f;
    const topRef = ref(r.z.y + m.top), botRef = ref(r.z.y + m.bot + 1);
    const izqRef = ref(r.z.x + m.izq), derRef = ref(r.z.x + m.der + 1);
    const mPorPx = 100 / c.pxPor100m;
    return {
      px: m.n, topRef, botRef, izqRef, derRef,
      topeM: alturaDesdeY(topRef), baseM: alturaDesdeY(botRef),
      altoM: (botRef - topRef) * mPorPx, anchoM: (derRef - izqRef) * mPorPx,
      // La mancha toca el borde de la ROI: puede estar recortada.
      recortada: m.top === 0 || m.izq === 0 || m.bot === r.z.h - 1 || m.der === r.z.w - 1
    };
  }

  // Rectángulo de la ROI en píxeles del cuadro real.
  function roiEnCuadro() {
    const m = estado.media;
    if (!m || estado.tipoMedia === "iframe") return null;
    const W = estado.tipoMedia === "video" ? m.videoWidth : m.naturalWidth;
    const H = estado.tipoMedia === "video" ? m.videoHeight : m.naturalHeight;
    if (!W || !H) return null;
    const f = W / REF_W, r = estado.roi;
    const x = Math.max(0, Math.round(r.x * f)), y = Math.max(0, Math.round(r.y * f));
    const w = Math.min(W - x, Math.round(r.w * f)), h = Math.min(H - y, Math.round(r.h * f));
    return w > 0 && h > 0 ? { m, W, H, x, y, w, h } : null;
  }

  // Lienzos pequeños reutilizables: solo se copia la ROI y una versión
  // reducida del cuadro, en vez de leer el cuadro completo.
  const lienzoRoi = document.createElement("canvas");
  const lienzoMini = document.createElement("canvas");
  function leerRoi(z) {
    lienzoRoi.width = z.w; lienzoRoi.height = z.h;
    const ctx = lienzoRoi.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(z.m, z.x, z.y, z.w, z.h, 0, 0, z.w, z.h);
    return ctx.getImageData(0, 0, z.w, z.h);
  }

  function analizarRoi() {
    if (!estado.pixelesOk) return null;
    const z = roiEnCuadro();
    if (!z) return null;
    let img;
    try { img = leerRoi(z); } catch (e) { estado.pixelesOk = false; return null; }
    const d = img.data, n = d.length / 4;
    const clases = new Uint8Array(n);
    const ub = estado.ajustes.umbralBrillo;
    let rojizos = 0, brillantes = 0, lum = 0;
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      lum += 0.299 * R + 0.587 * G + 0.114 * B;
      const c = clasePixel(R, G, B, ub);
      clases[p] = c;
      if (c === 1) rojizos++; else if (c === 2) brillantes++;
    }
    const r = { z, img, clases, n, rojizos, brillantes, indice: 100 * (rojizos + brillantes) / n, lumRoi: lum / n };
    r.mancha = medirMancha(r);
    return r;
  }

  // Luminancia media del cuadro, sobre una copia reducida, para distinguir noche de día.
  function luminanciaCuadro(z) {
    try {
      const w = 160, h = Math.max(1, Math.round(160 * z.H / z.W));
      lienzoMini.width = w; lienzoMini.height = h;
      const ctx = lienzoMini.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(z.m, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return s / (d.length / 4);
    } catch (e) { return null; }
  }

  function calcularIndice() {
    const a = analizarRoi();
    if (!a) return null;
    return { indice: a.indice, lumRoi: a.lumRoi, lumCuadro: luminanciaCuadro(a.z), rojizos: a.rojizos, brillantes: a.brillantes, mancha: a.mancha };
  }

  function limpiarMancha() {
    if (estado.mancha) { estado.mancha = null; dibujarOverlay(); }
    $("roi-mancha").textContent = "";
    $("btn-usar-tope").disabled = true;
  }

  // ---------- Recuadro de la ROI: ampliación y máscara ----------
  const COLOR_ROJIZO = [255, 212, 0];     // amarillo: clase 1
  const COLOR_BRILLANTE = [0, 229, 255];  // cian: clase 2
  function actualizarInserto() {
    const caja = $("inserto");
    if (caja.hidden) return;
    const zoom = $("roi-zoom"), mascara = $("roi-mascara"), info = $("roi-info");
    const z = roiEnCuadro();
    if (!z) { info.textContent = estado.tipoMedia === "iframe" ? "No disponible en modo iframe" : "Sin imagen"; limpiarMancha(); return; }
    // Ampliación: se dibuja aunque no haya acceso a píxeles.
    for (const cv of [zoom, mascara]) { cv.width = z.w; cv.height = z.h; }
    const cz = zoom.getContext("2d");
    const a = estado.ajustes;
    cz.filter = (a.brillo !== 1 || a.contraste !== 1) ? "brightness(" + a.brillo + ") contrast(" + a.contraste + ")" : "none";
    cz.drawImage(z.m, z.x, z.y, z.w, z.h, 0, 0, z.w, z.h);
    const cm = mascara.getContext("2d");
    const r = analizarRoi();
    if (!r) {
      cm.fillStyle = "#111"; cm.fillRect(0, 0, z.w, z.h);
      info.textContent = "Máscara no disponible: sin acceso a píxeles (CORS)";
      limpiarMancha();
      return;
    }
    // Máscara: fondo en gris atenuado y píxeles detectados en color.
    const out = cm.createImageData(z.w, z.h), d = r.img.data, o = out.data;
    for (let i = 0, p = 0; p < r.n; i += 4, p++) {
      const c = r.clases[p];
      if (c === 1) { o[i] = COLOR_ROJIZO[0]; o[i + 1] = COLOR_ROJIZO[1]; o[i + 2] = COLOR_ROJIZO[2]; }
      else if (c === 2) { o[i] = COLOR_BRILLANTE[0]; o[i + 1] = COLOR_BRILLANTE[1]; o[i + 2] = COLOR_BRILLANTE[2]; }
      else { const g = 0.4 * (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); o[i] = o[i + 1] = o[i + 2] = g; }
      o[i + 3] = 255;
    }
    cm.putImageData(out, 0, 0);
    const alerta = r.indice >= estado.ajustes.umbral;
    caja.classList.toggle("alerta", alerta);
    info.innerHTML = "Índice <strong>" + r.indice.toFixed(2) + " %</strong> · rojizos " + r.rojizos + " · brillantes " + r.brillantes +
      " de " + r.n + " px" + (alerta ? " · <strong>INCANDESCENCIA</strong>" : "");
    const mm = r.mancha;
    estado.mancha = mm ? Object.assign({ t: Date.now() }, mm) : null;
    $("roi-mancha").innerHTML = mm
      ? "Mancha principal: tope <strong>" + fmtM(mm.topeM) + "</strong> sobre la cumbre · alto <strong>" + fmtM(mm.altoM) +
        "</strong> · ancho <strong>" + fmtM(mm.anchoM) + "</strong> · " + mm.px + " px" + (mm.recortada ? " · <em>toca el borde de la zona</em>" : "")
      : "Sin mancha detectada";
    $("btn-usar-tope").disabled = !mm;
    dibujarOverlay();
  }
  // Metros redondeados a 5 m: la resolución es de unos 2 m por píxel.
  function fmtM(v) { return (Math.round(v / 5) * 5 || 0) + " m"; }
  function fmtTam(v) { return v < 5 ? "< 5 m" : fmtM(v); }
  setInterval(actualizarInserto, 1000);

  function muestrear() {
    const m = calcularIndice();
    if (!m) { indiceEl.innerHTML = "Índice: <strong>no disponible</strong>"; return; }
    estado.ultimoIndice = m.indice;
    const t = new Date();
    estado.muestras.push({ t: t.toISOString(), indice: +m.indice.toFixed(2), lumRoi: +m.lumRoi.toFixed(1), lumCuadro: m.lumCuadro != null ? +m.lumCuadro.toFixed(1) : null,
      rojizos: m.rojizos, brillantes: m.brillantes, umbralBrillo: estado.ajustes.umbralBrillo,
      topeInc: m.mancha ? Math.round(m.mancha.topeM) : null, altoInc: m.mancha ? Math.round(m.mancha.altoM) : null,
      anchoInc: m.mancha ? Math.round(m.mancha.anchoM) : null });
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

  // Gráfico del índice en el tiempo (últimas 6 horas). Una sola serie,
  // línea de 2 px, umbral de alerta como línea punteada rotulada y lectura
  // del valor más cercano al pasar el mouse.
  const VENTANA_GRAF_MS = 6 * 3600 * 1000;
  let puntosGraf = [];
  function dibujarGrafico(hover) {
    const dpr = window.devicePixelRatio || 1;
    const Wc = grafico.clientWidth, Hc = grafico.clientHeight;
    if (!Wc || !Hc) return;
    if (grafico.width !== Math.round(Wc * dpr) || grafico.height !== Math.round(Hc * dpr)) {
      grafico.width = Math.round(Wc * dpr); grafico.height = Math.round(Hc * dpr);
    }
    const ctx = grafico.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wc, Hc);
    const izq = 30, der = 6, arr = 6, aba = 16;
    const pw = Wc - izq - der, ph = Hc - arr - aba;
    ctx.font = "11px system-ui, sans-serif";
    const ahora = Date.now();
    const ms = estado.muestras.filter(s => ahora - new Date(s.t).getTime() <= VENTANA_GRAF_MS);
    const umbral = estado.ajustes.umbral;
    if (!ms.length) {
      puntosGraf = [];
      ctx.fillStyle = "#9aa7b4"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(estado.ajustes.muestreo ? "Esperando la primera muestra..." : "Marque «registrar» para graficar el índice", Wc / 2, Hc / 2);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      return;
    }
    const max = Math.max(1, umbral * 1.5, ...ms.map(s => s.indice)) * 1.08;
    const t0 = new Date(ms[0].t).getTime(), t1 = Math.max(t0 + 60000, new Date(ms[ms.length - 1].t).getTime());
    const X = (t) => izq + pw * ((t - t0) / (t1 - t0));
    const Y = (v) => arr + ph * (1 - v / max);
    // Ejes y rejilla recesivos
    ctx.strokeStyle = "rgba(154, 167, 180, 0.25)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(izq, Y(0) + 0.5); ctx.lineTo(izq + pw, Y(0) + 0.5); ctx.stroke();
    ctx.fillStyle = "#9aa7b4"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText("0", izq - 4, Y(0)); ctx.fillText(max.toFixed(max < 10 ? 1 : 0), izq - 4, Y(max) + 4);
    // Umbral de alerta
    ctx.strokeStyle = "#e5533d"; ctx.setLineDash([4, 3]); ctx.beginPath();
    ctx.moveTo(izq, Y(umbral)); ctx.lineTo(izq + pw, Y(umbral)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#9aa7b4"; ctx.textAlign = "right"; ctx.fillText(String(umbral), izq - 4, Y(umbral));
    ctx.textAlign = "left"; ctx.fillText("umbral", izq + 4, Y(umbral) - 7);
    // Serie
    puntosGraf = ms.map(s => ({ x: X(new Date(s.t).getTime()), y: Y(s.indice), s }));
    ctx.strokeStyle = "#f4a261"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
    puntosGraf.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    if (puntosGraf.length === 1) { ctx.fillStyle = "#f4a261"; ctx.beginPath(); ctx.arc(puntosGraf[0].x, puntosGraf[0].y, 3, 0, 2 * Math.PI); ctx.fill(); }
    // Eje de tiempo: inicio y fin, hora local
    const fmt = (t) => fmtLocal.format(new Date(t)).slice(0, 5);
    ctx.fillStyle = "#9aa7b4"; ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left"; ctx.fillText(fmt(t0), izq, Hc - 3);
    ctx.textAlign = "right"; ctx.fillText(fmt(t1), izq + pw, Hc - 3);
    ctx.textAlign = "left";
    // Cruz y lectura del punto más cercano
    const lect = $("graf-lectura");
    if (hover != null && puntosGraf.length) {
      let p = puntosGraf[0];
      for (const q of puntosGraf) if (Math.abs(q.x - hover) < Math.abs(p.x - hover)) p = q;
      ctx.strokeStyle = "rgba(230, 237, 243, 0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(p.x) + 0.5, arr); ctx.lineTo(Math.round(p.x) + 0.5, arr + ph); ctx.stroke();
      ctx.fillStyle = "#f4a261"; ctx.strokeStyle = "#0f1419"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      const t = new Date(p.s.t);
      lect.textContent = fmtLocal.format(t) + " local · " + fmtUtc.format(t) + " UTC · índice " + p.s.indice.toFixed(2) + " %" +
        (p.s.brillantes != null ? " · " + p.s.brillantes + " brillantes, " + p.s.rojizos + " rojizos" : "") +
        (p.s.topeInc != null ? " · tope " + p.s.topeInc + " m, alto " + p.s.altoInc + " m, ancho " + p.s.anchoInc + " m" : "");
    } else {
      const u = ms[ms.length - 1];
      lect.textContent = "Última: " + fmtLocal.format(new Date(u.t)) + " · " + u.indice.toFixed(2) + " % · " + ms.length + " muestras en 6 h";
    }
  }
  grafico.addEventListener("mousemove", (ev) => dibujarGrafico(ev.clientX - grafico.getBoundingClientRect().left));
  grafico.addEventListener("mouseleave", () => dibujarGrafico());
  window.addEventListener("resize", () => dibujarGrafico());

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
    // Escala sutil: líneas finas y semitransparentes con un halo oscuro leve
    // para que se lea sobre nieve o cielo sin tapar la columna.
    const g = el("g", { "font-family": "system-ui, sans-serif", "font-size": 13, "fill": "rgba(255,255,255,0.78)",
      "stroke-linecap": "round", "paint-order": "stroke", "stroke": "rgba(0,0,0,0.45)", "stroke-width": 2.5 });
    const yTop = yDesdeAltura(c.alturaMax);
    const linea = (x1, y1, x2, y2, w) => {
      g.appendChild(el("line", { x1, y1, x2, y2, stroke: "rgba(0,0,0,0.3)", "stroke-width": w + 1.5 }));
      g.appendChild(el("line", { x1, y1, x2, y2, stroke: "rgba(255,255,255,0.7)", "stroke-width": w }));
    };
    linea(c.x, c.y0, c.x, yTop, 1.2);
    for (let h = 0; h <= c.alturaMax + 1e-6; h += 100) {
      const y = yDesdeAltura(h);
      linea(c.x - 7, y, c.x + 7, y, 1.2);
      g.appendChild(el("text", { x: c.x + 11, y: y + 4.5 }, String(h)));
    }
    for (let h = 50; h < c.alturaMax; h += 100) {
      const y = yDesdeAltura(h);
      linea(c.x - 3.5, y, c.x + 3.5, y, 1);
    }
    overlay.appendChild(g);

    // Marcador de medición
    if (estado.marcadorY != null) {
      const y = estado.marcadorY, h = alturaDesdeY(y);
      const gm = el("g", { stroke: "#f4a261", "stroke-width": 2 });
      gm.appendChild(el("line", { x1: 0, y1: y, x2: REF_W, y2: y, "stroke-dasharray": "8 6" }));
      gm.appendChild(el("circle", { cx: c.x, cy: y, r: 6, fill: "#f4a261", stroke: "#000" }));
      const et = el("text", { x: c.x - 18, y: y - 10, "text-anchor": "end", fill: "#f4a261", "font-size": 18, "font-weight": "700",
        stroke: "rgba(0,0,0,0.8)", "stroke-width": 4, "paint-order": "stroke", "font-family": "system-ui, sans-serif" }, fmtM(h));
      gm.appendChild(et);
      overlay.appendChild(gm);
    }

    // ROI y manijas en modo calibrar
    const r = estado.roi;
    if (estado.modoUi === "calibrar" || estado.ajustes.marco !== false) {
      // Solo el borde; en modo Calibrar el interior sigue siendo arrastrable.
      overlay.appendChild(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke: "#e5533d",
        "stroke-width": 1.5, "stroke-dasharray": "5 4", "pointer-events": estado.modoUi === "calibrar" ? "all" : "none",
        class: estado.modoUi === "calibrar" ? "arrastrable" : "", "data-manija": "roi" }));
    }
    const mm = estado.mancha;
    if (mm && estado.ajustes.marco !== false && !$("inserto").hidden) {
      const gm = el("g", { stroke: "rgb(0,229,255)", fill: "none", "stroke-width": 1.2, "pointer-events": "none" });
      gm.appendChild(el("rect", { x: mm.izqRef, y: mm.topRef, width: mm.derRef - mm.izqRef, height: mm.botRef - mm.topRef }));
      const xc = Math.max(mm.derRef, r.x + r.w) + 8;
      gm.appendChild(el("line", { x1: mm.derRef, y1: mm.topRef, x2: xc + 4, y2: mm.topRef, "stroke-dasharray": "3 2" }));
      gm.appendChild(el("line", { x1: xc, y1: mm.topRef, x2: xc, y2: mm.botRef }));
      gm.appendChild(el("line", { x1: xc - 3, y1: mm.botRef, x2: xc + 3, y2: mm.botRef }));
      gm.appendChild(el("text", { x: xc + 7, y: mm.topRef + 4, fill: "rgb(0,229,255)", stroke: "rgba(0,0,0,0.6)", "stroke-width": 2.5,
        "paint-order": "stroke", "font-size": 13, "font-family": "system-ui, sans-serif" }, "tope " + fmtM(mm.topeM)));
      overlay.appendChild(gm);
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
    $("btn-borrar-medida").hidden = estado.marcadorY == null;
    if (estado.marcadorY == null) { lectura.innerHTML = "Altura: <strong>--</strong>"; return; }
    const h = alturaDesdeY(estado.marcadorY);
    lectura.innerHTML = "Altura: <strong>" + fmtM(h) + "</strong> sobre la cumbre";
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
    if (arrastre.tipo.startsWith("roi") || arrastre.tipo === "base") actualizarInserto();
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
    trazo(px(cal.x), px(cal.y0), px(cal.x), px(yTop), 2.7 * f, "rgba(0,0,0,0.3)");
    trazo(px(cal.x), px(cal.y0), px(cal.x), px(yTop), 1.2 * f, "rgba(255,255,255,0.7)");
    for (let hh = 0; hh <= cal.alturaMax + 1e-6; hh += 100) {
      const y = px(yDesdeAltura(hh));
      trazo(px(cal.x) - 7 * f, y, px(cal.x) + 7 * f, y, 2.7 * f, "rgba(0,0,0,0.3)");
      trazo(px(cal.x) - 7 * f, y, px(cal.x) + 7 * f, y, 1.2 * f, "rgba(255,255,255,0.7)");
      texto(String(hh), px(cal.x) + 11 * f, y, "rgba(255,255,255,0.85)");
    }
    if (estado.marcadorY != null) {
      const y = px(estado.marcadorY);
      ctx.setLineDash([8 * f, 6 * f]); trazo(0, y, w, y, 2 * f, "#f4a261"); ctx.setLineDash([]);
      ctx.textAlign = "right"; texto(fmtM(alturaDesdeY(estado.marcadorY)), px(cal.x) - 18 * f, y - 12 * f, "#f4a261"); ctx.textAlign = "left";
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
        "</td><td class='num'>" + (r.indice != null ? r.indice.toFixed(2) : "") +
        "</td><td class='num'>" + (r.topeInc != null ? r.topeInc : "") + "</td><td class='num'>" + (r.altoInc != null ? r.altoInc : "") +
        "</td><td class='num'>" + (r.anchoInc != null ? r.anchoInc : "") + "</td><td>" + escapar(r.nota || "") +
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
      altura: estado.marcadorY != null && tipo !== "nubosidad" ? Math.round(alturaDesdeY(estado.marcadorY)) : null,
      indice: m ? +m.indice.toFixed(2) : null,
      topeInc: m && m.mancha ? Math.round(m.mancha.topeM) : null,
      altoInc: m && m.mancha ? Math.round(m.mancha.altoM) : null,
      anchoInc: m && m.mancha ? Math.round(m.mancha.anchoM) : null,
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
    descargarCsv("registro_tata.csv", [["fecha_hora_local", "iso_utc", "tipo", "altura_m", "indice_pct", "tope_incand_m", "alto_incand_m", "ancho_incand_m", "nota"]]
      .concat(estado.registro.map(r => [horaLocal(new Date(r.t)), r.t, r.tipo, r.altura, r.indice, r.topeInc, r.altoInc, r.anchoInc, r.nota])));
  });
  $("btn-borrar-registro").addEventListener("click", () => {
    if (confirm("¿Borrar todo el registro de observaciones de este navegador?")) { estado.registro = []; guardar(LS.registro, []); renderRegistro(); }
  });
  $("btn-exp-muestras").addEventListener("click", () => {
    descargarCsv("muestras_incandescencia.csv", [["fecha_hora_local", "iso_utc", "indice_pct", "lum_roi", "lum_cuadro", "px_rojizos", "px_brillantes", "umbral_brillo", "tope_incand_m", "alto_incand_m", "ancho_incand_m"]]
      .concat(estado.muestras.map(s => [horaLocal(new Date(s.t)), s.t, s.indice, s.lumRoi, s.lumCuadro, s.rojizos, s.brillantes, s.umbralBrillo, s.topeInc, s.altoInc, s.anchoInc])));
  });
  $("btn-borrar-muestras").addEventListener("click", () => {
    if (confirm("¿Borrar las muestras del índice de incandescencia?")) { estado.muestras = []; guardar(LS.muestras, []); dibujarGrafico(); }
  });

  // ---------- Formularios ----------
  function llenarFuente() {
    const a = estado.ajustes;
    $("in-alias").value = a.alias; $("in-modo").value = a.modo; $("in-hls").value = a.hlsUrl; $("in-snap").value = a.snapshotUrl;
    $("in-int-snap").value = a.intervaloSnapshot; $("n-int").value = a.intervaloMuestreo; $("n-umbral").value = a.umbral;
    $("n-muestreo").checked = $("n-muestreo-ins").checked = !!a.muestreo; $("n-brillo-umbral").value = a.umbralBrillo; $("n-brillo").value = a.brillo; $("n-contraste").value = a.contraste;
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
    a.umbralBrillo = Math.min(255, Math.max(1, +$("n-brillo-umbral").value || 200));
    guardar(LS.ajustes, a); aplicarFiltro(); dibujarOverlay();
  };
  ["n-brillo", "n-contraste", "n-int", "n-umbral", "n-brillo-umbral"].forEach(id => $(id).addEventListener("input", () => { guardarNoche(); actualizarInserto(); dibujarGrafico(); }));
  $("n-muestreo").addEventListener("change", () => { $("n-muestreo-ins").checked = $("n-muestreo").checked; guardarNoche(); reprogramarMuestreo(); dibujarGrafico(); });
  $("n-muestreo-ins").addEventListener("change", () => { $("n-muestreo").checked = $("n-muestreo-ins").checked; guardarNoche(); reprogramarMuestreo(); dibujarGrafico(); });
  ["n-int"].forEach(id => $(id).addEventListener("change", reprogramarMuestreo));
  $("btn-noche").addEventListener("click", () => { $("n-brillo").value = 2.2; $("n-contraste").value = 1.4; guardarNoche(); });
  $("btn-dia").addEventListener("click", () => { $("n-brillo").value = 1; $("n-contraste").value = 1; guardarNoche(); });

  function mostrarInserto(ver) {
    $("inserto").hidden = !ver;
    $("btn-inserto").classList.toggle("activo", ver);
    estado.ajustes.inserto = ver; guardar(LS.ajustes, estado.ajustes);
    if (ver) { actualizarInserto(); dibujarGrafico(); }
  }
  $("btn-inserto").addEventListener("click", () => mostrarInserto($("inserto").hidden));
  // Lleva el marcador de medición al tope sugerido; luego se puede ajustar
  // en modo Medir antes de registrar.
  $("btn-usar-tope").addEventListener("click", () => {
    if (!estado.mancha) return;
    estado.marcadorY = estado.mancha.topRef;
    $("r-tipo").value = "incandescencia";
    dibujarOverlay();
  });

  // Marco de la zona de detección sobre la imagen. En modo Calibrar se
  // muestra siempre, porque es lo que se arrastra.
  function mostrarMarco(ver) {
    estado.ajustes.marco = ver; guardar(LS.ajustes, estado.ajustes);
    $("btn-marco").classList.toggle("activo", ver);
    dibujarOverlay();
  }
  $("btn-marco").addEventListener("click", () => mostrarMarco(estado.ajustes.marco === false));
  $("btn-cerrar-inserto").addEventListener("click", () => mostrarInserto(false));

  function borrarMedida() {
    if (estado.marcadorY == null) return false;
    estado.marcadorY = null;
    dibujarOverlay();
    return true;
  }
  $("btn-borrar-medida").addEventListener("click", borrarMedida);

  // ---------- Barra superior, panel lateral y pantalla completa ----------
  document.querySelectorAll("[data-fuente]").forEach(b => b.addEventListener("click", () => {
    estado.ajustes.modo = b.dataset.fuente;
    $("in-modo").value = b.dataset.fuente;
    guardar(LS.ajustes, estado.ajustes);
    conectar();
  }));

  const lateral = $("lateral"), app = $("app");
  function abrirMenu(abrir) {
    lateral.classList.toggle("abierto", abrir);
    $("btn-menu").setAttribute("aria-expanded", String(abrir));
    if (abrir) dibujarGrafico();
  }
  $("btn-menu").addEventListener("click", () => abrirMenu(!lateral.classList.contains("abierto")));
  $("btn-cerrar-menu").addEventListener("click", () => abrirMenu(false));

  function pantallaCompleta() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  $("btn-pantalla").addEventListener("click", pantallaCompleta);

  // En pantalla completa, la barra se oculta tras unos segundos sin mover
  // el mouse, salvo que se esté midiendo, calibrando o con el menú abierto.
  let timerOculta = null;
  function mostrarBarra() {
    app.classList.remove("oculta");
    clearTimeout(timerOculta);
    timerOculta = setTimeout(() => {
      if (document.fullscreenElement && estado.modoUi === "ver" && !lateral.classList.contains("abierto")) app.classList.add("oculta");
    }, 4000);
  }
  ["mousemove", "pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, mostrarBarra, { passive: true }));
  document.addEventListener("fullscreenchange", mostrarBarra);

  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, select, textarea") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k === "escape") { if (lateral.classList.contains("abierto")) abrirMenu(false); else borrarMedida(); }
    else if (k === "delete" || k === "backspace") borrarMedida();
    else if (k === "v") fijarModoUi("ver");
    else if (k === "m") fijarModoUi("medir");
    else if (k === "c") fijarModoUi("calibrar");
    else if (k === "f") pantallaCompleta();
    else if (k === "z") mostrarInserto($("inserto").hidden);
    else if (k === "r") mostrarMarco(estado.ajustes.marco === false);
  });

  // ---------- Inicio ----------
  $("version").textContent = VERSION;
  mostrarInserto(estado.ajustes.inserto !== false);
  mostrarMarco(estado.ajustes.marco !== false);
  console.info("Seguimiento Cámara Tata, versión " + VERSION);
  llenarFuente(); llenarCalib(); renderRegistro(); dibujarGrafico(); dibujarOverlay();
  conectar().then(reprogramarMuestreo);
})();
