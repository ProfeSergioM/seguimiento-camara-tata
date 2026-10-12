# Modelo VIGIA-PlumeNet en ONNX

`vigia_plumenet_fp32.onnx` es VIGIA-PlumeNet convertido a ONNX para que el sitio lo ejecute en el navegador.

- **Origen:** `VIGIAPlumeNet_traced_Dinov2_s14reg_6classes.pt`, de https://huggingface.co/SophieGif/VIGIA-PlumeNet. Esos pesos se publican bajo licencia CC0 1.0.
- **Autores:** Sophie Giffard-Roisin, Yves Moussallam, Sébastien Valade, Emily Ramos, Thomas C. Wilkes, Freddy Vásconez y Robin Campion. *VIGIA-PlumeNet and VIGIA-PlumeData: Open-Source AI Segmenting Model and Database For Volcanic Plumes and Emissions From Monitoring Ground Optical Cameras*, Volcanica, 2026.
- **Conversión:** `scripts/exportar_onnx.py`, con PyTorch 2.5.1 y opset 17. No hay cuantización ni otros cambios en los pesos.
- **Verificación:** en 6 imágenes de ejemplo del repositorio original y 3 de la cámara Plaza Tata, la clase predicha coincide con el modelo original en el 100 % de los píxeles, con una diferencia máxima en los logits de 1.2 × 10⁻⁴.
- **Entrada:** `imagen`, de 1 × 3 × 518 × 518, RGB con valores entre 0 y 1, sin otra normalización.
- **Salida:** `logits`, de 1 × 6 × 518 × 518. Clases: 0 fondo, 1 columna eruptiva, 2 terreno, 3 emisión de ceniza, 4 emisión sin ceniza, 5 lava.

Se probó también una versión cuantizada a 8 bits, de 24 MB. Coincidió con el original solo en el 89 a 99.9 % de los píxeles y cambió la clasificación entre ceniza y gas en la emisión real del 12-10-2026, así que se descartó.
