# Seguimiento Cámara Tata

Sitio estático para seguir la altura de la columna eruptiva y la incandescencia nocturna del complejo volcánico Nevados de Chillán usando la cámara pública Plaza Tata del centro de ski, publicada a través de IPCamLive.

El sitio no necesita servidor ni compilación. Se puede publicar en GitHub Pages o usar como un único archivo HTML copiado a cualquier computador.

## Qué hace

- Muestra la cámara en vivo con una escala vertical calibrada sobre el cráter: 0 m en la cumbre y marcas cada 100 m hasta 500 m.
- Permite medir la altura de la columna con un clic o arrastre sobre el video y registrar la observación con hora local de Chile.
- Calcula un índice de incandescencia nocturna, definido como el porcentaje de píxeles rojizos o brillantes dentro de una región de interés sobre el cráter, y lo grafica en el tiempo.
- Muestra abajo a la izquierda una ampliación de la región de interés y una máscara con los píxeles detectados: amarillo para rojizos y cian para brillantes.
- De día detecta posibles emisiones de ceniza en una zona de columna sobre el cráter y estima la altura del tope de la columna.
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
- **Altura**: lectura del marcador de medición, en metros sobre la cumbre. El botón ✕ junto a la lectura borra la línea de medición, igual que las teclas Supr o Esc.
- **Registrar** y **Capturar PNG**: guardan la observación o descargan el cuadro con la escala.
- **⛶**: pantalla completa. En ese modo la barra se oculta tras unos segundos sin mover el mouse.
- **☰**: abre el panel lateral con la fuente, la calibración, el índice de incandescencia y el registro.
- **Relojes**: hora local de Chile y hora UTC.

Atajos de teclado: V ver, M medir, C calibrar, Z recuadro de detección, R marco, S silueta, F pantalla completa, Supr para borrar la medición y Esc para cerrar el panel lateral o, si está cerrado, borrar la medición.

Detalle de cada modo:

- **Ver**: la imagen no responde al mouse. En modo iframe se pueden usar los controles del reproductor.
- **Medir**: un clic o arrastre sobre la imagen coloca una línea horizontal y muestra la altura sobre la cumbre, redondeada a 5 m en pantalla; el registro guarda el valor en metros. Registrar guarda la hora, el tipo de actividad, la altura, el índice de incandescencia y una nota.
- **Calibrar**: aparecen tres manijas. El punto celeste (0 m) se arrastra hasta la cumbre, el punto verde (500 m) fija la escala y el rectángulo rojo es la región de interés para incandescencia. También se pueden escribir los valores en el panel Calibración.
- **Detección**: muestra u oculta el recuadro de la región de interés, también con la tecla Z. La máscara permite ver qué píxeles cuentan para el índice y ajustar el umbral de brillo. Debajo, un gráfico muestra el índice de las últimas 6 horas con el umbral de alerta; al pasar el mouse se lee la hora local, la hora UTC y el valor de cada muestra. La casilla «registrar» activa el muestreo automático.
- **Tope, alto y ancho de la incandescencia**: el recuadro de detección toma la mancha conectada más grande de la máscara, de al menos 6 píxeles, y la convierte a metros con la calibración. Informa a qué altura sobre la cumbre llega su borde superior y cuánto mide de alto y de ancho. Sobre la imagen se dibuja en cian la caja de la mancha y una cota con el tope. El botón «Medir tope» lleva el marcador de altura a ese borde y deja el tipo de registro en incandescencia, para ajustarlo si hace falta y registrarlo. El registro y las muestras guardan las tres medidas.
- **Detección de ceniza (de día)**: el recuadro cambia solo entre ceniza e incandescencia según la luminosidad del cielo, medida en el 40 % superior del cuadro. No se decide por el color, porque la cámara tarda en pasar de blanco y negro a color al amanecer y al revés al atardecer. Pasa a día sobre 78 y vuelve a noche bajo 62, en una escala de 0 a 255. En las imágenes disponibles el cielo da entre 109 y 141 de día, también en blanco y negro, y cerca de 40 de noche. El selector Auto, Ceniza, Incandescencia del recuadro permite fijar el detector. El método se explica más abajo.
- **Silueta**: muestra u oculta la silueta del volcán como referencia visual, también con la tecla S. Se traza desde la imagen actual con el botón «Trazar silueta» del panel Calibración, idealmente con cielo despejado y sin emisión: por cada columna se baja desde el cielo y se marca el primer punto que se aparta de forma sostenida de su color. En una imagen de prueba despejada el error mediano fue de 1.5 px, unos 3 m. Con cielo nublado el trazo sigue los bordes de las nubes. La silueta queda guardada en el navegador; «Copiar» entrega el texto para dejarla fija en `config.js`. No interviene en las mediciones. La configuración trae una silueta trazada en vivo el 12-10-2026 a las 07:04, con cielo despejado, con un falso borde por neblina corregido a mano entre x = 1172 y 1188.
- **Marco**: muestra u oculta el borde de la región de interés sobre la imagen, también con la tecla R. En modo Calibrar el marco se ve siempre.
- **Criterios del índice**: un píxel cuenta si es rojizo, es decir brillante y con dominante roja, o si su luminancia supera el umbral de brillo, que por defecto es 200 en una escala de 0 a 255. De noche la cámara transmite en blanco y negro, así que solo actúa el criterio de brillo. De día, la nieve muy iluminada puede superar el umbral; la luminancia del cuadro, registrada en cada muestra, permite separar día y noche.
- **Noche**: en el panel lateral se activa el muestreo automático para calcular el índice cada N segundos. Cuando supera el umbral, la lectura se marca en rojo. Los presets de brillo y contraste solo afectan la visualización, no el análisis.

