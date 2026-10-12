/* Seguimiento Cámara Tata: visor con escala calibrada, medición de altura
   de columna, índice de incandescencia nocturna y registro local. */
(function () {
  "use strict";

  const VERSION = "2026-10-12 f";
  const CFG = window.CAM_CONFIG || {};
  const LS = {
    ajustes: "tata.ajustes",
    calib: "tata.calib.v2",
    roi: "tata.roi.v2",
    zonaCol: "tata.zonacol.v1",
    silueta: "tata.silueta.v1",
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
      detector: "auto",
      umbralCeniza: CFG.umbralCeniza != null ? CFG.umbralCeniza : 1,
      umbralCalidez: CFG.umbralCalidez != null ? CFG.umbralCalidez : 12,
      umbralOscuro: CFG.umbralOscuro != null ? CFG.umbralOscuro : 25,
      muestreo: false,
      brillo: 1,
      contraste: 1
    }, leer(LS.ajustes, {})),
    calib: Object.assign({}, CFG.calibracion || { x: 868.5, y0: 565.6, pxPor100m: 54.1, alturaMax: 500 }, leer(LS.calib, {})),
    roi: Object.assign({}, CFG.roi || { x: 808, y: 525, w: 120, h: 68 }, leer(LS.roi, {})),
    zonaCol: Object.assign({}, CFG.zonaColumna || { x: 568, y: 241, w: 600, h: 335 }, leer(LS.zonaCol, {})),
    modoDet: "incand",        // detector en uso: "incand" (noche) o "ceniza" (día)
    silueta: leer("tata.silueta.v1", null) || CFG.silueta || null,   // [[x, y] | null, ...] en px ref
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

  // Cada foto nueva se carga en un elemento aparte y reemplaza a la
  // anterior solo cuando llegó completa. Si se reutilizara el mismo
  // elemento, mientras llega la foto nueva quedaría sin tamaño y el
  // análisis de ese instante no tendría imagen.
  function conectarSnapshot() {
    const conexion = estado.conexion;
    let conCors = true;
    estado.tipoMedia = "img";
    const cargar = () => {
      const img = document.createElement("img");
      img.alt = "Cámara Plaza Tata";
      if (conCors) img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("load", () => {
        if (conexion !== estado.conexion) return;
        const previo = estado.media;
        if (previo && previo.parentNode === medios) medios.replaceChild(img, previo); else medios.appendChild(img);
        estado.media = img; estado.tipoMedia = "img";
        fijarAspecto(img.naturalWidth, img.naturalHeight);
        estado.ultimoCuadro = new Date();
        if (estado.pixelesOk === null) probarPixeles();
        actualizarInserto();
        setEstado((estado.mensajeRespaldo ? estado.mensajeRespaldo + " · " : "") + "Snapshot " + img.naturalWidth + "×" + img.naturalHeight + " · último cuadro " + horaLocal(estado.ultimoCuadro) +
          (estado.pixelesOk ? " · análisis de píxeles disponible" : " · sin acceso a píxeles (CORS)"));
      });
      img.addEventListener("error", () => {
        if (conexion !== estado.conexion) return;
        if (conCors) { conCors = false; estado.pixelesOk = false; cargar(); }
        else setEstado("No se pudo cargar el snapshot. Verifique el alias o la URL.");
      });
      img.src = urlSnapshot() + (urlSnapshot().includes("?") ? "&" : "?") + "_=" + Date.now();
    };
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

  // ---------- Manchas conectadas ----------
  // Mancha conectada más grande (vecindad de 8) entre los píxeles
  // detectados. Se ignoran manchas de menos de MIN_PX_MANCHA píxeles,
  // que suelen ser ruido. Si se indica una caja, solo cuentan las manchas
  // que la tocan: una columna de ceniza debe nacer en el cráter.
  const MIN_PX_MANCHA = 6;
  function manchaMayor(clases, w, h, caja) {
    const visto = new Uint8Array(clases.length), cola = new Int32Array(clases.length);
    let mejor = null;
    for (let p0 = 0; p0 < clases.length; p0++) {
      if (!clases[p0] || visto[p0]) continue;
      let ini = 0, fin = 0, n = 0, top = h, bot = -1, izq = w, der = -1, toca = !caja;
      cola[fin++] = p0; visto[p0] = 1;
      while (ini < fin) {
        const p = cola[ini++], x = p % w, y = (p - x) / w;
        n++;
        if (y < top) top = y; if (y > bot) bot = y; if (x < izq) izq = x; if (x > der) der = x;
        if (!toca && x >= caja.x0 && x <= caja.x1 && y >= caja.y0 && y <= caja.y1) toca = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (clases[q] && !visto[q]) { visto[q] = 1; cola[fin++] = q; }
        }
      }
      if (toca && (!mejor || n > mejor.n)) mejor = { n, top, bot, izq, der };
    }
    return mejor && mejor.n >= MIN_PX_MANCHA ? mejor : null;
  }

  // Convierte una mancha de la máscara a coordenadas de referencia y a
  // metros con la calibración: tope sobre la cumbre, alto y ancho. En el
  // plano del cráter un píxel cubre la misma distancia en horizontal y en
  // vertical. `mapa` lleva un píxel de la máscara al cuadro real.
  function medirEnMetros(m, mapa, wm, hm) {
    const { ox, oy, sx, sy, f } = mapa;
    const topRef = (oy + m.top * sy) / f, botRef = (oy + (m.bot + 1) * sy) / f;
    const izqRef = (ox + m.izq * sx) / f, derRef = (ox + (m.der + 1) * sx) / f;
    const mPorPx = 100 / estado.calib.pxPor100m;
    return {
      px: m.n, topRef, botRef, izqRef, derRef,
      topeM: alturaDesdeY(topRef), baseM: alturaDesdeY(botRef),
      altoM: (botRef - topRef) * mPorPx, anchoM: (derRef - izqRef) * mPorPx,
      // La mancha toca el borde de la zona analizada: puede estar recortada.
      recortada: m.top === 0 || m.izq === 0 || m.bot === hm - 1 || m.der === wm - 1
    };
  }

  // Rectángulo (en píxeles de referencia) llevado al cuadro real.
  function rectEnCuadro(r) {
    const m = estado.media;
    if (!m || estado.tipoMedia === "iframe") return null;
    const W = estado.tipoMedia === "video" ? m.videoWidth : m.naturalWidth;
    const H = estado.tipoMedia === "video" ? m.videoHeight : m.naturalHeight;
    if (!W || !H) return null;
    const f = W / REF_W;
    const x = Math.max(0, Math.round(r.x * f)), y = Math.max(0, Math.round(r.y * f));
    const w = Math.min(W - x, Math.round(r.w * f)), h = Math.min(H - y, Math.round(r.h * f));
    return w > 0 && h > 0 ? { m, W, H, x, y, w, h, f } : null;
  }
  function roiEnCuadro() { return rectEnCuadro(estado.roi); }

  // Lienzos pequeños reutilizables: se copia solo la zona analizada o una
  // versión reducida del cuadro, en vez de leer el cuadro completo.
  const lienzoRoi = document.createElement("canvas");
  const lienzoMini = document.createElement("canvas");
  const lienzoCen = document.createElement("canvas");
  function leerRect(lienzo, z, w, h) {
    lienzo.width = w; lienzo.height = h;
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(z.m, z.x, z.y, z.w, z.h, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  // Luminancia media y colorido del cuadro, sobre una copia reducida. El
  // colorido es casi cero cuando la cámara pasa a blanco y negro de noche.
  function caracterizarCuadro() {
    if (!estado.pixelesOk) return null;
    const z = rectEnCuadro({ x: 0, y: 0, w: REF_W, h: refH() });
    if (!z) return null;
    try {
      const w = 160, h = Math.max(1, Math.round(160 * z.H / z.W));
      lienzoMini.width = w; lienzoMini.height = h;
      const ctx = lienzoMini.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(z.m, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let s = 0, c = 0, sc = 0;
      const finCielo = Math.floor(0.4 * h) * w * 4;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        s += L; if (i < finCielo) sc += L;
        c += (Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]) + Math.abs(d[i + 2] - d[i])) / 3;
      }
      const n = d.length / 4;
      return { lum: s / n, color: c / n, lumCielo: sc / (finCielo / 4) };
    } catch (e) { return null; }
  }
  // Día o noche según la luminosidad del cielo (40 % superior del cuadro),
  // no según el color: la cámara tarda en pasar de blanco y negro a color
  // al amanecer, y al revés al atardecer. Con margen entre los umbrales de
  // entrada y salida, para que no alterne en el crepúsculo. En las
  // imágenes disponibles el cielo da entre 109 y 141 de día, también en
  // blanco y negro, y cerca de 40 de noche.
  const LUM_CIELO_DIA = 70, MARGEN_DIA = 8, COLOR_MIN = 4;
  function actualizarDiaNoche(car) {
    if (!car) return;
    const umbral = estado.esDia ? LUM_CIELO_DIA - MARGEN_DIA : LUM_CIELO_DIA + MARGEN_DIA;
    estado.esDia = car.lumCielo >= umbral;
    // Imagen en blanco y negro: sin color no hay calidez que medir. Al
    // cambiar la cámara entre blanco y negro y color, el tono de cada
    // píxel salta de golpe; el fondo de ceniza se forma de nuevo.
    const bn = car.color < COLOR_MIN;
    if (estado.bn != null && bn !== estado.bn) reiniciarFondo();
    estado.bn = bn;
  }

  // ---------- Incandescencia (noche) ----------
  // Clasificación de un píxel de la ROI del cráter:
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
  function analizarRoi() {
    if (!estado.pixelesOk) return null;
    const z = roiEnCuadro();
    if (!z) return null;
    let img;
    try { img = leerRect(lienzoRoi, z, z.w, z.h); } catch (e) { estado.pixelesOk = false; return null; }
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
    const m = manchaMayor(clases, z.w, z.h);
    return { z, img, clases, n, wm: z.w, hm: z.h, rojizos, brillantes, indice: 100 * (rojizos + brillantes) / n, lumRoi: lum / n,
      mancha: m ? medirEnMetros(m, { ox: z.x, oy: z.y, sx: 1, sy: 1, f: z.f }, z.w, z.h) : null };
  }

  // ---------- Ceniza (día) ----------
  // Se analiza la zona de columna sobre el cráter, reducida a ANCHO_CENIZA
  // píxeles de ancho. Cada píxel se compara con un fondo propio: un
  // promedio lento (constante de tiempo TAU_FONDO_S) de cómo se ha visto
  // ese mismo píxel. Así el terreno, la nieve y el cielo quieto se
  // cancelan, y solo quedan los cambios. A cada diferencia se le resta la
  // mediana de la zona, para que un cambio general de luz o de balance de
  // color no active la detección. Clases:
  //   1 más cálido : aumentó R − B respecto del fondo (tono gris café).
  //   2 más oscuro : bajó la luminancia respecto del fondo.
  // Los píxeles detectados actualizan su fondo diez veces más lento, para
  // que una emisión sostenida no se absorba de inmediato.
  const ANCHO_CENIZA = 300, TAU_FONDO_S = 600;
  let fondo = null;
  function reiniciarFondo() { fondo = null; }
  function mediana(arr) {
    const paso = Math.max(1, Math.floor(arr.length / 4000)), m = [];
    for (let i = 0; i < arr.length; i += paso) m.push(arr[i]);
    m.sort((a, b) => a - b);
    return m[m.length >> 1];
  }
  function analizarCeniza() {
    if (!estado.pixelesOk) return null;
    const z = rectEnCuadro(estado.zonaCol);
    if (!z) return null;
    const wm = Math.min(ANCHO_CENIZA, z.w), hm = Math.max(1, Math.round(z.h * wm / z.w));
    let img;
    try { img = leerRect(lienzoCen, z, wm, hm); } catch (e) { estado.pixelesOk = false; return null; }
    const d = img.data, n = wm * hm;
    const rb = new Float32Array(n), l = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) { rb[p] = d[i] - d[i + 2]; l[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
    const ahora = Date.now(), clave = [z.x, z.y, z.w, z.h, wm, hm].join(",");
    const clases = new Uint8Array(n);
    const base = { z, img, clases, n, wm, hm, calidos: 0, oscuros: 0, indice: 0, mancha: null };
    if (!fondo || fondo.clave !== clave) {
      fondo = { clave, rb: rb.slice(), l: l.slice(), t: ahora, t0: ahora };
      return Object.assign(base, { edadFondo: 0 });
    }
    const drb = new Float32Array(n), dl = new Float32Array(n);
    for (let p = 0; p < n; p++) { drb[p] = rb[p] - fondo.rb[p]; dl[p] = l[p] - fondo.l[p]; }
    const mRB = mediana(drb), mL = mediana(dl);
    const uc = estado.ajustes.umbralCalidez, uo = estado.ajustes.umbralOscuro;
    let calidos = 0, oscuros = 0;
    for (let p = 0; p < n; p++) {
      const L = l[p];
      if (L >= 35 && L <= 235 && drb[p] - mRB >= uc) { clases[p] = 1; calidos++; }
      else if (L >= 15 && dl[p] - mL <= -uo) { clases[p] = 2; oscuros++; }
    }
    const dt = Math.min(60, (ahora - fondo.t) / 1000); fondo.t = ahora;
    const a = 1 - Math.exp(-dt / TAU_FONDO_S), a2 = a / 10;
    for (let p = 0; p < n; p++) {
      const k = clases[p] ? a2 : a;
      fondo.rb[p] += k * (rb[p] - fondo.rb[p]); fondo.l[p] += k * (l[p] - fondo.l[p]);
    }
    // Caja del cráter (la ROI de incandescencia) en píxeles de la máscara.
    const sx = z.w / wm, sy = z.h / hm, r = estado.roi;
    const caja = { x0: (r.x * z.f - z.x) / sx, x1: ((r.x + r.w) * z.f - z.x) / sx, y0: (r.y * z.f - z.y) / sy, y1: ((r.y + r.h) * z.f - z.y) / sy };
    const m = manchaMayor(clases, wm, hm, caja);
    return Object.assign(base, { calidos, oscuros, indice: 100 * (calidos + oscuros) / n, edadFondo: (ahora - fondo.t0) / 1000,
      mancha: m ? medirEnMetros(m, { ox: z.x, oy: z.y, sx, sy, f: z.f }, wm, hm) : null });
  }

  // ---------- Silueta del volcán ----------
  // Se traza desde la imagen actual, idealmente con cielo despejado y sin
  // emisión. Por cada columna se baja desde el cielo y se marca el primer
  // punto que se aparta de forma sostenida del color del cielo que viene
  // justo encima (promedio móvil de luminancia y de R − B). Luego se filtra
  // con una mediana a lo largo de la línea y se descartan saltos.
  function trazarSilueta() {
    if (!estado.pixelesOk) return { error: "sin acceso a píxeles (CORS)" };
    const z = rectEnCuadro({ x: 0, y: 0, w: REF_W, h: refH() });
    if (!z) return { error: "sin imagen" };
    const w = 960, h = Math.round(960 * z.H / z.W);
    let d;
    try { d = leerRect(lienzoMini, z, w, h).data; } catch (e) { return { error: "sin acceso a píxeles (CORS)" }; }
    const L = (x, y) => { const i = (y * w + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    const RB = (x, y) => { const i = (y * w + x) * 4; return d[i] - d[i + 2]; };
    const PASO = 2, yMax = Math.round(0.85 * h), crudo = [];
    for (let x = 0; x < w; x += PASO) {
      // Saltar la carcasa oscura de la cámara (arco negro en la esquina) y
      // su borde difuso. Un borde hallado justo bajo la carcasa no cuenta.
      let y = 0;
      while (y < yMax && L(x, y) < 25) y++;
      const conCarcasa = y > 0;
      y += conCarcasa ? 20 : 3;
      const yInicio = y;
      if (y + 12 >= yMax) { crudo.push(null); continue; }
      let mL = 0, mRB = 0, v = 0;
      for (let k = 0; k < 8; k++) { mL += L(x, y + k); mRB += RB(x, y + k); }
      mL /= 8; mRB /= 8; y += 8;
      let fuera = 0, borde = null;
      for (; y < yMax; y++) {
        const l = L(x, y), rb = RB(x, y);
        const dist = Math.hypot(l - mL, 1.5 * (rb - mRB));
        if (dist > Math.max(14, 3 * Math.sqrt(v))) {
          if (++fuera >= 4) { borde = y - 3; break; }
        } else {
          fuera = 0;
          mL += 0.1 * (l - mL); mRB += 0.1 * (rb - mRB);
          v += 0.1 * (dist * dist - v);
        }
      }
      // Un borde en el 10 % superior del cuadro o pegado a la carcasa no es
      // la silueta, sino el halo de la carcasa o ruido.
      const dudoso = borde != null && ((conCarcasa && borde - yInicio < 30) || borde < 0.1 * h);
      crudo.push(dudoso ? null : borde);
    }
    const n = crudo.length, puntos = [];
    for (let i = 0; i < n; i++) {
      const vec = crudo.slice(Math.max(0, i - 3), i + 4).filter(q => q != null).sort((a, b) => a - b);
      const med = vec.length ? vec[vec.length >> 1] : null;
      const ok = crudo[i] != null && med != null && Math.abs(crudo[i] - med) <= 6;
      const f = REF_W / w;
      puntos.push(ok ? [Math.round(i * PASO * f), Math.round(med * f)] : null);
    }
    const validos = puntos.filter(Boolean).length;
    return { puntos, validos, total: n };
  }
  function dibujarSilueta() {
    const sil = estado.silueta;
    if (!sil || estado.ajustes.silueta === false) return;
    let tramo = [];
    const g = el("g", { fill: "none", stroke: "rgba(255,240,150,0.75)", "stroke-width": 1.4, "stroke-linejoin": "round", "pointer-events": "none" });
    const cerrar = () => { if (tramo.length > 1) g.appendChild(el("polyline", { points: tramo.map(p => p.join(",")).join(" ") })); tramo = []; };
    // Se corta la línea en los huecos y en los saltos verticales grandes.
    for (const p of sil) {
      if (!p) { cerrar(); continue; }
      const u = tramo[tramo.length - 1];
      if (u && Math.abs(p[1] - u[1]) > 40) cerrar();
      tramo.push(p);
    }
    cerrar();
    overlay.appendChild(g);
  }

  // ---------- Análisis periódico ----------
  // Cada segundo: se caracteriza el cuadro, se elige el detector y se
  // analizan la ROI del cráter y, si la imagen está en color, la zona de
  // columna (para mantener su fondo al día aunque no se muestre).
  function detectorActivo() {
    const d = estado.ajustes.detector;
    if (d === "ceniza" || d === "incand") return d;
    return estado.esDia ? "ceniza" : "incand";
  }
  function analizar() {
    estado.car = caracterizarCuadro();
    actualizarDiaNoche(estado.car);
    estado.modoDet = detectorActivo();
    estado.anInc = analizarRoi();
    estado.anCen = (estado.modoDet === "ceniza" || estado.esDia) ? analizarCeniza() : null;
    if (estado.anCen === null && estado.car && !estado.esDia) reiniciarFondo();
  }
  function actualizarInserto() {
    analizar();
    renderInserto();
  }

  function limpiarMancha() {
    if (estado.mancha) { estado.mancha = null; dibujarOverlay(); }
    $("roi-mancha").textContent = "";
    $("btn-usar-tope").disabled = true;
  }

  // ---------- Recuadro: ampliación, máscara y medidas ----------
  const COLORES = {
    incand: { 1: [255, 212, 0], 2: [0, 229, 255] },     // amarillo rojizo, cian brillante
    ceniza: { 1: [214, 140, 60], 2: [179, 136, 255] }   // café más cálido, lila más oscuro
  };
  const COLOR_GUIA = { incand: "rgb(0,229,255)", ceniza: "rgb(232,170,90)" };
  function renderInserto() {
    const modo = estado.modoDet || "incand";
    document.querySelectorAll("[data-det]").forEach(b => b.classList.toggle("activo", b.dataset.det === (estado.ajustes.detector || "auto")));
    $("inserto-titulo").textContent = modo === "ceniza" ? "Detección de ceniza" : "Detección de incandescencia";
    $("ley-1").textContent = modo === "ceniza" ? "más cálido" : "rojizo";
    $("ley-2").textContent = modo === "ceniza" ? "más oscuro" : "brillante";
    $("ley-1-m").style.background = "rgb(" + COLORES[modo][1].join(",") + ")";
    $("ley-2-m").style.background = "rgb(" + COLORES[modo][2].join(",") + ")";
    $("graf-titulo").textContent = (modo === "ceniza" ? "Índice de ceniza" : "Índice de incandescencia") + " en el tiempo (%)";
    if (estado.modoGraf !== modo) { estado.modoGraf = modo; dibujarGrafico(); }
    const caja = $("inserto");
    const zoom = $("roi-zoom"), mascara = $("roi-mascara"), info = $("roi-info");
    const zr = modo === "ceniza" ? rectEnCuadro(estado.zonaCol) : roiEnCuadro();
    if (!zr) { info.textContent = estado.tipoMedia === "iframe" ? "No disponible en modo iframe" : "Sin imagen"; limpiarMancha(); return; }
    const r = modo === "ceniza" ? estado.anCen : estado.anInc;
    const wm = r ? r.wm : (modo === "ceniza" ? Math.min(ANCHO_CENIZA, zr.w) : zr.w);
    const hm = r ? r.hm : Math.max(1, Math.round(zr.h * wm / zr.w));
    if (caja.hidden) { fijarMancha(r, modo); return; }
    // Ampliación: se dibuja aunque no haya acceso a píxeles.
    for (const cv of [zoom, mascara]) { cv.width = wm; cv.height = hm; }
    const cz = zoom.getContext("2d");
    const a = estado.ajustes;
    cz.filter = (a.brillo !== 1 || a.contraste !== 1) ? "brightness(" + a.brillo + ") contrast(" + a.contraste + ")" : "none";
    cz.drawImage(zr.m, zr.x, zr.y, zr.w, zr.h, 0, 0, wm, hm);
    const cm = mascara.getContext("2d");
    if (!r) {
      cm.fillStyle = "#111"; cm.fillRect(0, 0, wm, hm);
      info.textContent = "Máscara no disponible: sin acceso a píxeles (CORS)";
      limpiarMancha();
      return;
    }
    // Máscara: fondo en gris atenuado y píxeles detectados en color.
    const out = cm.createImageData(wm, hm), d = r.img.data, o = out.data, col = COLORES[modo];
    for (let i = 0, p = 0; p < r.n; i += 4, p++) {
      const c = r.clases[p];
      if (c) { o[i] = col[c][0]; o[i + 1] = col[c][1]; o[i + 2] = col[c][2]; }
      else { const g = 0.4 * (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); o[i] = o[i + 1] = o[i + 2] = g; }
      o[i + 3] = 255;
    }
    cm.putImageData(out, 0, 0);
    const umbral = modo === "ceniza" ? a.umbralCeniza : a.umbral;
    const alerta = r.indice >= umbral;
    caja.classList.toggle("alerta", alerta);
    if (modo === "ceniza") {
      const aprendiendo = r.edadFondo < 60;
      info.innerHTML = "Índice <strong>" + r.indice.toFixed(2) + " %</strong> · más cálidos " + r.calidos + " · más oscuros " + r.oscuros +
        " de " + r.n + " px · fondo de " + Math.round(r.edadFondo / 60) + " min" +
        (estado.bn ? " · <em>cámara en blanco y negro: solo cuenta el oscurecimiento</em>" : "") +
        (aprendiendo ? " · <em>formando el fondo</em>" : "") + (alerta ? " · <strong>POSIBLE EMISIÓN</strong>" : "");
    } else {
      info.innerHTML = "Índice <strong>" + r.indice.toFixed(2) + " %</strong> · rojizos " + r.rojizos + " · brillantes " + r.brillantes +
        " de " + r.n + " px" + (alerta ? " · <strong>INCANDESCENCIA</strong>" : "");
    }
    fijarMancha(r, modo);
  }
  function fijarMancha(r, modo) {
    const mm = r && r.mancha;
    estado.mancha = mm ? Object.assign({ t: Date.now(), modo }, mm) : null;
    const nombre = modo === "ceniza" ? "Columna" : "Mancha principal";
    $("roi-mancha").innerHTML = mm
      ? nombre + ": tope <strong>" + fmtM(mm.topeM) + "</strong> sobre la cumbre · alto <strong>" + fmtTam(mm.altoM) +
        "</strong> · ancho <strong>" + fmtTam(mm.anchoM) + "</strong> · " + mm.px + " px" + (mm.recortada ? " · <em>toca el borde de la zona</em>" : "")
      : (r ? (modo === "ceniza" ? "Sin columna conectada al cráter" : "Sin mancha detectada") : "");
    $("btn-usar-tope").disabled = !mm;
    dibujarOverlay();
  }
  // Metros redondeados a 5 m: la resolución es de unos 2 m por píxel.
  function fmtM(v) { return (Math.round(v / 5) * 5 || 0) + " m"; }
  function fmtTam(v) { return v < 5 ? "< 5 m" : fmtM(v); }
  setInterval(actualizarInserto, 1000);

  function calcularIndice() {
    analizar();
    const ai = estado.anInc;
    if (!ai) return null;
    return { indice: ai.indice, lumRoi: ai.lumRoi, lumCuadro: estado.car ? estado.car.lum : null, rojizos: ai.rojizos, brillantes: ai.brillantes,
      mancha: ai.mancha, ceniza: estado.anCen, modo: estado.modoDet };
  }

  function muestrear() {
    const m = calcularIndice();
    if (!m) { indiceEl.innerHTML = "Índice: <strong>no disponible</strong>"; return; }
    estado.ultimoIndice = m.indice;
    const t = new Date(), c = m.ceniza, mc = c && c.mancha;
    estado.muestras.push({ t: t.toISOString(), modo: m.modo, lumCielo: estado.car ? +estado.car.lumCielo.toFixed(1) : null, bn: estado.bn ? 1 : 0, indice: +m.indice.toFixed(2), lumRoi: +m.lumRoi.toFixed(1), lumCuadro: m.lumCuadro != null ? +m.lumCuadro.toFixed(1) : null,
      rojizos: m.rojizos, brillantes: m.brillantes, umbralBrillo: estado.ajustes.umbralBrillo,
      topeInc: m.mancha ? Math.round(m.mancha.topeM) : null, altoInc: m.mancha ? Math.round(m.mancha.altoM) : null,
      anchoInc: m.mancha ? Math.round(m.mancha.anchoM) : null,
      indCen: c ? +c.indice.toFixed(2) : null, calidos: c ? c.calidos : null, oscuros: c ? c.oscuros : null,
      topeCol: mc ? Math.round(mc.topeM) : null, altoCol: mc ? Math.round(mc.altoM) : null, anchoCol: mc ? Math.round(mc.anchoM) : null });
    if (estado.muestras.length > 5000) estado.muestras.splice(0, estado.muestras.length - 5000);
    guardar(LS.muestras, estado.muestras);
    const alerta = m.indice >= estado.ajustes.umbral;
    indiceEl.classList.toggle("alerta", alerta);
    indiceEl.innerHTML = "Incandescencia: <strong>" + m.indice.toFixed(2) + " %</strong>" +
      (c ? " · ceniza: <strong>" + c.indice.toFixed(2) + " %</strong>" : "") +
      (estado.car ? " · luminosidad del cielo " + estado.car.lumCielo.toFixed(0) + (estado.bn ? ", cámara en blanco y negro" : ", cámara en color") : "") +
      " · detector " + (m.modo === "ceniza" ? "de día" : "de noche");
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
    const ceniza = estado.modoDet === "ceniza";
    const valor = (s) => ceniza ? s.indCen : s.indice;
    const ms = estado.muestras.filter(s => ahora - new Date(s.t).getTime() <= VENTANA_GRAF_MS && valor(s) != null);
    const umbral = ceniza ? estado.ajustes.umbralCeniza : estado.ajustes.umbral;
    if (!ms.length) {
      puntosGraf = [];
      ctx.fillStyle = "#9aa7b4"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(estado.ajustes.muestreo ? "Esperando la primera muestra..." : "Marque «registrar» para graficar el índice", Wc / 2, Hc / 2);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      return;
    }
    const max = Math.max(1, umbral * 1.5, ...ms.map(valor)) * 1.08;
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
    puntosGraf = ms.map(s => ({ x: X(new Date(s.t).getTime()), y: Y(valor(s)), s }));
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
      lect.textContent = fmtLocal.format(t) + " local · " + fmtUtc.format(t) + " UTC · índice " + valor(p.s).toFixed(2) + " %" + (ceniza
        ? (p.s.calidos != null ? " · " + p.s.calidos + " más cálidos, " + p.s.oscuros + " más oscuros" : "") +
          (p.s.topeCol != null ? " · columna: tope " + p.s.topeCol + " m, alto " + p.s.altoCol + " m, ancho " + p.s.anchoCol + " m" : "")
        : (p.s.brillantes != null ? " · " + p.s.brillantes + " brillantes, " + p.s.rojizos + " rojizos" : "") +
          (p.s.topeInc != null ? " · tope " + p.s.topeInc + " m, alto " + p.s.altoInc + " m, ancho " + p.s.anchoInc + " m" : ""));
    } else {
      const u = ms[ms.length - 1];
      lect.textContent = "Última: " + fmtLocal.format(new Date(u.t)) + " · " + valor(u).toFixed(2) + " % · " + ms.length + " muestras en 6 h";
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
    dibujarSilueta();
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

    // Zonas de detección: la ROI del cráter (incandescencia, rojo) y la
    // zona de columna (ceniza, café). Fuera de Calibrar se ve solo la del
    // detector activo. Solo el borde; en Calibrar el interior se arrastra.
    const r = estado.roi, zc = estado.zonaCol, cal = estado.modoUi === "calibrar";
    const marcoVisible = estado.ajustes.marco !== false;
    const zonaRect = (q, color, manija) => overlay.appendChild(el("rect", { x: q.x, y: q.y, width: q.w, height: q.h, fill: "none", stroke: color,
      "stroke-width": 1.5, "stroke-dasharray": "5 4", "pointer-events": cal ? "all" : "none",
      class: cal ? "arrastrable" : "", "data-manija": manija }));
    if (cal || (marcoVisible && estado.modoDet === "ceniza")) zonaRect(zc, "rgb(232,170,90)", "zona");
    if (cal || (marcoVisible && estado.modoDet !== "ceniza")) zonaRect(r, "#e5533d", "roi");
    const mm = estado.mancha;
    if (mm && marcoVisible && !$("inserto").hidden) {
      const colorGuia = COLOR_GUIA[mm.modo] || COLOR_GUIA.incand;
      const gm = el("g", { stroke: colorGuia, fill: "none", "stroke-width": 1.2, "pointer-events": "none" });
      gm.appendChild(el("rect", { x: mm.izqRef, y: mm.topRef, width: mm.derRef - mm.izqRef, height: mm.botRef - mm.topRef }));
      const xc = mm.modo === "ceniza" ? mm.derRef + 8 : Math.max(mm.derRef, r.x + r.w) + 8;
      gm.appendChild(el("line", { x1: mm.derRef, y1: mm.topRef, x2: xc + 4, y2: mm.topRef, "stroke-dasharray": "3 2" }));
      gm.appendChild(el("line", { x1: xc, y1: mm.topRef, x2: xc, y2: mm.botRef }));
      gm.appendChild(el("line", { x1: xc - 3, y1: mm.botRef, x2: xc + 3, y2: mm.botRef }));
      gm.appendChild(el("text", { x: xc + 7, y: mm.topRef + 4, fill: colorGuia, stroke: "rgba(0,0,0,0.6)", "stroke-width": 2.5,
        "paint-order": "stroke", "font-size": 13, "font-family": "system-ui, sans-serif" }, (mm.modo === "ceniza" ? "columna " : "tope ") + fmtM(mm.topeM)));
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
      overlay.appendChild(el("rect", { x: zc.x + zc.w - 7, y: zc.y + zc.h - 7, width: 14, height: 14, fill: "rgb(232,170,90)", stroke: "#000", class: "arrastrable", "data-manija": "zona-esq" }));
      overlay.appendChild(el("text", { x: zc.x + 6, y: zc.y + 16, fill: "rgb(232,170,90)", "font-size": 13, stroke: "rgba(0,0,0,0.8)",
        "stroke-width": 3, "paint-order": "stroke", "font-family": "system-ui, sans-serif" }, "zona de columna (ceniza)"));
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
    arrastre = { tipo: m, p0: p, calib0: Object.assign({}, estado.calib), roi0: Object.assign({}, estado.roi), zona0: Object.assign({}, estado.zonaCol) };
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
    } else if (arrastre.tipo === "zona") {
      estado.zonaCol.x = arrastre.zona0.x + dx; estado.zonaCol.y = arrastre.zona0.y + dy;
    } else if (arrastre.tipo === "zona-esq") {
      estado.zonaCol.w = Math.max(40, arrastre.zona0.w + dx); estado.zonaCol.h = Math.max(40, arrastre.zona0.h + dy);
    }
    dibujarOverlay(); llenarCalib();
    if (arrastre.tipo.startsWith("roi") || arrastre.tipo.startsWith("zona") || arrastre.tipo === "base") actualizarInserto();
  });
  const soltar = () => {
    if (!arrastre) return;
    if (arrastre.tipo !== "marcador") { guardar(LS.calib, estado.calib); guardar(LS.roi, estado.roi); guardar(LS.zonaCol, estado.zonaCol); }
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
        "</td><td class='num'>" + (r.anchoInc != null ? r.anchoInc : "") + "</td><td class='num'>" + (r.indCen != null ? r.indCen.toFixed(2) : "") +
        "</td><td>" + escapar(r.nota || "") +
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
      indCen: m && m.ceniza ? +m.ceniza.indice.toFixed(2) : null,
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
    descargarCsv("registro_tata.csv", [["fecha_hora_local", "iso_utc", "tipo", "altura_m", "indice_incand_pct", "tope_incand_m", "alto_incand_m", "ancho_incand_m", "indice_ceniza_pct", "nota"]]
      .concat(estado.registro.map(r => [horaLocal(new Date(r.t)), r.t, r.tipo, r.altura, r.indice, r.topeInc, r.altoInc, r.anchoInc, r.indCen, r.nota])));
  });
  $("btn-borrar-registro").addEventListener("click", () => {
    if (confirm("¿Borrar todo el registro de observaciones de este navegador?")) { estado.registro = []; guardar(LS.registro, []); renderRegistro(); }
  });
  $("btn-exp-muestras").addEventListener("click", () => {
    descargarCsv("muestras_deteccion.csv", [["fecha_hora_local", "iso_utc", "detector", "lum_cielo", "camara_bn", "indice_incand_pct", "lum_roi", "lum_cuadro", "px_rojizos", "px_brillantes", "umbral_brillo",
      "tope_incand_m", "alto_incand_m", "ancho_incand_m", "indice_ceniza_pct", "px_mas_calidos", "px_mas_oscuros", "tope_columna_m", "alto_columna_m", "ancho_columna_m"]]
      .concat(estado.muestras.map(s => [horaLocal(new Date(s.t)), s.t, s.modo === "ceniza" ? "dia" : "noche", s.lumCielo, s.bn, s.indice, s.lumRoi, s.lumCuadro, s.rojizos, s.brillantes, s.umbralBrillo,
        s.topeInc, s.altoInc, s.anchoInc, s.indCen, s.calidos, s.oscuros, s.topeCol, s.altoCol, s.anchoCol])));
  });
  $("btn-borrar-muestras").addEventListener("click", () => {
    if (confirm("¿Borrar las muestras de los índices de incandescencia y ceniza?")) { estado.muestras = []; guardar(LS.muestras, []); dibujarGrafico(); }
  });

  // ---------- Formularios ----------
  function llenarFuente() {
    const a = estado.ajustes;
    $("in-alias").value = a.alias; $("in-modo").value = a.modo; $("in-hls").value = a.hlsUrl; $("in-snap").value = a.snapshotUrl;
    $("in-int-snap").value = a.intervaloSnapshot; $("n-int").value = a.intervaloMuestreo; $("n-umbral").value = a.umbral;
    $("n-muestreo").checked = $("n-muestreo-ins").checked = !!a.muestreo; $("n-brillo-umbral").value = a.umbralBrillo;
    $("c-umbral").value = a.umbralCeniza; $("c-calidez").value = a.umbralCalidez; $("c-oscuro").value = a.umbralOscuro; $("n-brillo").value = a.brillo; $("n-contraste").value = a.contraste;
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
    const zc = estado.zonaCol;
    $("cal-zona").value = [zc.x, zc.y, zc.w, zc.h].map(v => Math.round(v)).join(", ");
  }
  $("btn-conectar").addEventListener("click", () => { leerFuente(); conectar(); });
  $("btn-abrir-cam").addEventListener("click", () => window.open("https://www.nevadosdechillan.com/camaras", "_blank", "noopener"));
  $("btn-cal-aplicar").addEventListener("click", () => {
    const c = estado.calib;
    c.x = +$("cal-x").value; c.y0 = +$("cal-y0").value; c.pxPor100m = Math.max(2, +$("cal-px").value); c.alturaMax = Math.max(100, +$("cal-max").value);
    const partes = $("cal-roi").value.split(/[,\s]+/).map(Number).filter(v => !isNaN(v));
    if (partes.length === 4) estado.roi = { x: partes[0], y: partes[1], w: partes[2], h: partes[3] };
    const pz = $("cal-zona").value.split(/[,\s]+/).map(Number).filter(v => !isNaN(v));
    if (pz.length === 4) estado.zonaCol = { x: pz[0], y: pz[1], w: Math.max(40, pz[2]), h: Math.max(40, pz[3]) };
    guardar(LS.calib, c); guardar(LS.roi, estado.roi); guardar(LS.zonaCol, estado.zonaCol); dibujarOverlay(); llenarCalib();
  });
  $("btn-cal-reset").addEventListener("click", () => {
    estado.calib = Object.assign({}, CFG.calibracion); estado.roi = Object.assign({}, CFG.roi);
    estado.zonaCol = Object.assign({}, CFG.zonaColumna || { x: 568, y: 241, w: 600, h: 335 });
    try { localStorage.removeItem(LS.calib); localStorage.removeItem(LS.roi); localStorage.removeItem(LS.zonaCol); } catch (e) {}
    dibujarOverlay(); llenarCalib();
  });
  const guardarNoche = () => {
    const a = estado.ajustes;
    a.brillo = +$("n-brillo").value; a.contraste = +$("n-contraste").value; a.muestreo = $("n-muestreo").checked;
    a.intervaloMuestreo = +$("n-int").value || 10; a.umbral = +$("n-umbral").value || 0;
    a.umbralBrillo = Math.min(255, Math.max(1, +$("n-brillo-umbral").value || 200));
    a.umbralCeniza = Math.max(0, +$("c-umbral").value || 0);
    a.umbralCalidez = Math.max(1, +$("c-calidez").value || 12);
    a.umbralOscuro = Math.max(1, +$("c-oscuro").value || 25);
    guardar(LS.ajustes, a); aplicarFiltro(); dibujarOverlay();
  };
  ["n-brillo", "n-contraste", "n-int", "n-umbral", "n-brillo-umbral", "c-umbral", "c-calidez", "c-oscuro"].forEach(id => $(id).addEventListener("input", () => { guardarNoche(); actualizarInserto(); dibujarGrafico(); }));
  $("n-muestreo").addEventListener("change", () => { $("n-muestreo-ins").checked = $("n-muestreo").checked; guardarNoche(); reprogramarMuestreo(); dibujarGrafico(); });
  $("n-muestreo-ins").addEventListener("change", () => { $("n-muestreo").checked = $("n-muestreo-ins").checked; guardarNoche(); reprogramarMuestreo(); dibujarGrafico(); });
  ["n-int"].forEach(id => $(id).addEventListener("change", reprogramarMuestreo));
  $("btn-fondo").addEventListener("click", () => { reiniciarFondo(); actualizarInserto(); });
  // Selector de detector en el recuadro: automático, ceniza o incandescencia.
  document.querySelectorAll("[data-det]").forEach(b => b.addEventListener("click", () => {
    estado.ajustes.detector = b.dataset.det; guardar(LS.ajustes, estado.ajustes);
    actualizarInserto(); dibujarGrafico();
  }));
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
    $("r-tipo").value = estado.mancha.modo === "ceniza" ? "columna" : "incandescencia";
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

  function mostrarSilueta(ver) {
    estado.ajustes.silueta = ver; guardar(LS.ajustes, estado.ajustes);
    $("btn-silueta").classList.toggle("activo", ver);
    dibujarOverlay();
  }
  $("btn-silueta").addEventListener("click", () => {
    if (!estado.silueta) { $("panel-cal").open = true; abrirMenu(true); return; }
    mostrarSilueta(estado.ajustes.silueta === false);
  });
  $("btn-trazar-silueta").addEventListener("click", () => {
    const r = trazarSilueta();
    const nota = $("silueta-nota");
    if (r.error) { nota.textContent = "No se pudo trazar: " + r.error + "."; return; }
    if (r.validos < 0.5 * r.total) { nota.textContent = "Solo se encontró el borde en " + r.validos + " de " + r.total + " columnas. Pruebe con el cielo más despejado."; }
    else nota.textContent = "Silueta trazada en " + r.validos + " de " + r.total + " columnas, " + horaLocal(new Date()) + ".";
    estado.silueta = r.puntos; guardar(LS.silueta, r.puntos);
    mostrarSilueta(true);
  });
  $("btn-borrar-silueta").addEventListener("click", () => {
    estado.silueta = CFG.silueta || null;
    try { localStorage.removeItem(LS.silueta); } catch (e) {}
    $("silueta-nota").textContent = estado.silueta ? "Se volvió a la silueta de la configuración." : "Silueta borrada.";
    dibujarOverlay();
  });
  $("btn-copiar-silueta").addEventListener("click", () => {
    if (!estado.silueta) { $("silueta-nota").textContent = "No hay silueta que copiar."; return; }
    const texto = "silueta: " + JSON.stringify(estado.silueta) + ",";
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
      .then(() => { $("silueta-nota").textContent = "Copiada. Péguela en config.js para dejarla fija."; })
      .catch(() => { $("silueta-nota").textContent = "No se pudo copiar al portapapeles."; });
  });

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
    else if (k === "s" && estado.silueta) mostrarSilueta(estado.ajustes.silueta === false);
  });

  // ---------- Inicio ----------
  $("version").textContent = VERSION;
  mostrarInserto(estado.ajustes.inserto !== false);
  mostrarMarco(estado.ajustes.marco !== false);
  $("btn-silueta").classList.toggle("activo", !!estado.silueta && estado.ajustes.silueta !== false);
  console.info("Seguimiento Cámara Tata, versión " + VERSION);
  llenarFuente(); llenarCalib(); renderRegistro(); dibujarGrafico(); dibujarOverlay();
  conectar().then(reprogramarMuestreo);
})();
