// Configuración del sitio. Edite este archivo y vuelva a publicar o a
// generar el HTML único. Todo lo que se cambie desde la interfaz queda
// guardado en el navegador (localStorage) y tiene prioridad sobre estos
// valores.
window.CAM_CONFIG = {
  // Alias de la cámara en IPCamLive. Se obtiene del iframe que usa
  // https://www.nevadosdechillan.com/camaras :
  //   <iframe src="https://ipcamlive.com/player/player.php?alias=XXXXXXXX">
  alias: "plazatata",

  // Modo de visualización inicial: "hls" | "snapshot" | "iframe"
  //   hls      : video en vivo con hls.js; permite medir y analizar píxeles.
  //   snapshot : imagen JPG actualizada cada N segundos; muy liviano.
  //   iframe   : reproductor oficial de IPCamLive; solo permite medir
  //              con la escala superpuesta, sin análisis de píxeles.
  modo: "snapshot",

  // URLs directas opcionales. Si se dejan vacías se derivan del alias.
  hlsUrl: "",
  snapshotUrl: "",

  // Segundos entre snapshots en modo "snapshot".
  intervaloSnapshot: 10,

  // Calibración preliminar en píxeles del cuadro nativo de la cámara
  // (snapshot de 1920 × 1080 px). Se reescala si el video llega con otra
  // resolución.
  //   x         : columna de la escala (vertical sobre el cráter)
  //   y0        : fila del 0 m (cumbre / borde del cráter)
  //   pxPor100m : píxeles por cada 100 m de altura
  //   alturaMax : extensión de la escala, en metros
  // Valores trasladados desde la captura de calibración original
  // (docs/calibracion_preliminar.jpg) mediante un ajuste afín con 228
  // puntos homólogos; ver README, sección Calibración.
  calibracion: { refW: 1920, x: 868.5, y0: 565.6, pxPor100m: 54.1, alturaMax: 500 },

  // Región de interés para el índice de incandescencia nocturna, en los
  // mismos píxeles del cuadro nativo (rectángulo sobre el cráter).
  roi: { x: 808, y: 525, w: 120, h: 68 },

  // Umbral del índice de incandescencia (% de píxeles "calientes" en la
  // ROI) a partir del cual se marca actividad.
  umbralIncandescencia: 2,

  // Luminancia (0 a 255) desde la cual un píxel cuenta como brillante.
  // De noche la cámara transmite en blanco y negro, por lo que este es el
  // criterio que detecta la incandescencia. Valor provisional.
  umbralBrillo: 200,

  // Detección de ceniza (de día). Zona de columna sobre el cráter, en
  // píxeles de referencia, y umbrales provisionales:
  //   umbralCeniza  : % de píxeles de la zona para marcar posible emisión
  //   umbralCalidez : aumento mínimo de R − B de un píxel sobre su fondo
  //   umbralOscuro  : baja mínima de luminancia de un píxel bajo su fondo
  zonaColumna: { x: 568, y: 241, w: 600, h: 335 },
  umbralCeniza: 1,
  umbralCalidez: 12,
  umbralOscuro: 25,

  // Segundos entre muestras de los índices.
  intervaloMuestreo: 10,

  // Relación de aspecto a usar cuando no se conoce el tamaño del video
  // (modo iframe).
  aspectoPorDefecto: 16 / 9,

  // Zona horaria para mostrar y registrar horas.
  zonaHoraria: "America/Santiago"
};
