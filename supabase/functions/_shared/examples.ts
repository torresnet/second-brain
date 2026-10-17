// Normalização dos "exemplos práticos" devolvidos pela IA (nunca confie no formato).

import { truncate } from './text.ts';

export interface PracticalExample {
  title: string;
  scenario: string;
  how: string;
  uses: string[];
}

export const MAX_EXAMPLES = 5;

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? truncate(value.replace(/\s+/g, ' ').trim(), max) : '';

/** Aceita até 5 exemplos válidos (título + como aplicar); descarta o resto e repetidos. */
export function normalizeExamples(raw: unknown): PracticalExample[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: PracticalExample[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = clean(e.title, 120);
    const how = clean(e.how, 700);
    if (!title || !how) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const uses = Array.isArray(e.uses)
      ? [...new Set(e.uses.map(u => clean(u, 80)).filter(Boolean))].slice(0, 6)
      : [];
    out.push({ title, scenario: clean(e.scenario, 300), how, uses });
    if (out.length === MAX_EXAMPLES) break;
  }
  return out;
}

export function examplesSearchText(examples: PracticalExample[]): string {
  return examples.length ? `Como aplicar na prática: ${examples.map(e => `${e.title} — ${e.scenario || e.how}`).join('; ')}` : '';
}
