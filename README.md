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

Atajos de teclado: V ver, M medir, C calibrar, Z recuadro de detección, R marco, F pantalla completa, Supr para borrar la medición y Esc para cerrar el panel lateral o, si está cerrado, borrar la medición.

Detalle de cada modo:

- **Ver**: la imagen no responde al mouse. En modo iframe se pueden usar los controles del reproductor.
- **Medir**: un clic o arrastre sobre la imagen coloca una línea horizontal y muestra la altura sobre la cumbre, redondeada a 5 m en pantalla; el registro guarda el valor en metros. Registrar guarda la hora, el tipo de actividad, la altura, el índice de incandescencia y una nota.
- **Calibrar**: aparecen tres manijas. El punto celeste (0 m) se arrastra hasta la cumbre, el punto verde (500 m) fija la escala y el rectángulo rojo es la región de interés para incandescencia. También se pueden escribir los valores en el panel Calibración.
- **Detección**: muestra u oculta el recuadro de la región de interés, también con la tecla Z. La máscara permite ver qué píxeles cuentan para el índice y ajustar el umbral de brillo. Debajo, un gráfico muestra el índice de las últimas 6 horas con el umbral de alerta; al pasar el mouse se lee la hora local, la hora UTC y el valor de cada muestra. La casilla «registrar» activa el muestreo automático.
- **Tope, alto y ancho de la incandescencia**: el recuadro de detección toma la mancha conectada más grande de la máscara, de al menos 6 píxeles, y la convierte a metros con la calibración. Informa a qué altura sobre la cumbre llega su borde superior y cuánto mide de alto y de ancho. Sobre la imagen se dibuja en cian la caja de la mancha y una cota con el tope. El botón «Medir tope» lleva el marcador de altura a ese borde y deja el tipo de registro en incandescencia, para ajustarlo si hace falta y registrarlo. El registro y las muestras guardan las tres medidas.
- **Detección de ceniza (de día)**: el recuadro cambia solo entre ceniza e incandescencia según la imagen. De día la cámara transmite en color y luminosa; de noche, en blanco y negro u oscura. El selector Auto, Ceniza, Incandescencia del recuadro permite fijar el detector. El método se explica más abajo.
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

## Detección de ceniza

En las imágenes disponibles, tomadas al atardecer, la cámara deja el cielo, las nubes y la nieve con un tono azulado parejo: el canal rojo queda entre 30 y 60 niveles bajo el azul. La ceniza es gris café, más cálida que lo que la rodea. Como el balance de color cambia con la hora y el clima, el sitio no usa un umbral fijo de color, sino que compara cada píxel con su propio pasado.

1. **Zona de columna.** Se analiza un rectángulo sobre el cráter, por defecto desde unos 20 m bajo la cumbre hasta unos 600 m sobre ella, reducido a 300 píxeles de ancho. Se ajusta en modo Calibrar, arrastrando el rectángulo café, o en el panel Calibración.
2. **Fondo adaptativo.** Para cada píxel se mantiene un promedio lento de su tono (R − B) y de su luminancia, con una constante de tiempo de 10 minutos. El terreno, la nieve y el cielo quieto se cancelan.
3. **Dos señales.** Un píxel cuenta como candidato si se volvió más cálido que su fondo, con un aumento de R − B de al menos 12 niveles, o si se oscureció en al menos 25 niveles. A cada diferencia se le resta la mediana de la zona, para que un cambio general de luz no active la detección. En la máscara, café es más cálido y lila es más oscuro.
4. **Columna enraizada en el cráter.** La columna es la mancha conectada más grande que toca la ROI del cráter. Su borde superior da el tope sobre la cumbre, y su extensión, el alto y el ancho.
5. **Índice y alerta.** El índice de ceniza es el porcentaje de píxeles candidatos en la zona. Sobre el umbral, 1 % por defecto, el recuadro marca posible emisión.

Limitaciones que conviene tener presentes:

- El método se probó solo con imágenes simuladas: una columna gris café agregada a una foto real, una nube azulada lejos del cráter y un cambio general de luz. La columna se detectó con su tope a 340 m, y la nube y el cambio de luz no generaron detección. Los umbrales deben ajustarse con imágenes reales de emisiones de esta cámara.
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

## Notas técnicas

- Las URLs de IPCamLive usadas son las del reproductor público: `player.php?alias=`, `snapshot.php?alias=` y `getcamerastreamstate.php?alias=`. Esta última devuelve `details.address` y `details.streamid`, con los que se arma `<address>streams/<streamid>/stream.m3u8`. La URL del stream cambia de vez en cuando, por eso se consulta en cada conexión. Si IPCamLive cambia su API, basta con pegar la URL HLS o de snapshot directa en el panel Fuente.
- Si el modo HLS falla, el sitio reintenta tres veces con una URL recién consultada y luego cambia solo a snapshot. La línea de estado muestra el motivo y el servidor que falló.
- Cuando el sitio se abre por https, como en GitHub Pages, las direcciones `http://` del stream se piden por `https://`. El navegador bloquea el contenido `http` dentro de una página `https`.
- El análisis de píxeles exige que el servidor envíe cabeceras CORS. Si no lo hace, el sitio lo indica en la línea de estado y queda disponible la clasificación manual. El script `monitor.py` no tiene esta limitación.
- hls.js está incluido en `vendor/` (licencia Apache 2.0) para no depender de un CDN.
- Los CSV usan punto y coma como separador para abrirse directamente en Excel en configuración regional chilena.
