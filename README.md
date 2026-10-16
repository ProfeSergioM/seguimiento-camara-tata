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
- **Capas**: menú con las casillas de lo que se dibuja sobre la imagen: recuadro de detección (Z), marco de la región de interés (R), silueta (S) y máscara de VIGIA-PlumeNet.
- **⛶**: pantalla completa. En ese modo la barra se oculta tras unos segundos sin mover el mouse.
- **☰**: abre el panel lateral con la fuente, la detección, VIGIA-PlumeNet, la calibración y el registro. La sección Detección muestra lo esencial: registrar, el intervalo, los dos umbrales de alerta y los botones de exportar. Los criterios finos, el realce nocturno y el brillo y contraste de la vista quedan en «Ajustes avanzados».
- **Relojes**: hora local de Chile y hora UTC.

Atajos de teclado: V ver, M medir, C calibrar, Z recuadro de detección, R marco, S silueta, F pantalla completa, Supr para borrar la medición y Esc para cerrar el panel lateral o, si está cerrado, borrar la medición.

Detalle de cada modo:

- **Ver**: la imagen no responde al mouse. En modo iframe se pueden usar los controles del reproductor.
- **Medir**: un clic o arrastre sobre la imagen coloca una línea horizontal y muestra la altura sobre la cumbre, redondeada a 5 m en pantalla; el registro guarda el valor en metros. Registrar guarda la hora, el tipo de actividad, la altura, el índice de incandescencia y una nota.
- **Calibrar**: aparecen tres manijas. El punto celeste (0 m) se arrastra hasta la cumbre, el punto verde (500 m) fija la escala y el rectángulo rojo es la región de interés para incandescencia. También se pueden escribir los valores en el panel Calibración.
- **Detección**: muestra u oculta el recuadro de la región de interés, también con la tecla Z. La máscara permite ver qué píxeles cuentan para el índice y ajustar el umbral de brillo. Debajo, un gráfico muestra el índice de las últimas 6 horas con el umbral de alerta; al pasar el mouse se lee la hora local, la hora UTC y el valor de cada muestra. La casilla «registrar» activa el muestreo automático.
- **Tope, alto y ancho de la incandescencia**: el recuadro de detección toma la mancha conectada más grande de la máscara, de al menos 6 píxeles, y la convierte a metros con la calibración. Informa a qué altura sobre la cumbre llega su borde superior y cuánto mide de alto y de ancho. Sobre la imagen se dibuja en cian la caja de la mancha y una cota con el tope. El botón «Medir tope» lleva el marcador de altura a ese borde y deja el tipo de registro en incandescencia, para ajustarlo si hace falta y registrarlo. El registro y las muestras guardan las tres medidas.
- **Medida fija**: bajo el título, arriba a la izquierda, se muestran el tope, el alto y el ancho de la columna o de la mancha incandescente, y el último resultado de VIGIA-PlumeNet si está activo. El texto queda fijo para leerlo con facilidad; sobre la imagen solo se dibujan la caja y la cota.
- **Gráfico del recuadro**: el selector Índice, Altura cambia entre el índice del detector activo, en %, y el tope de la columna o de la mancha incandescente, en metros sobre el cráter.
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

## Detección de ceniza y vapor

En las imágenes disponibles, tomadas al atardecer, la cámara deja el cielo, las nubes y la nieve con un tono azulado parejo: el canal rojo queda entre 30 y 60 niveles bajo el azul. La ceniza es gris café, más cálida que lo que la rodea. Como el balance de color cambia con la hora y el clima, el sitio no usa un umbral fijo de color, sino que compara cada píxel con su propio pasado.