## Calibración preliminar

La cámara entrega cuadros de 1920 × 1080 px con un lente gran angular. La calibración se expresa en píxeles de ese cuadro nativo y se reescala si el video llega con otra resolución.

| Parámetro | Valor | Significado |
|---|---|---|
| x | 1030 | columna de la escala, sobre el cráter activo |
| y0 | 526 | fila del 0 m, en la cresta donde nacen las emisiones |
| píxeles por 100 m | 54.1 | separación entre marcas |
| altura máxima | 800 m | extensión de la escala |
| ROI del cráter | 900, 490, 200, 85 | incandescencia y raíz de la columna de ceniza |
| zona de columna | 700, 0, 1200, 560 | detección de ceniza de día |

### Ubicación del cráter activo

Hasta el 12-10-2026 el 0 m estaba en x = 868.5, y = 565.6, el portezuelo entre el cerro oscuro y el macizo nevado. Cuatro observaciones lo desplazaron a la cresta donde nacen las emisiones: el punto brillante nocturno del 11-10, cerca de x = 927, y = 551, y tres emisiones del amanecer del 12-10, cuya base está cerca de x = 1000 a 1070. Sobre la silueta trazada en vivo, esa cresta está en y ≈ 520 a 528. El cambio sube el 0 m unos 40 px, unos 75 m. Las alturas medidas antes de ese día, sobre una columna que nace en esta cresta, quedan unos 75 m por encima de las actuales.

La ROI del cráter cubre tanto la base de las emisiones como el punto brillante nocturno. La zona de columna se amplió hacia la derecha y hacia arriba, porque la columna del 12-10 se inclinó en esa dirección.

### De dónde sale la separación entre marcas

La escala original se dibujó sobre una captura de pantalla de 1393 × 667 px (`docs/calibracion_preliminar.jpg`), con 0 m en la fila 380.5 y 47.5 px entre marcas. Esa captura resultó ser un recorte del cuadro nativo con la dimensión vertical comprimida. Para trasladar la escala se emparejaron 228 puntos homólogos entre la captura y un snapshot nativo (`docs/snapshot_plazatata_1920x1080.jpg`) y se ajustó una transformación afín. El ajuste da una escala horizontal de 1.004, una escala vertical de 1.139, rotación nula y un residuo mediano de 0.43 px. El resultado sobre el cuadro nativo está en `docs/calibracion_cuadro_nativo.jpg`.

