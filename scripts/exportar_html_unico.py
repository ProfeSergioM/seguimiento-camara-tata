#!/usr/bin/env python3
"""Genera dist/tata.html: un solo archivo HTML con CSS, JavaScript,
configuración y hls.js embebidos, listo para copiar a otra máquina y abrir
con doble clic.

Uso:
    python3 scripts/exportar_html_unico.py            # escribe dist/tata.html
    python3 scripts/exportar_html_unico.py salida.html
"""
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
html = (RAIZ / "index.html").read_text(encoding="utf-8")


def leer(ruta):
    return (RAIZ / ruta).read_text(encoding="utf-8")


def embeber_css(m):
    return "<style>\n" + leer(m.group(1)) + "\n</style>"


def embeber_js(m):
    codigo = leer(m.group(1)).replace("</script", "<\\/script")
    return "<script>\n" + codigo + "\n</script>"


html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', embeber_css, html)
html = re.sub(r'<script src="([^"]+)"></script>', embeber_js, html)

destino = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "dist" / "tata.html"
destino.parent.mkdir(parents=True, exist_ok=True)
destino.write_text(html, encoding="utf-8")
print(f"Escrito {destino} ({destino.stat().st_size // 1024} KB)")
