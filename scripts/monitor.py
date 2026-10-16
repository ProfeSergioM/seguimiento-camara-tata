#!/usr/bin/env python3
"""Registro automático de la cámara Plaza Tata (Nevados de Chillán).

Cada N minutos captura un cuadro de la cámara (snapshot JPG de IPCamLive o
un cuadro del stream HLS con ffmpeg), lo guarda y le dibuja la escala de
altura calibrada. Luego aplica el detector que corresponde a la imagen:

  - De noche (imagen en blanco y negro u oscura): índice de incandescencia
    en la ROI del cráter y medidas de la mancha principal.
  - De día (imagen en color y luminosa): índice de ceniza en la zona de
    columna, comparando cada píxel con su propio fondo, y medidas de la
    columna que nace en el cráter.

Es el mismo método que usa el sitio. El fondo de la detección de ceniza se
guarda en la carpeta de salida, así que sobrevive a un reinicio del
script. Los resultados se acumulan en un CSV.

Con --plumenet MODELO.pt se agrega la segmentación de VIGIA-PlumeNet
(ver scripts/plumenet.py) sobre un recorte alrededor del volcán: clasifica
cada zona en columna eruptiva, ceniza, gas, terreno, lava o fondo, y se
informan el porcentaje de ceniza y de gas y el tope de cada columna que
toca el cráter. Requiere torch y numpy.

Requisitos: Python 3.8+, Pillow (pip install pillow). Para el modo HLS se
necesita ffmpeg en el PATH.

Ejemplos:
    python3 scripts/monitor.py --alias plazatata --intervalo 5
    python3 scripts/monitor.py --alias plazatata --intervalo 1 --mascaras
    python3 scripts/monitor.py --alias plazatata --modo hls --intervalo 2 --salida datos
    python3 scripts/monitor.py --snapshot-url https://.../snapshot.jpg --una-vez
    python3 scripts/monitor.py --alias plazatata --intervalo 1 --plumenet VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt
"""
import argparse
import array
import csv
import math
import datetime as dt
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Falta Pillow: pip install pillow")

try:
    from zoneinfo import ZoneInfo
    ZONA = ZoneInfo("America/Santiago")
except Exception:  # pragma: no cover
    ZONA = None

# Calibración preliminar en píxeles del cuadro nativo (1920 × 1080 px).
REF_W = 1920
# El 0 m está en la cresta donde nacen las emisiones (ver README).
CALIB = {"x": 1030, "y0": 526, "px_por_100m": 54.1, "altura_max": 800}
ROI = {"x": 900, "y": 490, "w": 200, "h": 85}
ZONA_COLUMNA = {"x": 700, "y": 0, "w": 1200, "h": 560}
# Recorte para VIGIA-PlumeNet. El modelo trabaja en una grilla de 37 × 37
# celdas sobre su entrada de 518 × 518 px; con el cuadro completo cada celda
# cubre unos 52 × 29 px de la cámara. Con la emisión real del 12-10-2026 el
# cuadro completo mezcló ceniza y gas, mientras que este recorte, que cubre
# el cielo sobre el volcán y hacia la derecha, marcó la columna completa como
# ceniza (unos 31 × 18 px por celda). Si el viento lleva la columna hacia la
# izquierda, conviene ajustarlo con --pn-recorte.
RECORTE_PN = {"x": 760, "y": 0, "w": 1160, "h": 653}
UMBRAL_BRILLO = 200
ANCHO_CENIZA = 300          # ancho de la zona de columna reducida, en píxeles
# Día o noche según la luminosidad del cielo (40 % superior del cuadro), no
# según el color: la cámara tarda en pasar de blanco y negro a color al
# amanecer, y al revés al atardecer. Con margen entre los umbrales de
# entrada y salida, para que no alterne en el crepúsculo.
LUM_CIELO_DIA, MARGEN_DIA, COLOR_MIN = 70.0, 8.0, 4.0
COLORES = {
    "incand": {1: (255, 212, 0), 2: (0, 229, 255)},     # rojizo, brillante
    "ceniza": {1: (214, 140, 60), 2: (170, 225, 255)},  # ceniza, vapor
}
UA = "Mozilla/5.0 (seguimiento-camara-tata)"


def ahora():
    return dt.datetime.now(ZONA) if ZONA else dt.datetime.now()


def descargar(url, destino):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r, open(destino, "wb") as f:
        f.write(r.read())


