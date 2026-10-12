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

  // Silueta del volcán, trazada el 12-10-2026 a las 07:04 con cielo
  // despejado, en píxeles de referencia ([x, y] o null donde no hay borde).
  // Entre x = 1172 y 1188 se corrigió a mano un falso borde por neblina.
  // Se puede volver a trazar desde el panel Calibración.
  silueta: [[0,478],[4,478],[8,478],[12,478],[16,480],[20,480],[24,478],[28,478],[32,480],[36,480],[40,480],[44,502],[48,502],[52,502],[56,502],[60,500],[64,482],[68,482],[72,482],[76,480],[80,478],[84,478],[88,476],[92,476],[96,476],[100,476],[104,476],[108,476],[112,480],[116,480],[120,480],[124,480],[128,482],null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,[264,496],null,null,null,null,null,null,null,[296,504],null,null,[308,504],[312,504],[316,508],[320,508],[324,508],[328,510],[332,512],[336,512],[340,512],[344,512],[348,514],[352,516],[356,516],[360,520],[364,522],[368,524],[372,524],[376,526],[380,528],[384,530],[388,530],[392,532],[396,532],[400,532],[404,534],[408,534],[412,534],[416,534],[420,538],[424,538],[428,538],[432,538],[436,540],[440,540],[444,540],[448,540],[452,540],[456,542],[460,542],[464,542],[468,542],[472,542],[476,542],[480,542],[484,542],[488,544],[492,544],[496,546],[500,546],[504,546],[508,546],[512,546],[516,546],[520,548],[524,548],[528,548],[532,548],[536,550],[540,550],[544,552],[548,554],[552,554],[556,554],[560,554],[564,554],[568,554],[572,552],[576,552],[580,550],[584,550],[588,546],[592,546],[596,546],[600,544],[604,538],[608,538],[612,534],[616,534],[620,534],[624,532],[628,532],[632,530],[636,528],[640,524],[644,524],[648,524],[652,520],[656,520],[660,518],[664,518],[668,518],[672,520],[676,520],[680,522],[684,522],[688,522],[692,522],[696,522],[700,522],[704,522],[708,522],[712,522],[716,520],[720,520],[724,520],[728,520],[732,520],[736,520],[740,520],[744,522],[748,524],[752,524],[756,524],[760,526],[764,526],[768,528],[772,530],[776,532],[780,532],[784,538],[788,544],[792,544],[796,546],[800,548],[804,552],[808,552],[812,554],[816,554],[820,554],[824,556],[828,556],[832,556],[836,556],[840,558],[844,560],[848,562],[852,562],[856,562],[860,562],[864,562],[868,564],[872,566],[876,566],[880,566],[884,566],[888,566],[892,566],[896,564],[900,562],[904,558],[908,556],[912,552],[916,550],[920,548],[924,544],[928,544],[932,540],[936,536],[940,530],[944,528],[948,528],[952,522],[956,522],[960,522],[964,522],[968,520],[972,520],[976,520],[980,520],[984,520],[988,520],[992,520],[996,520],[1000,520],null,[1008,530],null,null,[1020,528],[1024,528],[1028,526],[1032,526],[1036,526],[1040,526],[1044,528],[1048,528],[1052,528],null,null,[1064,528],[1068,528],[1072,526],[1076,524],[1080,524],[1084,524],[1088,524],[1092,524],[1096,524],[1100,524],[1104,522],[1108,522],[1112,522],[1116,522],[1120,522],[1124,522],[1128,522],[1132,522],[1136,524],[1140,524],[1144,524],[1148,524],[1152,524],[1156,524],[1160,524],[1164,524],[1168,524],[1172,526],[1176,528],[1180,530],[1184,531],[1188,533],[1192,534],[1196,536],[1200,536],[1204,538],[1208,538],[1212,538],[1216,538],[1220,540],[1224,540],[1228,540],null,null,[1240,540],[1244,544],[1248,544],[1252,544],[1256,544],[1260,544],[1264,544],[1268,544],[1272,544],[1276,544],[1280,542],[1284,542],[1288,540],[1292,538],[1296,536],[1300,536],[1304,534],[1308,534],[1312,532],[1316,532],[1320,532],[1324,532],[1328,530],[1332,528],[1336,528],[1340,526],[1344,526],[1348,526],[1352,526],[1356,524],[1360,524],[1364,524],[1368,524],[1372,524],[1376,524],[1380,526],[1384,526],[1388,526],[1392,526],[1396,526],[1400,528],[1404,528],[1408,528],[1412,528],[1416,528],[1420,526],[1424,522],[1428,516],[1432,514],[1436,506],[1440,504],[1444,500],[1448,496],[1452,484],[1456,476],[1460,474],[1464,470],[1468,468],[1472,464],[1476,460],[1480,458],[1484,454],[1488,450],[1492,450],[1496,448],[1500,446],[1504,446],[1508,446],[1512,446],[1516,446],[1520,446],[1524,446],[1528,446],[1532,446],[1536,448],[1540,450],[1544,452],[1548,452],[1552,452],[1556,452],[1560,452],[1564,454],null,null,null,null,[1584,458],[1588,458],[1592,458],[1596,458],null,null,null,null,null,null,null,null,[1632,452],[1636,450],[1640,450],[1644,450],[1648,448],[1652,448],[1656,448],[1660,448],[1664,448],[1668,448],[1672,448],[1676,448],null,[1684,448],[1688,448],[1692,448],null,null,[1704,442],[1708,442],[1712,442],[1716,442],[1720,442],[1724,442],[1728,442],[1732,442],[1736,440],[1740,440],[1744,440],[1748,438],[1752,438],null,[1760,434],[1764,434],[1768,432],[1772,432],[1776,432],[1780,432],[1784,432],[1788,432],[1792,432],[1796,432],[1800,434],[1804,432],[1808,432],[1812,432],[1816,432],[1820,426],[1824,424],[1828,420],[1832,418],[1836,410],[1840,408],[1844,398],[1848,396],[1852,394],[1856,392],[1860,390],[1864,390],[1868,390],[1872,390],[1876,390],[1880,388],[1884,388],[1888,388],[1892,386],[1896,386],[1900,386],[1904,382],[1908,382],[1912,380],[1916,380]],

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
