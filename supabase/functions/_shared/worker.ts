// Núcleo do indexador em segundo plano: esvazia a fila de notas pendentes dentro de um orçamento de tempo.
// Sem dependências do Deno, para ser testado em Node.

export interface WorkerResult {
  status: 'done' | 'partial' | 'failed' | 'busy' | 'not_found' | 'quota';
}

export interface DrainDeps {
  listPending: (excludeIds: string[]) => Promise<string[]>;
  processOne: (id: string) => Promise<WorkerResult>;
  now: () => number;
  /** Só inicia um novo item enquanto o tempo gasto for menor que isto (cada item leva até ~60 s). */
  startBudgetMs: number;
  maxItems: number;
}

export interface DrainSummary {
  processed: number;
  failed: number;
  busy: number;
  quotaHit: boolean;
  attempted: number;
}

export async function drainPending(deps: DrainDeps): Promise<DrainSummary> {
  const startedAt = deps.now();
  const seen: string[] = [];
  const summary = { processed: 0, failed: 0, busy: 0, quotaHit: false, attempted: 0 };

  while (summary.attempted < deps.maxItems && deps.now() - startedAt < deps.startBudgetMs) {
    const [id] = await deps.listPending(seen);
    if (!id) break;
    seen.push(id);
    summary.attempted += 1;

    const { status } = await deps.processOne(id);
    if (status === 'quota') {
      summary.quotaHit = true;
      break;
    }
    if (status === 'done' || status === 'partial') summary.processed += 1;
    else if (status === 'busy') summary.busy += 1;
    else summary.failed += 1;
  }
  return summary;
}
