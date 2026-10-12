#!/usr/bin/env python3
"""Convierte el modelo traced de VIGIA-PlumeNet a ONNX para el sitio.

Uso:
    pip install torch onnx onnxruntime pillow numpy
    python3 scripts/exportar_onnx.py VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt modelos/vigia_plumenet_fp32.onnx [imagenes...]

Si se dan imágenes, compara la clase predicha por ONNX Runtime con la del
modelo original, píxel a píxel.
"""
import sys

import numpy as np
import torch
from PIL import Image


def entrada(ruta):
    im = Image.open(ruta).convert("RGB").resize((518, 518), Image.Resampling.BILINEAR)
    return np.asarray(im, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    origen, destino, imagenes = sys.argv[1], sys.argv[2], sys.argv[3:]
    modelo = torch.jit.load(origen, map_location="cpu").eval()
    torch.onnx.export(modelo, (torch.rand(1, 3, 518, 518),), destino, input_names=["imagen"], output_names=["logits"],
                      opset_version=17, do_constant_folding=True)
    print("Escrito", destino)
    if imagenes:
        import onnxruntime as ort
        sesion = ort.InferenceSession(destino, providers=["CPUExecutionProvider"])
        for ruta in imagenes:
            x = entrada(ruta)
            with torch.no_grad():
                ref = modelo(torch.from_numpy(x)).numpy()
            out = sesion.run(None, {"imagen": x})[0]
            print(f"{ruta}: coincidencia de clases {100 * (out.argmax(1) == ref.argmax(1)).mean():.2f} %, "
                  f"diferencia máxima {np.abs(out - ref).max():.1e}")


if __name__ == "__main__":
    main()