1. **Zona de columna.** Se analiza un rectángulo sobre el cráter, por defecto desde unos 60 m bajo la cresta hasta el borde superior de la imagen, unos 970 m sobre ella, y de x = 700 a 1900. Se reduce a 300 píxeles de ancho, de modo que cada píxel de la máscara cubre unos 4 px de la cámara, unos 7 m. Se ajusta en modo Calibrar, arrastrando el rectángulo café, o en el panel Calibración.
2. **Fondo adaptativo.** Para cada píxel se mantiene un promedio lento de su tono (R − B) y de su luminancia, con una constante de tiempo de 10 minutos. El terreno, la nieve y el cielo quieto se cancelan.
3. **Cambio respecto del fondo.** Un píxel cambió si se volvió más cálido que su fondo, con un aumento de R − B de al menos 12 niveles, si se aclaró en al menos 24 niveles, o si se oscureció en al menos 25 niveles sin volverse más azul. A cada diferencia se le resta la mediana de la zona, para que un cambio general de luz no active la detección. Un oscurecimiento que además azulea corresponde a cielo que se despeja tras una nube que había quedado en el fondo, y no se cuenta.
4. **Ceniza o vapor.** Cada píxel que cambió se clasifica según el color propio de lo que apareció delante del fondo (ver abajo). En la máscara, ocre es ceniza y celeste es vapor.
5. **Columnas enraizadas en el cráter.** Para cada clase, la columna es la mancha conectada más grande que toca la ROI del cráter. Su borde superior da el tope sobre la cumbre, y su extensión, el alto y el ancho. La medida fija muestra una línea para la ceniza y otra para el vapor.
6. **Índices y alerta.** El índice de ceniza y el índice de vapor son el porcentaje de píxeles de cada clase en la zona. La alerta usa solo el índice de ceniza: sobre el umbral, 5 % por defecto, el recuadro marca posible emisión.

### Cómo se separa la ceniza del vapor

Una nube translúcida de opacidad α sobre el cielo deja en cada píxel una mezcla: fondo + α · (color de la nube − fondo). El cambio respecto del fondo apunta, entonces, desde el color del cielo hacia el color propio de la nube, y la opacidad solo decide cuánto se avanza en esa dirección. Por eso el detector prolonga el cambio de cada píxel hasta la luminancia de una nube iluminada, 230 en una escala de 0 a 255, y mira qué calidez R − B tendría allí. Si queda bajo 80, el píxel cuenta como vapor; si queda sobre 80, o si el píxel se oscureció, cuenta como ceniza. El vapor es blanco, o apenas dorado con el sol bajo, y la ceniza es parda o gris oscura.

Este criterio reemplaza a uno anterior que comparaba la calidez con el aclaramiento mediante una razón fija. Esa razón funcionaba contra cielo azul profundo, pero cerca del horizonte el cielo ya es claro, de modo que el borde translúcido de una columna de vapor aclara poco y la razón lo hacía pasar por ceniza. Al prolongar el cambio hasta una misma luminancia de referencia, el umbral se adapta solo a lo claro que sea el cielo detrás de cada píxel.

Los dos valores se ajustan en `config.js` (`calidezNube`, `luzNube`), en «Ajustes avanzados» del sitio (la calidez) y en el script de monitoreo (`--calidez-nube`, `--luz-nube`).

### Evaluación con secuencias reales

Se comparó el detector con VIGIA-PlumeNet, que separa ceniza y gas, en dos secuencias de esta cámara, procesadas con la hora real de cada cuadro:

| Episodio | Ceniza y vapor del detector | VIGIA-PlumeNet |
|---|---|---|
| 12-10-2026, 07:14 a 07:17, pulso pardo al amanecer | ceniza 6 a 35 %, vapor 1 % o menos | ceniza 3 a 20 %, gas 0 % |
| 12-10, 07:40 a 07:42, columna blanca | ceniza 13 a 15 %, vapor 23 a 28 % | ceniza 0 a 3 %, gas 20 a 23 % |
| 12-10, 07:47 a 07:56, cielo con nubes doradas tras la cresta | ceniza 1 a 4 %, vapor 7 a 11 % | ceniza 0 %, gas bajo 1 % |
| 12-10, 07:59 a 08:00, columna blanca | ceniza 11 a 13 %, vapor 23 a 29 % | gas 16 a 17 % |
| 12-10, 08:23 a 08:33, columna de vapor | ceniza 1 a 4 %, vapor 26 a 37 % | ceniza 0 a 3 %, gas 0 a 6 % |
| 16-10, 07:48 a 07:57, emisión de vapor en vivo | ceniza 3 a 5 %, vapor 7 a 19 % | ceniza 0 %, gas 0 a 4 % |