def url_hls(alias):
    """Consulta a IPCamLive la URL vigente del stream HLS para un alias.

    details.address viene con esquema y barra final, por ejemplo
    "https://s58.ipcamlive.com/". El stream se activa a pedido, así que se
    reintenta unos segundos si todavía no hay streamid.
    """
    u = "https://ipcamlive.com/player/getcamerastreamstate.php?alias=" + alias
    for _ in range(3):
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode("utf-8"))
        d = j.get("details", j)
        addr = d.get("address") or ""
        sid = d.get("streamid") or ""
        if addr and sid:
            if not addr.lower().startswith(("http://", "https://")):
                addr = "https://" + addr
            if not addr.endswith("/"):
                addr += "/"
            return f"{addr}streams/{sid}/stream.m3u8"
        time.sleep(3)
    raise RuntimeError("IPCamLive no entregó un stream activo; use --hls-url")


def cuadro_hls(url, destino):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", url, "-frames:v", "1", "-q:v", "2", str(destino)],
                   check=True, timeout=90)


def fuente(tam):
    for ruta in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf", "arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(ruta, tam)
        except OSError:
            continue
    return ImageFont.load_default()


def mancha_mayor(mascara, w, h, minimo=6, caja=None):
    """Mancha conectada más grande (vecindad de 8) en una máscara plana.

    Devuelve (n, top, bot, izq, der) en píxeles de la máscara, o None si la
    mancha más grande tiene menos de `minimo` píxeles. Si se indica una
    caja (x0, y0, x1, y1), solo cuentan las manchas que la tocan: una
    columna de ceniza debe nacer en el cráter.
    """
    visto = bytearray(len(mascara))
    mejor = None
    for p0, v in enumerate(mascara):
        if not v or visto[p0]:
            continue
        pila = [p0]
        visto[p0] = 1
        n, top, bot, izq, der = 0, h, -1, w, -1
        toca = caja is None
        while pila:
            p = pila.pop()
            y, x = divmod(p, w)
            n += 1
            top, bot, izq, der = min(top, y), max(bot, y), min(izq, x), max(der, x)
            if not toca and caja[0] <= x <= caja[2] and caja[1] <= y <= caja[3]:
                toca = True
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h:
                        q = yy * w + xx
                        if mascara[q] and not visto[q]:
                            visto[q] = 1
                            pila.append(q)
        if toca and (mejor is None or n > mejor[0]):
            mejor = (n, top, bot, izq, der)
    return mejor if mejor and mejor[0] >= minimo else None


def medir_en_metros(m, ox, oy, sx, sy, f, wm, hm):
    """Convierte una mancha de la máscara a metros con la calibración.

    (ox, oy) es la esquina de la zona en el cuadro y (sx, sy) el tamaño de
    un píxel de la máscara en píxeles del cuadro. En el plano del cráter un
    píxel cubre la misma distancia en horizontal y en vertical.
    """
    n, top, bot, izq, der = m
    m_por_px = 100.0 / CALIB["px_por_100m"]
    top_ref = (oy + top * sy) / f
    bot_ref = (oy + (bot + 1) * sy) / f
    izq_ref = (ox + izq * sx) / f
    der_ref = (ox + (der + 1) * sx) / f
    return {
        "px": n, "top_ref": top_ref, "bot_ref": bot_ref, "izq_ref": izq_ref, "der_ref": der_ref,
        "tope_m": (CALIB["y0"] - top_ref) * m_por_px,
        "alto_m": (bot_ref - top_ref) * m_por_px,
        "ancho_m": (der_ref - izq_ref) * m_por_px,
        "recortada": top == 0 or izq == 0 or bot == hm - 1 or der == wm - 1,
        # Solo si toca el borde superior el tope real puede estar más arriba.
        "corte_arriba": top == 0,
    }


def rgb(img):
    """Píxeles (R, G, B) de una imagen RGB. Se lee de tobytes() porque
    getdata() quedará obsoleto en Pillow 14."""
    b = img.tobytes()
    return zip(b[0::3], b[1::3], b[2::3])


def caracterizar(im):
    """Luminancia media, colorido y luminosidad del cielo (40 % superior)
    sobre una copia reducida. El colorido es casi cero cuando la cámara
    transmite en blanco y negro."""
    alto = max(1, int(160 * im.height / im.width))
    mini = im.resize((160, alto))
    fin_cielo = int(0.4 * alto) * 160
    lum, color, cielo, n = 0.0, 0.0, 0.0, 0
    for R, G, B in rgb(mini):
        L = 0.299 * R + 0.587 * G + 0.114 * B
        lum += L
        if n < fin_cielo:
            cielo += L
        color += (abs(R - G) + abs(G - B) + abs(B - R)) / 3.0
        n += 1
    return lum / n, color / n, cielo / max(1, fin_cielo)