Los 47.5 px por 100 m originales se midieron directamente sobre la captura. Por eso la escala debe acompañar al paisaje al trasladarse, y en el cuadro nativo corresponde a 54.1 px por 100 m. El 0 m de esa calibración original estaba en el portezuelo; su traslado a la cresta del cráter activo se explica arriba.

### Supuestos y limitaciones

- La altura se mide sobre la cresta del cráter activo, suponiendo que la columna sube en vertical y en el mismo plano que el cráter. La separación entre marcas se fijó en la calibración original y no se ha verificado a la distancia del cráter activo. Una columna inclinada por el viento o desplazada hacia la cámara o hacia atrás cambia la escala aparente.
- La escala es lineal. El lente gran angular deforma los bordes del cuadro, pero el cráter está cerca del centro, donde la deformación es menor. Las columnas que superen el cuadro superior de la escala conviene interpretarlas con más cautela.
- La escala debe verificarse con una referencia de altitud conocida antes de reportar valores. Hasta entonces las alturas son estimaciones.
- Si la cámara cambia de encuadre o de zoom, la calibración deja de valer y hay que repetirla con el modo Calibrar.

## Detección de ceniza

En las imágenes disponibles, tomadas al atardecer, la cámara deja el cielo, las nubes y la nieve con un tono azulado parejo: el canal rojo queda entre 30 y 60 niveles bajo el azul. La ceniza es gris café, más cálida que lo que la rodea. Como el balance de color cambia con la hora y el clima, el sitio no usa un umbral fijo de color, sino que compara cada píxel con su propio pasado.

1. **Zona de columna.** Se analiza un rectángulo sobre el cráter, por defecto desde unos 60 m bajo la cresta hasta el borde superior de la imagen, unos 970 m sobre ella, y de x = 700 a 1900. Se reduce a 300 píxeles de ancho, de modo que cada píxel de la máscara cubre unos 4 px de la cámara, unos 7 m. Se ajusta en modo Calibrar, arrastrando el rectángulo café, o en el panel Calibración.
2. **Fondo adaptativo.** Para cada píxel se mantiene un promedio lento de su tono (R − B) y de su luminancia, con una constante de tiempo de 10 minutos. El terreno, la nieve y el cielo quieto se cancelan.
3. **Dos señales.** Un píxel cuenta como candidato si se volvió más cálido que su fondo, con un aumento de R − B de al menos 12 niveles, o si se oscureció en al menos 25 niveles. A cada diferencia se le resta la mediana de la zona, para que un cambio general de luz no active la detección. En la máscara, café es más cálido y lila es más oscuro.
4. **Columna enraizada en el cráter.** La columna es la mancha conectada más grande que toca la ROI del cráter. Su borde superior da el tope sobre la cumbre, y su extensión, el alto y el ancho.
5. **Índice y alerta.** El índice de ceniza es el porcentaje de píxeles candidatos en la zona. Sobre el umbral, 1 % por defecto, el recuadro marca posible emisión.

Limitaciones que conviene tener presentes:

- El método se probó solo con imágenes simuladas: una columna gris café agregada a una foto real, una nube azulada lejos del cráter y un cambio general de luz. La columna se detectó con su tope a 340 m, y la nube y el cambio de luz no generaron detección. Los umbrales deben ajustarse con imágenes reales de emisiones de esta cámara.
- Con la cámara en blanco y negro de día solo actúa la señal de oscurecimiento, porque sin color no hay calidez que medir. Cuando la cámara cambia entre blanco y negro y color, el fondo se forma de nuevo, porque el tono de cada píxel salta de golpe.
- El fondo se forma al abrir el sitio. Si en ese momento ya hay una emisión, queda incorporada al fondo y no se detecta hasta que cambie. En ese caso conviene usar Reiniciar fondo con el cielo despejado. Una emisión que dura muchos minutos se va incorporando al fondo, aunque diez veces más lento que el resto.
- Una nube oscura que pase sobre el cráter, o la sombra de una nube, puede activar la señal de oscurecimiento. Una columna de vapor blanca contra cielo azul puede verse más cálida que el fondo. La máscara permite juzgar cada caso.
- Las medidas de la incandescencia comparten los supuestos de la altura de columna. Además, un píxel equivale a unos 1.85 m en el plano del cráter, así que alto y ancho tienen una resolución de unos 2 m y se muestran redondeados a 5 m. Un punto muy brillante se expande algunos píxeles en el sensor, lo que tiende a sobrestimar alto y ancho. El resplandor reflejado en gases o nubes también puede quedar sobre el umbral y alargar la mancha hacia arriba. Si la mancha toca el borde de la zona de detección, el recuadro lo advierte, porque puede estar recortada.