Con el criterio anterior, la emisión del 16-10 daba hasta 27 % de ceniza, la mayor parte por cielo que se despejaba, y el período de 07:47 a 07:57 del 12-10 daba entre 6 y 8 % de ceniza, sobre el umbral de alerta. Los porcentajes del detector son mayores que los del modelo porque también cuentan el borde tenue de la nube, que el modelo deja como fondo. Las secuencias no están en el repositorio.

Limitaciones que conviene tener presentes:

- El ajuste se hizo con dos amaneceres de una sola cámara, usando VIGIA-PlumeNet como referencia, y el modelo también puede equivocarse. Entre 08:02 y 08:15 del 12-10 el detector mantiene entre 7 y 15 % de ceniza, mientras el modelo ve ceniza solo en algunos cuadros y bajo 6 %. A las 07:18 y 07:20 el modelo pasa a llamar gas a la nube del pulso, ya dispersa y teñida de amarillo por el sol, mientras el detector la sigue contando como ceniza. Ambos casos necesitan el juicio de quien observa.
- Con el sol bajo, el borde iluminado de cualquier nube se tiñe de dorado y puede pasar por ceniza. Una nube meteorológica que entra a la zona se detecta igual que una emisión; la conexión con el cráter, en la medida de la columna, ayuda a separarlas.
- Con la cámara en blanco y negro de día no hay calidez que medir: el aclaramiento cuenta como vapor y el oscurecimiento como ceniza. Cuando la cámara cambia entre blanco y negro y color, el fondo se forma de nuevo, porque el tono de cada píxel salta de golpe.
- El fondo se forma al abrir el sitio. Si en ese momento ya hay una emisión, queda incorporada al fondo y no se detecta hasta que cambie. En ese caso conviene usar Reiniciar fondo con el cielo despejado. Una emisión que dura muchos minutos se va incorporando al fondo, aunque diez veces más lento que el resto.
- Una nube oscura que pase sobre el cráter, o la sombra de una nube, puede activar la señal de oscurecimiento. La máscara permite juzgar cada caso.
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
- `registro.csv`: una fila por captura con el detector usado, el índice de incandescencia, los índices de ceniza y de vapor, los píxeles de cada clase, el tope, alto y ancho de la mancha o la columna de ceniza y el tope de la columna de vapor. Si existe un `registro.csv` de una versión anterior del script, con otras columnas, se renombra y se empieza uno nuevo.
- `estado_detector.json`: último estado de día o noche y del modo de color de la cámara.
- `fondo_ceniza.bin` y `fondo_ceniza.json`: el fondo de la detección de ceniza. Se guarda en cada captura, así que sobrevive a un reinicio. Si pasaron más de tres constantes de tiempo desde la última captura de día, por ejemplo después de la noche, se forma uno nuevo.

Para la ceniza conviene un intervalo de 1 a 2 minutos. El fondo tiene una constante de tiempo de 10 minutos; con capturas cada 5 minutos o más, el fondo se parece mucho a la captura anterior y la detección responde solo a cambios entre capturas.

Opciones principales:

