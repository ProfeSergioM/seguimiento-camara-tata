#!/usr/bin/env python3
"""Segmentación con VIGIA-PlumeNet para la cámara Plaza Tata.

VIGIA-PlumeNet (Giffard-Roisin et al., Volcanica 2026) segmenta imágenes
RGB de cámaras de volcanes en seis clases. Este archivo no incluye el
modelo ni su código: carga el modelo "traced" (TorchScript) que cada
usuario descarga desde https://huggingface.co/SophieGif/VIGIA-PlumeNet y
aplica el mismo preprocesamiento que el script de evaluación del
repositorio original: la imagen se lleva a 518 × 518 px (bilineal, sin
conservar la proporción) con valores entre 0 y 1.

Clases de salida, en el orden del script de evaluación original:
    0 fondo, 1 columna eruptiva, 2 terreno, 3 emisión de ceniza,
    4 emisión sin ceniza (gas), 5 lava

Requisitos: Python 3.9+, torch, numpy y Pillow.

Usos:
    # Máscara de clases y porcentajes de una imagen
    python3 scripts/plumenet.py segmentar --modelo VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt --imagen foto.jpg

    # Silueta del volcán desde la clase terreno, lista para config.js
    python3 scripts/plumenet.py silueta --modelo VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt --imagen foto_despejada.jpg

El script de monitoreo usa este módulo con la opción --plumenet.
"""
import argparse
import json
import pathlib
import sys

TAM_ENTRADA = 518
CLASES = ["fondo", "columna eruptiva", "terreno", "emisión de ceniza", "emisión sin ceniza", "lava"]
FONDO, COLUMNA, TERRENO, CENIZA, GAS, LAVA = range(6)
# Colores de la máscara, distinguibles también en blanco y negro por su luminosidad.
COLORES = {
    FONDO: (20, 20, 20),
    COLUMNA: (230, 120, 40),
    TERRENO: (90, 90, 90),
    CENIZA: (200, 150, 70),
    GAS: (150, 220, 255),
    LAVA: (255, 40, 40),
}


