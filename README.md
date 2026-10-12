# Seguimiento Cámara Tata

Sitio estático para seguir la altura de la columna eruptiva y la incandescencia nocturna del complejo volcánico Nevados de Chillán usando la cámara pública Plaza Tata del centro de ski, publicada a través de IPCamLive.

El sitio no necesita servidor ni compilación. Se puede publicar en GitHub Pages o usar como un único archivo HTML copiado a cualquier computador.

## Qué hace

- Muestra la cámara en vivo con una escala vertical calibrada sobre el cráter: 0 m en la cumbre y marcas cada 100 m hasta 500 m.
- Permite medir la altura de la columna con un clic o arrastre sobre el video y registrar la observación con hora local de Chile.
- Calcula un índice de incandescencia nocturna, definido como el porcentaje de píxeles rojizos o brillantes dentro de una región de interés sobre el cráter, y lo grafica en el tiempo.
- Muestra abajo a la izquierda una ampliación de la región de interés y una máscara con los píxeles detectados: amarillo para rojizos y cian para brillantes.
- Ofrece realce de brillo y contraste para observación nocturna.
- Guarda la calibración, el registro de observaciones y las muestras del índice en el navegador y las exporta a CSV.
- Exporta capturas PNG con la escala, el marcador de altura y la hora impresos sobre el cuadro.

## Cómo obtener el alias de la cámara

1. Abra https://www.nevadosdechillan.com/camaras en el navegador.
2. Con clic derecho sobre el reproductor de Plaza Tata elija Inspeccionar, o vea el código fuente de la página.
3. Busque un iframe con un `src` del tipo `https://ipcamlive.com/player/player.php?alias=XXXXXXXX`. El valor de `alias` es lo que necesita. Para la cámara Plaza Tata el alias es `plazatata` y ya viene configurado.

Si se prefiere, la pestaña Red de las herramientas de desarrollo muestra también la URL del stream HLS (termina en `stream.m3u8`) y la URL del snapshot JPG. Ambas se pueden pegar directamente en el panel Fuente del sitio.

## Configuración

Edite `config.js` para dejar el alias fijo y elegir el modo inicial:

| Modo | Qué muestra | Medición | Índice de incandescencia |
|---|---|---|---|
| `snapshot` (por defecto) | Imagen JPG cada N segundos | Sí | Sí, si el servidor permite leer píxeles (CORS) |
| `hls` | Video en vivo con hls.js | Sí | Sí, si el servidor permite leer píxeles (CORS) |
| `iframe` | Reproductor oficial de IPCamLive | Sí | No |

Todo lo que se cambie desde la interfaz queda guardado en el navegador y tiene prioridad sobre `config.js`.

## Publicar en GitHub Pages

1. En el repositorio, vaya a Settings, luego Pages.
2. En Source elija Deploy from a branch, seleccione la rama y la carpeta raíz.
3. En unos minutos el sitio queda en `https://<usuario>.github.io/seguimiento-camara-tata/`.

## Generar un solo archivo HTML

```bash
python3 scripts/exportar_html_unico.py
```

Escribe `dist/tata.html` con el CSS, la lógica, la configuración y hls.js embebidos. Ese archivo se copia a cualquier computador y se abre con doble clic en Chrome, Edge o Firefox. El registro y la calibración se guardan en el navegador de esa máquina; use Exportar CSV para llevarse los datos.

## Uso

La cámara ocupa toda la ventana. Encima de la imagen hay una barra con los controles principales:

- **Ver, Medir, Calibrar**: modos de interacción con la imagen.
- **Video, Snapshot**: fuente de imagen. Queda marcada la que realmente se está mostrando, también cuando el video falla y el sitio pasa solo a snapshot.
- **Altura**: lectura del marcador de medición, en metros sobre la cumbre.
- **Registrar** y **Capturar PNG**: guardan la observación o descargan el cuadro con la escala.
- **⛶**: pantalla completa. En ese modo la barra se oculta tras unos segundos sin mover el mouse.
- **☰**: abre el panel lateral con la fuente, la calibración, el índice de incandescencia y el registro.
- **Relojes**: hora local de Chile y hora UTC.

