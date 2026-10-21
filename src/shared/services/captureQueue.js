import { friendlyError } from '../utils/friendlyError.js';
const ALERTS_KEY = 'sb.capture.alerts';

/**
 * Fila de capturas em segundo plano: o modal entrega o pedido e fecha; o processamento
 * (pipeline de IA, uploads) continua aqui, independente de qualquer tela.
 * Links já salvos não são gravados: viram alertas aguardando a decisão do usuário.
 *
 * Com `pending` (armazenamento durável, ex.: IndexedDB), cada captura fica guardada até concluir:
 * se a página recarregar no meio, `restore()` retoma o que ficou pelo caminho.
 *
 * Também aceita tarefas avulsas ({ kind: 'task', label, run }), como reprocessar uma nota.
 *
 * Job: { id, kind, label, status: processing|done|warning|error|attention|skipped, message }
 * Alerta: { id, url, hint, label, existing: { id, title, created_at } }
 */
export function createCaptureQueue({ execute, findDuplicates, storage, onItemSaved, pending }) {
  const listeners = new Set();
  let jobs = [];
  let alerts = loadAlerts();
  let sequence = 0;
  const MAX_RESTORE_ATTEMPTS = 3;

  const persistable = (spec) => Boolean(pending) && spec.kind !== 'task' && !spec.run;
  const forget = (key) => (key && pending ? pending.remove(key).catch(() => {}) : Promise.resolve());

  function loadAlerts() {
    try {
      const parsed = JSON.parse(storage?.getItem(ALERTS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter((a) => a && a.id && a.url) : [];
    } catch {
      return [];
    }
  }

  function persistAlerts() {
    try {
      storage?.setItem(ALERTS_KEY, JSON.stringify(alerts));
    } catch {
      // armazenamento cheio ou bloqueado: os alertas valem só nesta sessão
    }
  }

  function emit() {
    const snapshot = getSnapshot();
    listeners.forEach((listener) => listener(snapshot));
  }

  function getSnapshot() {
    return { jobs: [...jobs], alerts: [...alerts] };
  }

  function nextId(prefix) {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence}`;
  }

  function patchJob(id, patch) {
    jobs = jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
    emit();
  }

  function isLinkInFlight(url) {
    return jobs.some((job) => job.status === 'processing' && job.kind === 'link' && job.url === url);
  }

  async function findExisting(url) {
    try {
      return await findDuplicates(url);
    } catch {
      return [];
    }
  }

  async function run(jobId, spec, key) {
    try {
      if (spec.kind === 'link' && spec.restoredAt) {
        const [existing] = await findExisting(spec.url);
        if (existing && Date.parse(existing.created_at) >= spec.restoredAt) {
          if (onItemSaved) await onItemSaved();
          await forget(key);
          patchJob(jobId, { status: 'done', message: 'Link salvo.' });
          return;
        }
      }
      if (spec.kind === 'link' && !spec.skipDuplicateCheck) {
        const [existing] = await findExisting(spec.url);
        if (existing) {
          alerts = [...alerts, {
            id: nextId('alert'),
            url: spec.url,
            hint: spec.hint || '',
            label: spec.label,
            existing: { id: existing.id, title: existing.title, created_at: existing.created_at }
          }];
          persistAlerts();
          await forget(key);
          patchJob(jobId, { status: 'attention', message: 'Você já salvou este link. Decida na central de alertas.' });
          return;
        }
      }

      const { message, warning } = await (spec.run ? spec.run() : execute(spec));
      // Recarrega o acervo antes de encerrar o job, para a linha provisória não sumir antes do item real
      await forget(key);
      if (onItemSaved) await onItemSaved();
      patchJob(jobId, { status: warning ? 'warning' : 'done', message });
    } catch (err) {
      patchJob(jobId, { status: 'error', message: friendlyError(err, 'Falha ao processar a captura.') });
    }
  }

  function enqueue(spec) {
    const id = nextId('job');
    const base = { id, kind: spec.kind, label: spec.label, url: spec.url };

    if (spec.kind === 'link' && isLinkInFlight(spec.url)) {
      jobs = [...jobs, { ...base, status: 'skipped', message: 'Este link já está sendo processado.' }];
      emit();
      return { id, done: Promise.resolve() };
    }

    jobs = [...jobs, { ...base, status: 'processing', message: '' }];
    emit();
    if (!persistable(spec)) return { id, done: run(id, spec) };

    const key = spec.persistKey || id;
    const { persistKey: _key, attempts: _attempts, ...cleanSpec } = spec;
    const record = { key, enqueuedAt: spec.restoredAt || Date.now(), attempts: spec.attempts || 0, spec: cleanSpec };
    const done = pending.save(record).catch(() => {}).then(() => run(id, spec, key));
    return { id, done };
  }

  // Retoma as capturas que a recarga da página interrompeu (e as que falharam antes)
  async function restore() {
    let records = [];
    try {
      records = await pending.all();
    } catch {
      return;
    }
    const runs = [];
    for (const record of records) {
      if (!record?.key || !record.spec) continue;
      if ((record.attempts || 0) >= MAX_RESTORE_ATTEMPTS) {
        await forget(record.key);
        continue;
      }
      await pending.save({ ...record, attempts: (record.attempts || 0) + 1 }).catch(() => {});
      const { done } = enqueue({
        ...record.spec,
        label: record.spec.label || 'Captura retomada',
        persistKey: record.key,
        restoredAt: record.enqueuedAt,
        attempts: (record.attempts || 0) + 1
      });
      runs.push(done);
    }
    await Promise.all(runs);
  }

  function resolveAlert(alertId, decision) {
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert) return null;

    alerts = alerts.filter((a) => a.id !== alertId);
    persistAlerts();
    emit();

    if (decision !== 'reprocess') return null;
    return enqueue({
      kind: 'link',
      label: alert.label,
      url: alert.url,
      hint: alert.hint,
      skipDuplicateCheck: true
    });
  }

  function dismissJob(id) {
    jobs = jobs.filter((job) => job.id !== id);
    emit();
  }

  function hasActive() {
    return jobs.some((job) => job.status === 'processing');
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { enqueue, restore, resolveAlert, dismissJob, hasActive, subscribe, getSnapshot };
}