class PlumeNet:
    """Modelo traced cargado una sola vez y reutilizado en cada imagen."""

    def __init__(self, ruta_modelo, dispositivo="cpu"):
        try:
            import torch  # noqa: F401
            import numpy  # noqa: F401
        except ImportError:
            sys.exit("Faltan torch y numpy: pip install torch numpy")
        import torch
        self.torch = torch
        self.dispositivo = dispositivo
        self.modelo = torch.jit.load(str(ruta_modelo), map_location=dispositivo)
        self.modelo.eval()

    def segmentar(self, imagen):
        """Devuelve (clases, confianza) como arreglos numpy del tamaño de la
        imagen de entrada (PIL, RGB)."""
        import numpy as np
        from PIL import Image
        torch = self.torch
        ancho, alto = imagen.size
        x = imagen.convert("RGB").resize((TAM_ENTRADA, TAM_ENTRADA), Image.Resampling.BILINEAR)
        t = torch.from_numpy(np.asarray(x, dtype=np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0).to(self.dispositivo)
        with torch.no_grad():
            salida = self.modelo(t)
        prob = torch.softmax(salida, dim=1)
        confianza, clases = torch.max(prob, dim=1)
        clases = Image.fromarray(clases[0].cpu().numpy().astype(np.uint8)).resize((ancho, alto), Image.Resampling.NEAREST)
        confianza = Image.fromarray(confianza[0].cpu().numpy().astype(np.float32), mode="F").resize((ancho, alto), Image.Resampling.NEAREST)
        return np.array(clases), np.array(confianza)


def imagen_clases(clases, base=None, alfa=0.55):
    """Máscara en color; si se da la imagen base, se superpone sobre ella."""
    import numpy as np
    from PIL import Image
    color = np.zeros(clases.shape + (3,), dtype=np.uint8)
    for k, c in COLORES.items():
        color[clases == k] = c
    if base is None:
        return Image.fromarray(color)
    b = np.asarray(base.convert("RGB"), dtype=np.float32)
    mezcla = np.where((clases == FONDO)[..., None], b, (1 - alfa) * b + alfa * color)
    return Image.fromarray(mezcla.astype(np.uint8))


def porcentajes(clases, zona=None):
    """Porcentaje de píxeles de cada clase, en todo el cuadro o en una zona
    (x, y, ancho, alto) en píxeles del cuadro."""
    import numpy as np
    if zona:
        x, y, w, h = [int(round(v)) for v in zona]
        clases = clases[y:y + h, x:x + w]
    n = clases.size or 1
    return {CLASES[k]: 100.0 * float(np.count_nonzero(clases == k)) / n for k in range(len(CLASES))}


def silueta_desde_terreno(clases, ref_w, paso=4, min_terreno=0.6):
    """Silueta: por cada columna, el primer píxel de terreno desde arriba,
    exigiendo que bajo él predomine el terreno (para no tomar manchas
    sueltas). Se filtra con una mediana a lo largo de la línea. Devuelve
    puntos [x, y] en píxeles de referencia, o None donde no hay borde."""
    import numpy as np
    alto, ancho = clases.shape
    f = ancho / ref_w
    crudo = []
    for xr in range(0, ref_w, paso):
        x = min(ancho - 1, int(round(xr * f)))
        col = clases[:, max(0, x - 1):x + 2] == TERRENO
        filas = np.nonzero(col.any(axis=1))[0]
        y = None
        for yy in filas:
            debajo = col[yy:yy + max(8, alto // 40)]
            if debajo.mean() >= min_terreno:
                y = int(yy)
                break
        crudo.append(None if y is None else y / f)
    puntos = []
    for i, v in enumerate(crudo):
        vec = sorted(q for q in crudo[max(0, i - 3):i + 4] if q is not None)
        med = vec[len(vec) // 2] if vec else None
        ok = v is not None and med is not None and abs(v - med) <= 12
        puntos.append([i * paso, round(med)] if ok else None)
    return puntos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="orden", required=True)
    for nombre in ("segmentar", "silueta"):
        p = sub.add_parser(nombre)
        p.add_argument("--modelo", required=True, help="archivo .pt traced de VIGIA-PlumeNet")
        p.add_argument("--imagen", required=True, help="imagen de la cámara")
        p.add_argument("--salida", default="plumenet_resultados", help="carpeta de salida")
        p.add_argument("--dispositivo", default="cpu", help="cpu o cuda")
        p.add_argument("--ref-w", type=int, default=1920, help="ancho del cuadro de referencia de la calibración")
    a = ap.parse_args()

    from PIL import Image, ImageOps
    imagen = ImageOps.exif_transpose(Image.open(a.imagen)).convert("RGB")
    salida = pathlib.Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    nombre = pathlib.Path(a.imagen).stem

    modelo = PlumeNet(a.modelo, a.dispositivo)
    clases, confianza = modelo.segmentar(imagen)
    imagen_clases(clases, imagen).save(salida / f"{nombre}_clases.png")
    imagen_clases(clases).save(salida / f"{nombre}_mascara.png")

    if a.orden == "segmentar":
        print(f"Imagen {imagen.size[0]}×{imagen.size[1]} · confianza media {float(confianza.mean()):.2f}")
        for clase, pct in porcentajes(clases).items():
            print(f"  {clase:20s} {pct:6.2f} %")
        print(f"Resultados en {salida}/")
    else:
        puntos = silueta_desde_terreno(clases, a.ref_w)
        validos = sum(1 for p in puntos if p)
        (salida / f"{nombre}_silueta.json").write_text(json.dumps(puntos), encoding="utf-8")
        from PIL import ImageDraw
        vista = imagen.copy()
        d = ImageDraw.Draw(vista)
        f = imagen.size[0] / a.ref_w
        tramo = []
        for p in puntos + [None]:
            if p and (not tramo or abs(p[1] - tramo[-1][1] / f) <= 40):
                tramo.append((p[0] * f, p[1] * f))
                continue
            if len(tramo) > 1:
                d.line(tramo, fill=(255, 240, 150), width=max(1, int(2 * f)))
            tramo = [(p[0] * f, p[1] * f)] if p else []
        vista.save(salida / f"{nombre}_silueta.png")
        print(f"Silueta con borde en {validos} de {len(puntos)} columnas.")
        print("Pegue esta línea en config.js para dejarla fija:")
        print("  silueta: " + json.dumps(puntos) + ",")


if __name__ == "__main__":
    main()
