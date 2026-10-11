#!/usr/bin/env python3
"""Registro automático de la cámara Plaza Tata (Nevados de Chillán).

Cada N minutos captura un cuadro de la cámara (snapshot JPG de IPCamLive o
un cuadro del stream HLS con ffmpeg), lo guarda, le dibuja la escala de
altura calibrada y calcula un índice de incandescencia en la región del
cráter. Los resultados se acumulan en un CSV.

Requisitos: Python 3.8+, Pillow (pip install pillow). Para el modo HLS se
necesita ffmpeg en el PATH.

Ejemplos:
    python3 scripts/monitor.py --alias XXXXXXXX --intervalo 5
    python3 scripts/monitor.py --alias XXXXXXXX --modo hls --intervalo 2 --salida datos
    python3 scripts/monitor.py --snapshot-url https://.../snapshot.jpg --una-vez
"""
import argparse
import csv
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
CALIB = {"x": 868.5, "y0": 565.6, "px_por_100m": 54.1, "altura_max": 500}
ROI = {"x": 808, "y": 525, "w": 120, "h": 68}
UMBRAL_BRILLO = 200
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


def indice_incandescencia(im, f):
    """Porcentaje de píxeles rojizos o brillantes dentro de la ROI."""
    x, y = int(ROI["x"] * f), int(ROI["y"] * f)
    w, h = int(ROI["w"] * f), int(ROI["h"] * f)
    roi = im.crop((x, y, x + w, y + h)).convert("RGB")
    px = roi.load()
    calientes, lum = 0, 0.0
    n = roi.width * roi.height
    for j in range(roi.height):
        for i in range(roi.width):
            R, G, B = px[i, j]
            lum += 0.299 * R + 0.587 * G + 0.114 * B
            # Rojizo (solo en color) o brillante (criterio que cuenta de noche,
            # cuando la cámara transmite en blanco y negro).
            if (R >= 140 and R > G * 1.25 and R > B * 1.6) or (0.299 * R + 0.587 * G + 0.114 * B >= UMBRAL_BRILLO):
                calientes += 1
    gris = im.convert("L").resize((160, max(1, int(160 * im.height / im.width))))
    lum_cuadro = sum(gris.tobytes()) / (gris.width * gris.height)
    return 100.0 * calientes / n, lum / n, lum_cuadro


def anotar(im, f, texto):
    d = ImageDraw.Draw(im)
    fn = fuente(max(12, int(16 * f)))
    x = CALIB["x"] * f
    y_de = lambda h: (CALIB["y0"] - h / 100.0 * CALIB["px_por_100m"]) * f
    y0, ytop = y_de(0), y_de(CALIB["altura_max"])
    d.line([(x, y0), (x, ytop)], fill=(0, 0, 0), width=max(3, int(5 * f)))
    d.line([(x, y0), (x, ytop)], fill=(255, 255, 255), width=max(1, int(2 * f)))
    h = 0
    while h <= CALIB["altura_max"]:
        y = y_de(h)
        d.line([(x - 12 * f, y), (x + 12 * f, y)], fill=(255, 255, 255), width=max(1, int(2 * f)))
        d.text((x + 18 * f, y), str(h), fill=(255, 255, 255), font=fn, anchor="lm",
               stroke_width=max(1, int(2 * f)), stroke_fill=(0, 0, 0))
        h += 100
    d.rectangle([ROI["x"] * f, ROI["y"] * f, (ROI["x"] + ROI["w"]) * f, (ROI["y"] + ROI["h"]) * f], outline=(229, 83, 61), width=1)
    d.text((12 * f, im.height - 16 * f), texto, fill=(255, 255, 255), font=fn, anchor="lm",
           stroke_width=max(1, int(2 * f)), stroke_fill=(0, 0, 0))
    return im


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
    if not (a.alias or a.snapshot_url or a.hls_url):
        ap.error("indique --alias, --snapshot-url o --hls-url")

    salida = pathlib.Path(a.salida)
    (salida / "cuadros").mkdir(parents=True, exist_ok=True)
    (salida / "cuadros_escala").mkdir(parents=True, exist_ok=True)
    csv_path = salida / "registro.csv"
    nuevo = not csv_path.exists()

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
            idx, lum_roi, lum_cuadro = indice_incandescencia(im, f)
            noche = lum_cuadro < 40
            marca = "INCANDESCENCIA" if idx >= a.umbral else ""
            texto = f"Cámara Tata · {t.strftime('%Y-%m-%d %H:%M:%S')} · índice {idx:.2f} % {marca}"
            anotar(im, f, texto).save(salida / "cuadros_escala" / f"{nombre}.jpg", quality=90)
            with open(csv_path, "a", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh, delimiter=";")
                if nuevo:
                    w.writerow(["fecha_hora_local", "archivo", "ancho", "alto", "lum_cuadro", "lum_roi", "indice_pct", "noche", "incandescencia"])
                    nuevo = False
                w.writerow([t.isoformat(timespec="seconds"), crudo.name, im.width, im.height,
                            f"{lum_cuadro:.1f}", f"{lum_roi:.1f}", f"{idx:.2f}", int(noche), int(idx >= a.umbral)])
            print(f"{t:%H:%M:%S} {im.width}x{im.height} lum={lum_cuadro:.0f} índice={idx:.2f}% {marca}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"{t:%H:%M:%S} error: {e}", file=sys.stderr, flush=True)
        if a.una_vez:
            break
        time.sleep(max(10.0, a.intervalo * 60.0))


if __name__ == "__main__":
    main()