## Registro automático desde un computador

`scripts/monitor.py` captura un cuadro cada N minutos, lo guarda y le dibuja la escala. Después aplica el mismo detector que el sitio: incandescencia de noche y ceniza de día, según si la imagen viene en blanco y negro u oscura, o en color y luminosa. Sirve para dejar un registro continuo sin tener el navegador abierto.

```bash
pip install pillow
python3 scripts/monitor.py --alias plazatata --intervalo 1 --salida datos
```

Salidas en la carpeta indicada:

- `cuadros/`: cuadros crudos.
- `cuadros_escala/`: cuadros con la escala, la zona del detector activo, la caja de la mancha o la columna y una línea de texto con el resultado.
- `mascaras/`: máscara de detección de cada captura, solo con `--mascaras`.
- `registro.csv`: una fila por captura con el detector usado, los dos índices, los píxeles de cada clase y el tope, alto y ancho de la mancha o la columna. Si existe un `registro.csv` de una versión anterior del script, con otras columnas, se renombra y se empieza uno nuevo.
- `estado_detector.json`: último estado de día o noche y del modo de color de la cámara.
- `fondo_ceniza.bin` y `fondo_ceniza.json`: el fondo de la detección de ceniza. Se guarda en cada captura, así que sobrevive a un reinicio. Si pasaron más de tres constantes de tiempo desde la última captura de día, por ejemplo después de la noche, se forma uno nuevo.

Para la ceniza conviene un intervalo de 1 a 2 minutos. El fondo tiene una constante de tiempo de 10 minutos; con capturas cada 5 minutos o más, el fondo se parece mucho a la captura anterior y la detección responde solo a cambios entre capturas.

Opciones principales:

| Opción | Uso |
|---|---|
| `--detector auto/ceniza/incand` | Elige el detector; `auto` decide según la imagen |
| `--umbral`, `--umbral-brillo` | Alerta y brillo de la incandescencia |
| `--umbral-ceniza`, `--umbral-calidez`, `--umbral-oscuro` | Alerta y criterios de la ceniza |
| `--tau-fondo` | Constante de tiempo del fondo de ceniza, en segundos |
| `--calib X Y0 PX100`, `--roi X Y W H`, `--zona X Y W H` | Calibración, ROI del cráter y zona de columna |
| `--modo hls`, `--snapshot-url`, `--hls-url` | Fuente de imagen; el modo HLS usa ffmpeg |
| `--mascaras`, `--una-vez` | Guardar máscaras; capturar una sola vez |

En un computador común, cada captura toma menos de un segundo de cálculo.

## VIGIA-PlumeNet (opcional)

