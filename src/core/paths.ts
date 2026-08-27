import { homedir } from "node:os";
import { resolve, join, sep } from "node:path";
import { openSync, closeSync, readSync, fstatSync, constants } from "node:fs";

export const HOME = homedir();
export const ENGINE_ROOT = resolve(import.meta.dir, "..", "..");
export const DATA_DIR = join(ENGINE_ROOT, "data");

/** Raices de herramientas externas. TODO acceso aqui es estrictamente de lectura. */
export const FOREIGN_ROOTS = [
  join(HOME, ".claude"),
  join(HOME, ".codex"),
  join(HOME, ".cursor"),
  join(HOME, ".opencode"),
  join(HOME, ".config", "codex"),
  join(HOME, ".config", "opencode"),
].map((p) => resolve(p));

const norm = (p: string) => resolve(p).toLowerCase();

export function isForeign(p: string): boolean {
  const t = norm(p);
  return FOREIGN_ROOTS.some((r) => {
    const rr = norm(r);
    return t === rr || t.startsWith(rr + sep.toLowerCase());
  });
}

/** Rutas que jamas se leen ni se indexan, aunque esten dentro de una raiz permitida. */
const DENY = [/\.credentials\.json$/i, /(^|[\/])\.env(\..*)?$/i, /\.key$/i, /(^|[\/])id_(rsa|ed25519)/i];
export function isDenied(p: string): boolean {
  return DENY.some((r) => r.test(p));
}

/**
 * Unico punto de acceso a disco ajeno. Abre SIEMPRE en O_RDONLY.
 * Cualquier intento de escritura sobre una raiz externa aborta el proceso.
 */
export function assertReadOnly(p: string, mode: "read" | "write"): void {
  if (mode === "write" && isForeign(p)) {
    throw new Error(`VIOLACION READ-ONLY: intento de escritura en herramienta externa: ${p}`);
  }
}

export function openReadOnly(p: string): number {
  assertReadOnly(p, "read");
  if (isDenied(p)) throw new Error(`ruta en denylist, no se lee: ${p}`);
  return openSync(p, constants.O_RDONLY);
}

/** Lee bytes desde `offset` hasta EOF, en trozos. Devuelve el nuevo offset consumido. */
export function readFrom(path: string, offset: number, onChunk: (b: Buffer) => void): number {
  const fd = openReadOnly(path);
  try {
    const size = fstatSync(fd).size;
    let pos = Math.min(offset, size);
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    while (pos < size) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      onChunk(buf.subarray(0, n));
      pos += n;
    }
    return pos;
  } finally {
    closeSync(fd);
  }
}