Atajos de teclado: V ver, M medir, C calibrar, Z recuadro de detección, R marco, F pantalla completa y Esc para cerrar el panel lateral.

Detalle de cada modo:

- **Ver**: la imagen no responde al mouse. En modo iframe se pueden usar los controles del reproductor.
- **Medir**: un clic o arrastre sobre la imagen coloca una línea horizontal y muestra la altura sobre la cumbre, redondeada a 5 m en pantalla; el registro guarda el valor en metros. Registrar guarda la hora, el tipo de actividad, la altura, el índice de incandescencia y una nota.
- **Calibrar**: aparecen tres manijas. El punto celeste (0 m) se arrastra hasta la cumbre, el punto verde (500 m) fija la escala y el rectángulo rojo es la región de interés para incandescencia. También se pueden escribir los valores en el panel Calibración.
- **Detección**: muestra u oculta el recuadro de la región de interés, también con la tecla Z. La máscara permite ver qué píxeles cuentan para el índice y ajustar el umbral de brillo. Debajo, un gráfico muestra el índice de las últimas 6 horas con el umbral de alerta; al pasar el mouse se lee la hora local, la hora UTC y el valor de cada muestra. La casilla «registrar» activa el muestreo automático.
- **Tope, alto y ancho de la incandescencia**: el recuadro de detección toma la mancha conectada más grande de la máscara, de al menos 6 píxeles, y la convierte a metros con la calibración. Informa a qué altura sobre la cumbre llega su borde superior y cuánto mide de alto y de ancho. Sobre la imagen se dibuja en cian la caja de la mancha y una cota con el tope. El botón «Medir tope» lleva el marcador de altura a ese borde y deja el tipo de registro en incandescencia, para ajustarlo si hace falta y registrarlo. El registro y las muestras guardan las tres medidas.
- **Marco**: muestra u oculta el borde de la región de interés sobre la imagen, también con la tecla R. En modo Calibrar el marco se ve siempre.
- **Criterios del índice**: un píxel cuenta si es rojizo, es decir brillante y con dominante roja, o si su luminancia supera el umbral de brillo, que por defecto es 200 en una escala de 0 a 255. De noche la cámara transmite en blanco y negro, así que solo actúa el criterio de brillo. De día, la nieve muy iluminada puede superar el umbral; la luminancia del cuadro, registrada en cada muestra, permite separar día y noche.
- **Noche**: en el panel lateral se activa el muestreo automático para calcular el índice cada N segundos. Cuando supera el umbral, la lectura se marca en rojo. Los presets de brillo y contraste solo afectan la visualización, no el análisis.

## Calibración preliminar

La cámara entrega cuadros de 1920 × 1080 px con un lente gran angular. La calibración se expresa en píxeles de ese cuadro nativo y se reescala si el video llega con otra resolución.

| Parámetro | Valor | Significado |
|---|---|---|
| x | 868.5 | columna de la escala, sobre el cráter |
| y0 | 565.6 | fila del 0 m, en la cumbre |
| píxeles por 100 m | 54.1 | separación entre marcas |
| altura máxima | 500 m | extensión de la escala |
| ROI | 808, 525, 120, 68 | región para el índice de incandescencia |

### De dónde salen estos valores

La escala original se dibujó sobre una captura de pantalla de 1393 × 667 px (`docs/calibracion_preliminar.jpg`), con 0 m en la fila 380.5 y 47.5 px entre marcas. Esa captura resultó ser un recorte del cuadro nativo con la dimensión vertical comprimida. Para trasladar la escala se emparejaron 228 puntos homólogos entre la captura y un snapshot nativo (`docs/snapshot_plazatata_1920x1080.jpg`) y se ajustó una transformación afín. El ajuste da una escala horizontal de 1.004, una escala vertical de 1.139, rotación nula y un residuo mediano de 0.43 px. El resultado sobre el cuadro nativo está en `docs/calibracion_cuadro_nativo.jpg`.

