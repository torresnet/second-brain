import { supabase } from './supabaseClient.js';
import { buildErrorEntry } from '../utils/errorLog.js';

const DEFAULT_LIMIT = 100;
const CHANGE_EVENT = 'capture-errors-changed';

function notifyChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Avisa quando o log muda (nova falha, resolvida, apagada) para atualizar contadores e telas. */
export function onCaptureErrorsChange(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

/**
 * Registra uma falha ou aviso da captura. Nunca lança: o log não pode atrapalhar o salvamento da nota.
 * Devolve true quando gravou.
 */
export async function logCaptureError(input) {
  try {
    const { error } = await supabase.from('capture_errors').insert(buildErrorEntry(input));
    if (error) throw error;
    notifyChange();
    return true;
  } catch (err) {
    console.error('Não foi possível registrar a falha no log:', err?.message ?? err);
    return false;
  }
}

/**
 * Lista falhas, da mais recente para a mais antiga.
 * status: 'open' (pendentes) | 'resolved' | 'all'
 */
export async function getCaptureErrors({ status = 'open', stage = '', severity = '', limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  let query = supabase
    .from('capture_errors')
    .select('id,created_at,stage,category,severity,source_type,item_id,message,detail,resolved_at,brain_items(title)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status === 'open') query = query.is('resolved_at', null);
  if (status === 'resolved') query = query.not('resolved_at', 'is', null);
  if (stage) query = query.eq('stage', stage);
  if (severity) query = query.eq('severity', severity);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

/** Falhas pendentes (0 se a migration ainda não foi aplicada, para não quebrar o app). */
export async function getOpenCaptureErrorCount() {
  const { count, error } = await supabase
    .from('capture_errors')
    .select('id', { count: 'exact', head: true })
    .is('resolved_at', null)
    .eq('severity', 'error');
  return error ? 0 : (count || 0);
}

export async function setCaptureErrorResolved(id, resolved = true) {
  const { error } = await supabase
    .from('capture_errors')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw new Error(error.message);
  notifyChange();
}

export async function resolveAllCaptureErrors() {
  const { error } = await supabase
    .from('capture_errors')
    .update({ resolved_at: new Date().toISOString() })
    .is('resolved_at', null);
  if (error) throw new Error(error.message);
  notifyChange();
}

export async function deleteResolvedCaptureErrors() {
  const { error } = await supabase.from('capture_errors').delete().not('resolved_at', 'is', null);
  if (error) throw new Error(error.message);
  notifyChange();
}