def es_de_dia(lum_cielo, dia_previo):
    umbral = LUM_CIELO_DIA - MARGEN_DIA if dia_previo else LUM_CIELO_DIA + MARGEN_DIA
    return lum_cielo >= umbral


def indice_incandescencia(im, f):
    """Índice (%% de píxeles rojizos o brillantes en la ROI del cráter),
    luminancia media de la ROI, máscara y medidas de la mancha principal."""
    x, y = int(ROI["x"] * f), int(ROI["y"] * f)
    w, h = int(ROI["w"] * f), int(ROI["h"] * f)
    roi = im.crop((x, y, x + w, y + h)).convert("RGB")
    mascara = bytearray(roi.width * roi.height)
    calientes, lum = 0, 0.0
    for p, (R, G, B) in enumerate(rgb(roi)):
        L = 0.299 * R + 0.587 * G + 0.114 * B
        lum += L
        # 1 rojizo (solo en color); 2 brillante (lo que cuenta de noche,
        # cuando la cámara transmite en blanco y negro).
        if R >= 140 and R > G * 1.25 and R > B * 1.6:
            mascara[p] = 1
        elif L >= UMBRAL_BRILLO:
            mascara[p] = 2
        if mascara[p]:
            calientes += 1
    n = roi.width * roi.height
    m = mancha_mayor(mascara, roi.width, roi.height)
    medidas = medir_en_metros(m, x, y, 1, 1, f, roi.width, roi.height) if m else None
    return {"indice": 100.0 * calientes / n, "lum_roi": lum / n, "mascara": mascara, "zona": roi,
            "w": roi.width, "h": roi.height, "medidas": medidas}


class FondoCeniza:
    """Fondo adaptativo de la zona de columna: para cada píxel, un promedio
    lento de su tono (R − B) y de su luminancia. Se guarda en disco para
    sobrevivir a un reinicio. Si pasó mucho tiempo desde la última
    actualización, se vuelve a formar."""

    def __init__(self, carpeta, tau):
        self.bin = pathlib.Path(carpeta) / "fondo_ceniza.bin"
        self.meta = pathlib.Path(carpeta) / "fondo_ceniza.json"
        self.tau = tau
        self.clave, self.rb, self.l, self.t, self.t0 = None, None, None, 0.0, 0.0
        try:
            meta = json.loads(self.meta.read_text(encoding="utf-8"))
            datos = array.array("f")
            with open(self.bin, "rb") as fh:
                datos.fromfile(fh, 2 * meta["n"])
            self.clave, self.t, self.t0 = meta["clave"], meta["t"], meta["t0"]
            self.rb, self.l = datos[:meta["n"]], datos[meta["n"]:]
        except (OSError, ValueError, KeyError, EOFError):
            pass

    def guardar(self):
        n = len(self.rb)
        with open(self.bin, "wb") as fh:
            (self.rb + self.l).tofile(fh)
        self.meta.write_text(json.dumps({"clave": self.clave, "t": self.t, "t0": self.t0, "n": n}), encoding="utf-8")


