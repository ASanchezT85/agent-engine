/** Redaccion de secretos. Se aplica en INGESTA, antes de tocar la BD, y otra vez al servir. */

const RULES: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_\-]{10,}/g, "[REDACTED:anthropic-key]"],
  // sin guiones tras el prefijo: si no, "spawn-task-no-para-pasos-del-ciclo" se redacta sola
  [/sk-(?:proj-)?[A-Za-z0-9]{20,}/g, "[REDACTED:openai-key]"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED:github-token]"],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED:slack-token]"],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED:aws-key-id]"],
  [/AIza[0-9A-Za-z_\-]{35}/g, "[REDACTED:google-key]"],
  [/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, "[REDACTED:jwt]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED:private-key]"],
  [/\b(?:bearer|token|apikey|api_key|secret|password|passwd|pwd)\b\s*[:=]\s*["']?([^\s"',;]{6,})/gi, (m: string) => m.split(/[:=]/)[0] + "=[REDACTED]"] as unknown as [RegExp, string],
  [/\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|APIKEY|API_KEY|PRIVATE_KEY)\s*=\s*\S+/g, (m: string) => m.split("=")[0] + "=[REDACTED]"] as unknown as [RegExp, string],
  [/\b(?:Cookie|Set-Cookie|Authorization)\s*:\s*\S.*/gi, (m: string) => m.split(":")[0] + ": [REDACTED]"] as unknown as [RegExp, string],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as string & ((m: string) => string));
  return out;
}

export function looksSecret(text: string): boolean {
  return redact(text) !== text;
}