[VIGIA-PlumeNet](https://gricad-gitlab.univ-grenoble-alpes.fr/giffards/vigia-plumenet) (Giffard-Roisin y colegas, Volcanica, 2026) es un modelo basado en DINOv2 que segmenta imágenes RGB de cámaras de volcanes en seis clases: fondo, columna eruptiva, terreno, emisión de ceniza, emisión sin ceniza y lava. Este repositorio no incluye el modelo ni su código; `scripts/plumenet.py` carga el modelo *traced* que cada usuario descarga desde [Hugging Face](https://huggingface.co/SophieGif/VIGIA-PlumeNet) y aplica el mismo preprocesamiento que el script de evaluación original. También hay un [demo en línea](https://mounts-observatory.org/vigianet/).

```bash
pip install torch numpy pillow
python3 scripts/plumenet.py segmentar --modelo VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt --imagen foto.jpg
python3 scripts/plumenet.py silueta --modelo VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt --imagen foto_despejada.jpg
python3 scripts/monitor.py --alias plazatata --intervalo 1 --plumenet VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt --mascaras
```

En el script de monitoreo, el modelo analiza un recorte del cielo sobre el volcán (`--pn-recorte`) e informa el porcentaje de ceniza y de gas y el tope de cada columna que toca el cráter, en columnas del CSV que empiezan con `pn_`.

Conviene tener presente la resolución. El modelo trabaja en una grilla de 37 × 37 celdas sobre su entrada de 518 × 518 px. Con el cuadro completo, cada celda cubre unos 52 × 29 px de la cámara, unos 95 × 55 m en el plano del cráter; con el recorte por defecto, unos 31 × 18 px. Por eso el modelo sirve para clasificar la emisión, ceniza o gas, más que para medir su borde. Para la silueta, el trazado por color del sitio es más preciso con cielo despejado.

Estado de las pruebas con el modelo real, sobre CPU, de 4 a 9 s por imagen:

- Con las imágenes de ejemplo del repositorio original, la integración reproduce lo esperado. Por ejemplo, en Stromboli marca la columna de ceniza como columna eruptiva y las desgasificaciones blancas como gas.
- Con un cuadro diurno de esta cámara sin emisión, el recorte alrededor del volcán no marcó emisiones. El cuadro completo marcó como gas un 2.6 % de nubes altas.
- Una columna simulada, una franja café translúcida agregada a una foto real, no fue detectada. Esa simulación no tiene la textura de una columna real, así que la prueba no es concluyente.
- Con una emisión real de esta cámara, del amanecer del 12-10-2026, el resultado dependió del encuadre. El cuadro completo dio 1.4 % de ceniza y 9.6 % de gas, con la columna partida entre ambas clases. El recorte amplio por defecto, de x 760 a 1920 y de y 0 a 653, marcó la columna completa como ceniza: 27 % del recorte y nada de gas.
- En esa emisión la columna nace cerca de x = 1000 a 1070 e y = 525, fuera de la ROI del cráter por defecto, así que no se midió su tope hasta mover la ROI. La columna sale por el borde superior del recorte; en ese caso el script informa el tope como cota mínima («sale del recorte»), y lo marca en las columnas `pn_*_sale_del_recorte` del CSV.

En la misma imagen, la columna es más cálida que el cielo vecino, con R − B entre −17 y −6 frente a −32 y −30, y más oscura, con luminancia entre 143 y 159 frente a 179 y 188. Las dos señales del detector de ceniza del sitio tienen la dirección esperada y superan sus umbrales por defecto, con poco margen en la base de la columna. Falta probar ese detector con una secuencia real, porque necesita un fondo formado antes de la emisión.

## Notas técnicas

- Las URLs de IPCamLive usadas son las del reproductor público: `player.php?alias=`, `snapshot.php?alias=` y `getcamerastreamstate.php?alias=`. Esta última devuelve `details.address` y `details.streamid`, con los que se arma `<address>streams/<streamid>/stream.m3u8`. La URL del stream cambia de vez en cuando, por eso se consulta en cada conexión. Si IPCamLive cambia su API, basta con pegar la URL HLS o de snapshot directa en el panel Fuente.
- Si el modo HLS falla, el sitio reintenta tres veces con una URL recién consultada y luego cambia solo a snapshot. La línea de estado muestra el motivo y el servidor que falló.
- Cuando el sitio se abre por https, como en GitHub Pages, las direcciones `http://` del stream se piden por `https://`. El navegador bloquea el contenido `http` dentro de una página `https`.
- El análisis de píxeles exige que el servidor envíe cabeceras CORS. Si no lo hace, el sitio lo indica en la línea de estado y queda disponible la clasificación manual. El script `monitor.py` no tiene esta limitación.
- hls.js está incluido en `vendor/` (licencia Apache 2.0) para no depender de un CDN.
- Los CSV usan punto y coma como separador para abrirse directamente en Excel en configuración regional chilena.