def mediana(valores):
    paso = max(1, len(valores) // 4000)
    m = sorted(valores[::paso])
    return m[len(m) // 2]


def calidez_propia(rb, L, d_rb, d_l, luz_nube):
    """Calidez (R − B) que tendría la nube del píxel con luminancia luz_nube,
    prolongando el cambio respecto del fondo (d_rb, d_l, con d_l > 0)."""
    if L >= luz_nube:
        return rb
    return rb + d_rb * (luz_nube - L) / d_l


def indice_ceniza(im, f, fondo, umbral_calidez, umbral_oscuro, t_unix, calidez_nube=80.0, luz_nube=230.0):
    """Índice de ceniza (%% de píxeles de la zona de columna que se volvieron
    más cálidos o más oscuros que su fondo), máscara y medidas de la
    columna conectada al cráter.

    A cada diferencia se le resta la mediana de la zona, para que un cambio
    general de luz o de balance de color no active la detección. Los
    píxeles detectados actualizan su fondo diez veces más lento, para que
    una emisión sostenida no se absorba de inmediato.
    """
    zx, zy = int(ZONA_COLUMNA["x"] * f), int(ZONA_COLUMNA["y"] * f)
    zw = min(im.width - zx, int(ZONA_COLUMNA["w"] * f))
    zh = min(im.height - zy, int(ZONA_COLUMNA["h"] * f))
    wm = min(ANCHO_CENIZA, zw)
    hm = max(1, round(zh * wm / zw))
    zona = im.crop((zx, zy, zx + zw, zy + zh)).resize((wm, hm), Image.BOX)
    rb = array.array("f")
    l = array.array("f")
    for R, G, B in rgb(zona):
        rb.append(R - B)
        l.append(0.299 * R + 0.587 * G + 0.114 * B)
    n = wm * hm
    clave = f"{zx},{zy},{zw},{zh},{wm},{hm}"
    res = {"indice": 0.0, "indice_vapor": 0.0, "ceniza": 0, "vapor": 0, "mascara": bytearray(n), "zona": zona, "w": wm, "h": hm,
           "medidas": None, "medidas_vapor": None, "edad_fondo_s": 0.0, "fondo_nuevo": False}
    if fondo.clave != clave or fondo.rb is None or t_unix - fondo.t > 3 * fondo.tau:
        fondo.clave, fondo.rb, fondo.l, fondo.t, fondo.t0 = clave, rb, l, t_unix, t_unix
        fondo.guardar()
        res["fondo_nuevo"] = True
        return res
    drb = [rb[p] - fondo.rb[p] for p in range(n)]
    dl = [l[p] - fondo.l[p] for p in range(n)]
    m_rb, m_l = mediana(drb), mediana(dl)
    # Clases: 1 ceniza, 2 vapor. Un píxel con una nube translúcida es una
    # mezcla entre el fondo y el color propio de la nube, así que el cambio
    # apunta desde el fondo hacia ese color. Se prolonga ese cambio hasta la
    # luminancia de una nube iluminada (luz_nube) y se mira qué calidez
    # (R − B) tendría allí: el vapor es blanco o apenas dorado, la ceniza es
    # parda. Así el criterio no depende de la opacidad ni de cuán claro sea
    # el cielo detrás (ver README, «Ceniza y vapor»). Un oscurecimiento que
    # además azulea es cielo que se despeja tras una nube, no ceniza.
    mascara = res["mascara"]
    ceniza = vapor = 0
    for p in range(n):
        L, d_l, d_rb = l[p], dl[p] - m_l, drb[p] - m_rb
        if not ((L >= 35 and d_rb >= umbral_calidez) or (L >= 35 and d_l >= 2 * umbral_calidez) or (L >= 15 and d_l <= -umbral_oscuro and d_rb > -umbral_calidez / 2)):
            continue
        if d_l > 0 and calidez_propia(rb[p], L, d_rb, d_l, luz_nube) < calidez_nube:
            mascara[p] = 2
            vapor += 1
        else:
            mascara[p] = 1
            ceniza += 1
    a = 1 - math.exp(-max(0.0, t_unix - fondo.t) / fondo.tau)
    a2 = a / 10
    for p in range(n):
        k = a2 if mascara[p] else a
        fondo.rb[p] += k * (rb[p] - fondo.rb[p])
        fondo.l[p] += k * (l[p] - fondo.l[p])
    fondo.t = t_unix
    fondo.guardar()
    # Caja del cráter (la ROI de incandescencia) en píxeles de la máscara.
    sx, sy = zw / wm, zh / hm
    caja = ((ROI["x"] * f - zx) / sx, (ROI["y"] * f - zy) / sy,
            ((ROI["x"] + ROI["w"]) * f - zx) / sx, ((ROI["y"] + ROI["h"]) * f - zy) / sy)
    mc = mancha_mayor(bytearray(1 if v == 1 else 0 for v in mascara), wm, hm, caja=caja)
    mv = mancha_mayor(bytearray(1 if v == 2 else 0 for v in mascara), wm, hm, caja=caja)
    res.update(indice=100.0 * ceniza / n, indice_vapor=100.0 * vapor / n, ceniza=ceniza, vapor=vapor,
               edad_fondo_s=t_unix - fondo.t0,
               medidas=medir_en_metros(mc, zx, zy, sx, sy, f, wm, hm) if mc else None,
               medidas_vapor=medir_en_metros(mv, zx, zy, sx, sy, f, wm, hm) if mv else None)
    return res


def imagen_mascara(res, modo, escala):
    """Máscara en color sobre la zona en gris atenuado, ampliada."""
    out = Image.new("RGB", (res["w"], res["h"]))
    col = COLORES[modo]
    pix = []
    for c, (R, G, B) in zip(res["mascara"], rgb(res["zona"])):
        if c:
            pix.append(col[c])
        else:
            g = int(0.4 * (0.299 * R + 0.587 * G + 0.114 * B))
            pix.append((g, g, g))
    out.putdata(pix)
    return out.resize((res["w"] * escala, res["h"] * escala), Image.NEAREST)


def anotar(im, f, texto, modo, medidas):
    d = ImageDraw.Draw(im)
    fn = fuente(max(12, int(16 * f)))
    fn_chica = fuente(max(11, int(13 * f)))
    x = CALIB["x"] * f
    y_de = lambda h: (CALIB["y0"] - h / 100.0 * CALIB["px_por_100m"]) * f
    y0, ytop = y_de(0), y_de(CALIB["altura_max"])
    d.line([(x, y0), (x, ytop)], fill=(0, 0, 0), width=max(2, int(3 * f)))
    d.line([(x, y0), (x, ytop)], fill=(235, 235, 235), width=max(1, int(1.2 * f)))
    h = 0
    while h <= CALIB["altura_max"]:
        y = y_de(h)
        d.line([(x - 7 * f, y), (x + 7 * f, y)], fill=(235, 235, 235), width=max(1, int(1.2 * f)))
        d.text((x + 11 * f, y), str(h), fill=(235, 235, 235), font=fn_chica, anchor="lm",
               stroke_width=max(1, int(2 * f)), stroke_fill=(0, 0, 0))
        h += 100
    if modo == "ceniza":
        z = ZONA_COLUMNA
        d.rectangle([z["x"] * f, z["y"] * f, (z["x"] + z["w"]) * f, (z["y"] + z["h"]) * f], outline=(232, 170, 90), width=1)
    else:
        d.rectangle([ROI["x"] * f, ROI["y"] * f, (ROI["x"] + ROI["w"]) * f, (ROI["y"] + ROI["h"]) * f], outline=(229, 83, 61), width=1)
    if medidas:
        color = (232, 170, 90) if modo == "ceniza" else (0, 229, 255)
        caja = [medidas["izq_ref"] * f, medidas["top_ref"] * f, medidas["der_ref"] * f, medidas["bot_ref"] * f]
        d.rectangle(caja, outline=color, width=max(1, int(1.2 * f)))
        etiqueta = ("columna " if modo == "ceniza" else "tope ") + f"{medidas['tope_m']:.0f} m"
        d.text((caja[2] + 8 * f, caja[1]), etiqueta, fill=color, font=fn_chica, anchor="lm",
               stroke_width=max(1, int(2 * f)), stroke_fill=(0, 0, 0))
    d.text((12 * f, im.height - 16 * f), texto, fill=(255, 255, 255), font=fn, anchor="lm",
           stroke_width=max(1, int(2 * f)), stroke_fill=(0, 0, 0))
    return im


CABECERA = ["fecha_hora_local", "archivo", "ancho", "alto", "lum_cuadro", "lum_cielo", "colorido", "detector",
            "indice_incand_pct", "lum_roi", "incandescencia", "tope_incand_m", "alto_incand_m", "ancho_incand_m",
            "indice_ceniza_pct", "indice_vapor_pct", "px_ceniza", "px_vapor", "posible_emision", "edad_fondo_min",
            "tope_columna_m", "alto_columna_m", "ancho_columna_m", "tope_vapor_m",
            "pn_ceniza_pct", "pn_gas_pct", "pn_tope_ceniza_m", "pn_tope_gas_m", "pn_confianza_media",
            "pn_ceniza_sale_del_recorte", "pn_gas_sale_del_recorte"]


def analizar_plumenet(modelo, im, f):
    """Segmenta el recorte alrededor del volcán con VIGIA-PlumeNet. Devuelve
    porcentajes de ceniza (columna eruptiva más emisión de ceniza) y de gas
    en el recorte, y el tope de cada columna que toca la ROI del cráter.
    Como la grilla del modelo es gruesa, la ROI se amplía en una celda."""
    import plumenet as pn
    rx, ry = int(RECORTE_PN["x"] * f), int(RECORTE_PN["y"] * f)
    rw = min(im.width - rx, int(RECORTE_PN["w"] * f))
    rh = min(im.height - ry, int(RECORTE_PN["h"] * f))
    recorte = im.crop((rx, ry, rx + rw, ry + rh))
    clases, confianza = modelo.segmentar(recorte)
    # Máscaras reducidas a la mitad: la grilla del modelo es más gruesa que eso.
    red = clases[::2, ::2]
    hm, wm = red.shape
    celda_x, celda_y = rw / 37.0, rh / 37.0
    caja = ((ROI["x"] * f - rx - celda_x) / 2, (ROI["y"] * f - ry - celda_y) / 2,
            ((ROI["x"] + ROI["w"]) * f - rx + celda_x) / 2, ((ROI["y"] + ROI["h"]) * f - ry + celda_y) / 2)
    res = {"clases": clases, "recorte": recorte, "confianza": float(confianza.mean())}
    for nombre, valores in (("ceniza", (pn.COLUMNA, pn.CENIZA)), ("gas", (pn.GAS,))):
        mascara = bytearray(((red == valores[0]) | (red == valores[-1])).astype("uint8").tobytes())
        res[nombre + "_pct"] = 100.0 * sum(mascara) / len(mascara)
        m = mancha_mayor(mascara, wm, hm, caja=caja)
        res[nombre + "_medidas"] = medir_en_metros(m, rx, ry, 2, 2, f, wm, hm) if m else None
    return res


def preparar_csv(ruta):
    """Si el CSV existe con otras columnas (versión anterior del script), lo
    renombra y empieza uno nuevo, para no mezclar formatos."""
    if ruta.exists():
        with open(ruta, encoding="utf-8") as fh:
            primera = fh.readline().strip()
        if primera != ";".join(CABECERA):
            anterior = ruta.with_name(ruta.stem + "_anterior_" + ahora().strftime("%Y%m%d_%H%M%S") + ".csv")
            ruta.rename(anterior)
            print(f"CSV con otro formato renombrado a {anterior.name}", flush=True)
    if not ruta.exists():
        with open(ruta, "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh, delimiter=";").writerow(CABECERA)


def fmt(v, dec=0):
    return "" if v is None else f"{v:.{dec}f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--alias", default="", help="alias de la cámara en IPCamLive")
    ap.add_argument("--modo", choices=["snapshot", "hls"], default="snapshot")
    ap.add_argument("--snapshot-url", default="", help="URL directa del JPG (opcional)")
    ap.add_argument("--hls-url", default="", help="URL directa del m3u8 (opcional)")
    ap.add_argument("--intervalo", type=float, default=5.0, help="minutos entre capturas")
    ap.add_argument("--salida", default="datos", help="carpeta de salida")
    ap.add_argument("--umbral", type=float, default=2.0, help="umbral del índice (%%) para marcar incandescencia")
    ap.add_argument("--umbral-brillo", type=float, default=200, help="luminancia (0 a 255) desde la cual un píxel cuenta como brillante")
    ap.add_argument("--detector", choices=["auto", "ceniza", "incand"], default="auto",
                    help="auto: ceniza de día e incandescencia de noche, según la imagen")
    ap.add_argument("--umbral-ceniza", type=float, default=5.0, help="índice de ceniza (%%) para marcar posible emisión")
    ap.add_argument("--umbral-calidez", type=float, default=12, help="aumento mínimo de R − B de un píxel sobre su fondo")
    ap.add_argument("--umbral-oscuro", type=float, default=25, help="baja mínima de luminancia de un píxel bajo su fondo")
    ap.add_argument("--calidez-nube", type=float, default=80, help="calidez R − B de una nube iluminada bajo la cual un cambio cuenta como vapor")
    ap.add_argument("--luz-nube", type=float, default=230, help="luminancia de una nube iluminada, a la que se prolonga cada cambio")
    ap.add_argument("--tau-fondo", type=float, default=600, help="constante de tiempo del fondo de ceniza, en segundos")
    ap.add_argument("--zona", nargs=4, type=float, metavar=("X", "Y", "W", "H"), help="sobrescribe la zona de columna para ceniza")
    ap.add_argument("--mascaras", action="store_true", help="guarda la máscara de detección de cada captura")
    ap.add_argument("--plumenet", default="", help="modelo traced (.pt) de VIGIA-PlumeNet; activa su segmentación")
    ap.add_argument("--pn-recorte", nargs=4, type=float, metavar=("X", "Y", "W", "H"), help="recorte para VIGIA-PlumeNet, en px de referencia")
    ap.add_argument("--pn-dispositivo", default="cpu", help="cpu o cuda para VIGIA-PlumeNet")
    ap.add_argument("--calib", nargs=3, type=float, metavar=("X", "Y0", "PX100"), help="sobrescribe x, y0, px por 100 m")
    ap.add_argument("--roi", nargs=4, type=float, metavar=("X", "Y", "W", "H"), help="sobrescribe la ROI")
    ap.add_argument("--una-vez", action="store_true", help="captura una sola vez y termina")
    a = ap.parse_args()

    global UMBRAL_BRILLO
    UMBRAL_BRILLO = a.umbral_brillo
    if a.calib:
        CALIB.update(x=a.calib[0], y0=a.calib[1], px_por_100m=a.calib[2])
    if a.roi:
        ROI.update(x=a.roi[0], y=a.roi[1], w=a.roi[2], h=a.roi[3])
    if a.zona:
        ZONA_COLUMNA.update(x=a.zona[0], y=a.zona[1], w=a.zona[2], h=a.zona[3])
    if a.pn_recorte:
        RECORTE_PN.update(x=a.pn_recorte[0], y=a.pn_recorte[1], w=a.pn_recorte[2], h=a.pn_recorte[3])
    modelo_pn = None
    if a.plumenet:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        from plumenet import PlumeNet
        modelo_pn = PlumeNet(a.plumenet, a.pn_dispositivo)
    if not (a.alias or a.snapshot_url or a.hls_url):
        ap.error("indique --alias, --snapshot-url o --hls-url")

    salida = pathlib.Path(a.salida)
    (salida / "cuadros").mkdir(parents=True, exist_ok=True)
    (salida / "cuadros_escala").mkdir(parents=True, exist_ok=True)
    if a.mascaras:
        (salida / "mascaras").mkdir(parents=True, exist_ok=True)
    csv_path = salida / "registro.csv"
    preparar_csv(csv_path)
    fondo = FondoCeniza(salida, a.tau_fondo)
    ruta_estado = salida / "estado_detector.json"
    try:
        estado_det = json.loads(ruta_estado.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        estado_det = {}

    url = None
    if a.modo == "hls":
        url = a.hls_url or url_hls(a.alias)
    else:
        url = a.snapshot_url or f"https://ipcamlive.com/player/snapshot.php?alias={a.alias}"

    while True:
        t = ahora()
        nombre = t.strftime("%Y%m%d_%H%M%S")
        crudo = salida / "cuadros" / f"{nombre}.jpg"
        try:
            if a.modo == "hls":
                cuadro_hls(url, crudo)
            else:
                descargar(url, crudo)
            im = Image.open(crudo).convert("RGB")
            f = im.width / REF_W
            lum_cuadro, colorido, lum_cielo = caracterizar(im)
            dia = es_de_dia(lum_cielo, estado_det.get("es_dia", False))
            bn = colorido < COLOR_MIN
            # Al cambiar la cámara entre blanco y negro y color, el tono de cada
            # píxel salta de golpe: el fondo de ceniza se forma de nuevo.
            if "bn" in estado_det and estado_det["bn"] != bn:
                fondo.clave = None
            estado_det.update(es_dia=dia, bn=bn)
            ruta_estado.write_text(json.dumps(estado_det), encoding="utf-8")
            modo = a.detector if a.detector != "auto" else ("ceniza" if dia else "incand")
            inc = indice_incandescencia(im, f)
            cen = indice_ceniza(im, f, fondo, a.umbral_calidez, a.umbral_oscuro, time.time(), a.calidez_nube, a.luz_nube) if (modo == "ceniza" or dia) else None
            mi, mc = inc["medidas"], cen["medidas"] if cen else None
            alerta_inc = inc["indice"] >= a.umbral
            alerta_cen = bool(cen) and cen["indice"] >= a.umbral_ceniza
            if modo == "ceniza":
                texto = f"Cámara Tata · {t.strftime('%Y-%m-%d %H:%M:%S')} · ceniza {cen['indice']:.2f} %"
                texto += " POSIBLE EMISIÓN" if alerta_cen else ""
                if mc:
                    texto += f" · columna de ceniza: tope {mc['tope_m']:.0f} m · alto {mc['alto_m']:.0f} m · ancho {mc['ancho_m']:.0f} m"
                texto += f" · vapor {cen['indice_vapor']:.2f} %"
                mvap = cen["medidas_vapor"]
                if mvap:
                    texto += f" · columna de vapor: tope {mvap['tope_m']:.0f} m"
                if cen["fondo_nuevo"]:
                    texto += " · fondo nuevo"
                if bn:
                    texto += " · cámara en b/n: solo oscurecimiento"
            else:
                texto = f"Cámara Tata · {t.strftime('%Y-%m-%d %H:%M:%S')} · incandescencia {inc['indice']:.2f} %"
                texto += " INCANDESCENCIA" if alerta_inc else ""
                if mi:
                    texto += f" · tope {mi['tope_m']:.0f} m · alto {mi['alto_m']:.0f} m · ancho {mi['ancho_m']:.0f} m"
            pn_res = None
            if modelo_pn is not None:
                pn_res = analizar_plumenet(modelo_pn, im, f)
                tc, tg = pn_res["ceniza_medidas"], pn_res["gas_medidas"]
                # Si la columna toca el borde del recorte, su tope real está más
                # arriba o más lejos: se informa como cota mínima.
                def tope(m):
                    if not m:
                        return ""
                    return f" tope ≥ {m['tope_m']:.0f} m (sale del recorte)" if m["corte_arriba"] else f" tope {m['tope_m']:.0f} m"
                texto += f" · PlumeNet: ceniza {pn_res['ceniza_pct']:.1f} %" + tope(tc)
                texto += f", gas {pn_res['gas_pct']:.1f} %" + tope(tg)
            anotar(im, f, texto, modo, mc if modo == "ceniza" else mi).save(salida / "cuadros_escala" / f"{nombre}.jpg", quality=90)
            if pn_res is not None and a.mascaras:
                import plumenet as pn
                pn.imagen_clases(pn_res["clases"], pn_res["recorte"]).save(salida / "mascaras" / f"{nombre}_plumenet.png")
            if a.mascaras:
                res = cen if modo == "ceniza" else inc
                imagen_mascara(res, modo, 2 if modo == "ceniza" else 3).save(salida / "mascaras" / f"{nombre}_{modo}.png")
            with open(csv_path, "a", newline="", encoding="utf-8") as fh:
                csv.writer(fh, delimiter=";").writerow([
                    t.isoformat(timespec="seconds"), crudo.name, im.width, im.height, fmt(lum_cuadro, 1), fmt(lum_cielo, 1), fmt(colorido, 1),
                    "dia" if modo == "ceniza" else "noche",
                    fmt(inc["indice"], 2), fmt(inc["lum_roi"], 1), int(alerta_inc),
                    fmt(mi and mi["tope_m"]), fmt(mi and mi["alto_m"]), fmt(mi and mi["ancho_m"]),
                    fmt(cen and cen["indice"], 2), fmt(cen and cen["indice_vapor"], 2), "" if not cen else cen["ceniza"], "" if not cen else cen["vapor"],
                    "" if not cen else int(alerta_cen), fmt(cen and cen["edad_fondo_s"] / 60, 1),
                    fmt(mc and mc["tope_m"]), fmt(mc and mc["alto_m"]), fmt(mc and mc["ancho_m"]),
                    fmt(cen and cen["medidas_vapor"] and cen["medidas_vapor"]["tope_m"])] +
                    ([fmt(pn_res["ceniza_pct"], 2), fmt(pn_res["gas_pct"], 2),
                      fmt(pn_res["ceniza_medidas"] and pn_res["ceniza_medidas"]["tope_m"]),
                      fmt(pn_res["gas_medidas"] and pn_res["gas_medidas"]["tope_m"]), fmt(pn_res["confianza"], 2),
                      "" if not pn_res["ceniza_medidas"] else int(pn_res["ceniza_medidas"]["corte_arriba"]),
                      "" if not pn_res["gas_medidas"] else int(pn_res["gas_medidas"]["corte_arriba"])]
                     if pn_res is not None else ["", "", "", "", "", "", ""]))
            print(f"{t:%H:%M:%S} {im.width}x{im.height} cielo={lum_cielo:.0f} color={colorido:.1f} → {texto.split(' · ', 2)[-1]}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"{t:%H:%M:%S} error: {e}", file=sys.stderr, flush=True)
        if a.una_vez:
            break
        time.sleep(max(10.0, a.intervalo * 60.0))


if __name__ == "__main__":
    main()
