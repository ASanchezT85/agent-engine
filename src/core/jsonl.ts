import { readFrom } from "./paths";

/**
 * Lee lineas completas desde `offset`. Devuelve el offset justo despues del ultimo `\n`
 * visto: una ultima linea parcial (archivo aun escribiendose) se relee la proxima vez.
 * Nunca carga el archivo entero en memoria.
 */
export function streamLines(path: string, offset: number, onLine: (s: string) => void): number {
  let rest = Buffer.alloc(0);
  let read = 0;
  readFrom(path, offset, (chunk) => {
    read += chunk.length;
    const buf = rest.length ? Buffer.concat([rest, chunk]) : Buffer.from(chunk);
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0x0a) continue;
      const line = buf.subarray(start, i).toString("utf8").trim();
      if (line) onLine(line);
      start = i + 1;
    }
    rest = Buffer.from(buf.subarray(start));
  });
  return offset + read - rest.length;
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
