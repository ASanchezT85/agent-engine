import { existsSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "../core/paths";
import type { Provider } from "../core/types";
import { claudeProvider } from "./claude";
import { cursorProvider } from "./cursor";
import { codexProvider } from "./codex";
import { opencodeProvider } from "./opencode";

/** Proveedor no implementado: se detecta, se muestra, no indexa. */
function stub(id: string, label: string, roots: string[], note: string): Provider {
  return {
    id, label,
    detect() {
      const root = roots.find((r) => existsSync(r)) ?? null;
      return { installed: root !== null, root, note };
    },
    index() { return { files: 0, newBytes: 0, messages: 0 }; },
  };
}

export const providers: Provider[] = [
  claudeProvider,
  codexProvider,
  cursorProvider,
  opencodeProvider,
];

export function detectAll() {
  return providers.map((p) => ({ id: p.id, label: p.label, ...p.detect() }));
}
