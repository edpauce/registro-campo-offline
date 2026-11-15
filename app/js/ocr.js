/* =============================================================================
   OCR.JS — Ayuda opcional para transcribir una foto de hoja o panel.

   IMPORTANTE, y así se le explica al usuario en pantalla:
   esto NO reemplaza al que digita. Ofrece los números que el dispositivo cree
   haber leído para que el responsable los coloque y los verifique contra la
   foto. Sobre números escritos a mano o displays de 7 segmentos ningún lector
   automático es confiable al 100 %, y un dato de balance hídrico mal leído
   cuesta más que el minuto que ahorra.

   Usa el lector de texto que ya trae el propio dispositivo (Shape Detection
   API, presente en Chrome de Android). Si el equipo no lo tiene, la función
   simplemente no se ofrece: no se descarga nada de internet.
   ========================================================================== */

const OCR = {
  disponible() {
    return typeof window.TextDetector === 'function';
  },

  /* Devuelve los números detectados, ordenados como se leen: de arriba hacia
     abajo y de izquierda a derecha, que es el orden de las filas del formato. */
  async numeros(dataURL) {
    if (!this.disponible() || !dataURL) return [];
    try {
      const blob = await (await fetch(dataURL)).blob();
      const bitmap = await createImageBitmap(blob);
      const bloques = await new window.TextDetector().detect(bitmap);
      const items = [];
      bloques.forEach(b => {
        const y = b.boundingBox ? b.boundingBox.y : 0;
        const x = b.boundingBox ? b.boundingBox.x : 0;
        (String(b.rawValue).match(/-?\d+(?:[.,]\d+)?/g) || []).forEach(n => {
          const v = n.replace(',', '.');
          if (v.replace(/[^0-9]/g, '').length) items.push({ v, x, y });
        });
      });
      items.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const vistos = new Set();
      return items.map(i => i.v).filter(v => {
        const k = v + '|' + vistos.size;   // permite repetidos consecutivos legítimos
        return vistos.has(k) ? false : (vistos.add(k), true);
      }).slice(0, 120);
    } catch (e) {
      return [];
    }
  }
};

window.OCR = OCR;
