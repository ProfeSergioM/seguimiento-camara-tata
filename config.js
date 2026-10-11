// Configuración del sitio. Edite este archivo y vuelva a publicar o a
// generar el HTML único. Todo lo que se cambie desde la interfaz queda
// guardado en el navegador (localStorage) y tiene prioridad sobre estos
// valores.
window.CAM_CONFIG = {
  // Alias de la cámara en IPCamLive. Se obtiene del iframe que usa
  // https://www.nevadosdechillan.com/camaras :
  //   <iframe src="https://ipcamlive.com/player/player.php?alias=XXXXXXXX">
  alias: "",

  // Modo de visualización inicial: "hls" | "snapshot" | "iframe"
  //   hls      : video en vivo con hls.js; permite medir y analizar píxeles.
  //   snapshot : imagen JPG actualizada cada N segundos; muy liviano.
  //   iframe   : reproductor oficial de IPCamLive; solo permite medir
  //              con la escala superpuesta, sin análisis de píxeles.
  modo: "hls",

  // URLs directas opcionales. Si se dejan vacías se derivan del alias.
  hlsUrl: "",
  snapshotUrl: "",

  // Segundos entre snapshots en modo "snapshot".
  intervaloSnapshot: 10,

  // Calibración preliminar, en píxeles de referencia de un cuadro de
  // 1393 px de ancho (la captura usada para calibrar). Las coordenadas se
  // reescalan al tamaño real del video.
  //   x         : columna de la escala (vertical sobre el cráter)
  //   y0        : fila del 0 m (cumbre / borde del cráter)
  //   pxPor100m : píxeles de referencia por cada 100 m de altura
  //   alturaMax : extensión de la escala, en metros
  calibracion: { refW: 1393, x: 678, y0: 380.5, pxPor100m: 47.5, alturaMax: 500 },

  // Región de interés para el índice de incandescencia nocturna, en los
  // mismos píxeles de referencia (rectángulo sobre el cráter).
  roi: { x: 618, y: 345, w: 120, h: 60 },

  // Umbral del índice de incandescencia (% de píxeles "calientes" en la
  // ROI) a partir del cual se marca actividad.
  umbralIncandescencia: 2,

  // Segundos entre muestras del índice de incandescencia.
  intervaloMuestreo: 10,

  // Relación de aspecto a usar cuando no se conoce el tamaño del video
  // (modo iframe).
  aspectoPorDefecto: 16 / 9,

  // Zona horaria para mostrar y registrar horas.
  zonaHoraria: "America/Santiago"
};