| Opción | Uso |
|---|---|
| `--detector auto/ceniza/incand` | Elige el detector; `auto` decide según la imagen |
| `--umbral`, `--umbral-brillo` | Alerta y brillo de la incandescencia |
| `--umbral-ceniza`, `--umbral-calidez`, `--umbral-oscuro` | Alerta y criterios de la ceniza |
| `--calidez-nube`, `--luz-nube` | Separación entre ceniza y vapor |
| `--tau-fondo` | Constante de tiempo del fondo de ceniza, en segundos |
| `--calib X Y0 PX100`, `--roi X Y W H`, `--zona X Y W H` | Calibración, ROI del cráter y zona de columna |
| `--modo hls`, `--snapshot-url`, `--hls-url` | Fuente de imagen; el modo HLS usa ffmpeg |
| `--mascaras`, `--una-vez` | Guardar máscaras; capturar una sola vez |

En un computador común, cada captura toma menos de un segundo de cálculo.

## VIGIA-PlumeNet en el sitio

El sitio puede ejecutar VIGIA-PlumeNet en el navegador del PC donde está abierto. El modelo, convertido a ONNX sin cambios en los pesos, está en `modelos/` (ver `modelos/LEEME.md`), y corre en un proceso aparte con [ONNX Runtime Web](https://onnxruntime.ai/) 1.20.1, que se descarga desde jsDelivr. Usa WebGPU si el navegador lo tiene; si no, WebAssembly.

1. Abra el panel ☰ y la sección VIGIA-PlumeNet.
2. Pulse «Cargar modelo del sitio» para descargarlo, 89 MB, una sola vez. En el `tata.html` local, que no puede descargarlo, use «Cargar archivo .onnx» con una copia de `modelos/vigia_plumenet_fp32.onnx`. El modelo queda guardado en el navegador y se inicia solo al abrir el sitio.
3. Marque «Analizar automáticamente». Por defecto analiza cada 30 s, solo de día, el recorte del cielo sobre el volcán.

El recuadro de detección muestra el porcentaje de ceniza y de gas, y el tope de la columna que toca el cráter, como cota mínima si sale del recorte. Sobre la imagen se superpone la máscara del modelo: naranjo columna eruptiva, café ceniza, celeste gas y rojo lava. Las muestras, el registro y los CSV incluyen estos resultados en columnas `pn_`.

En un navegador sin tarjeta gráfica, un análisis tomó 8.8 s con WebAssembly. Sobre la emisión real del 12-10-2026 dio 26.6 % de ceniza, frente a 27.3 % del mismo modelo en Python; la diferencia viene de cómo cada uno reduce la imagen a 518 × 518 px.

## VIGIA-PlumeNet en Python (opcional)

[VIGIA-PlumeNet](https://gricad-gitlab.univ-grenoble-alpes.fr/giffards/vigia-plumenet) (Giffard-Roisin y colegas, Volcanica, 2026) es un modelo basado en DINOv2 que segmenta imágenes RGB de cámaras de volcanes en seis clases: fondo, columna eruptiva, terreno, emisión de ceniza, emisión sin ceniza y lava. `scripts/plumenet.py` no incluye código del repositorio original; carga el modelo *traced* que cada usuario descarga desde [Hugging Face](https://huggingface.co/SophieGif/VIGIA-PlumeNet) y aplica el mismo preprocesamiento que el script de evaluación original. También hay un [demo en línea](https://mounts-observatory.org/vigianet/).

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
- Con una secuencia real grabada del 12-10-2026, una foto cada 20 s desde las 07:04, el detector por color del sitio marcó el inicio de la emisión a las 07:13:42, con 7.6 % de índice y tope de 235 m, y la siguió hasta 28 % y 970 m a las 07:15:50, cuando la columna llegó al borde superior de la imagen. Entre 07:07 y 07:13 marcó entre 1.3 y 3.3 %, con «columnas» de 55 a 105 m. Coinciden con nubes bajas sobre la cumbre teñidas de rosado por el amanecer, aunque también podrían ser gas residual. Con un umbral de 1 %, esa etapa activaba la alerta. Por eso el umbral por defecto pasó a 5 %, que en esta secuencia separa esa etapa del inicio de la emisión. Es un ajuste basado en una sola secuencia y conviene revisarlo con más eventos.
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