Los 47.5 px por 100 m originales se midieron directamente sobre la captura. Por eso la escala debe acompañar al paisaje al trasladarse, y en el cuadro nativo corresponde a 54.1 px por 100 m.

### Supuestos y limitaciones

- La altura se mide sobre la cumbre visible, suponiendo que la columna sube en vertical y en el mismo plano que el cráter. Una columna inclinada por el viento o desplazada hacia la cámara o hacia atrás cambia la escala aparente.
- La escala es lineal. El lente gran angular deforma los bordes del cuadro, pero el cráter está cerca del centro, donde la deformación es menor. Las columnas que superen el cuadro superior de la escala conviene interpretarlas con más cautela.
- La escala debe verificarse con una referencia de altitud conocida antes de reportar valores. Hasta entonces las alturas son estimaciones.
- Si la cámara cambia de encuadre o de zoom, la calibración deja de valer y hay que repetirla con el modo Calibrar.
- Las medidas de la incandescencia comparten los supuestos de la altura de columna. Además, un píxel equivale a unos 1.85 m en el plano del cráter, así que alto y ancho tienen una resolución de unos 2 m y se muestran redondeados a 5 m. Un punto muy brillante se expande algunos píxeles en el sensor, lo que tiende a sobrestimar alto y ancho. El resplandor reflejado en gases o nubes también puede quedar sobre el umbral y alargar la mancha hacia arriba. Si la mancha toca el borde de la zona de detección, el recuadro lo advierte, porque puede estar recortada.

## Registro automático desde un computador

`scripts/monitor.py` captura un cuadro cada N minutos, lo guarda, dibuja la escala y calcula el índice de incandescencia. Sirve para dejar un registro continuo sin tener el navegador abierto.

```bash
pip install pillow
python3 scripts/monitor.py --alias plazatata --intervalo 5 --salida datos
```

Opciones principales: `--umbral-brillo` fija la luminancia desde la cual un píxel cuenta como brillante, `--modo hls` usa ffmpeg para tomar el cuadro del stream, `--snapshot-url` y `--hls-url` aceptan URLs directas, `--una-vez` captura una sola vez y `--calib X Y0 PX100` y `--roi X Y W H` sobrescriben la calibración. La salida queda en `datos/cuadros` (cuadros crudos), `datos/cuadros_escala` (con escala e índice) y `datos/registro.csv`.

## Notas técnicas

- Las URLs de IPCamLive usadas son las del reproductor público: `player.php?alias=`, `snapshot.php?alias=` y `getcamerastreamstate.php?alias=`. Esta última devuelve `details.address` y `details.streamid`, con los que se arma `<address>streams/<streamid>/stream.m3u8`. La URL del stream cambia de vez en cuando, por eso se consulta en cada conexión. Si IPCamLive cambia su API, basta con pegar la URL HLS o de snapshot directa en el panel Fuente.
- Si el modo HLS falla, el sitio reintenta tres veces con una URL recién consultada y luego cambia solo a snapshot. La línea de estado muestra el motivo y el servidor que falló.
- Cuando el sitio se abre por https, como en GitHub Pages, las direcciones `http://` del stream se piden por `https://`. El navegador bloquea el contenido `http` dentro de una página `https`.
- El análisis de píxeles exige que el servidor envíe cabeceras CORS. Si no lo hace, el sitio lo indica en la línea de estado y queda disponible la clasificación manual. El script `monitor.py` no tiene esta limitación.
- hls.js está incluido en `vendor/` (licencia Apache 2.0) para no depender de un CDN.
- Los CSV usan punto y coma como separador para abrirse directamente en Excel en configuración regional chilena.
