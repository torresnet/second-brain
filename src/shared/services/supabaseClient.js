import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../constants/config.js';
import { sanitizeFilterTerm } from '../utils/postgrest.js';

export const supabase = createClient(
  APP_CONFIG.supabase.url,
  APP_CONFIG.supabase.anonKey
);

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

/**
 * Busca todos os itens catalogados no Segundo Cérebro com filtros opcionais
 */
export async function getBrainItems({ type = 'all', search = '', tag = '' } = {}) {
  let query = supabase
    .from('brain_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (type && type !== 'all') {
    query = query.eq('source_type', type);
  }

  if (tag) {
    query = query.contains('tags', [tag]);
  }

  if (search && search.trim() !== '') {
    const term = `%${sanitizeFilterTerm(search)}%`;
    query = query.or(`title.ilike.${term},summary.ilike.${term},raw_content.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Erro ao buscar itens do Segundo Cérebro:', error);
    throw error;
  }
  return data || [];
}

/**
 * Busca estatísticas agregadas (total de itens, favoritos, distribuição por tipo)
 */
export async function getBrainStats() {
  const { data, error } = await supabase
    .from('brain_items')
    .select('id, source_type, is_favorite, tags');

  if (error) {
    console.error('Erro ao calcular estatísticas:', error);
    return { total: 0, favorites: 0, byType: {}, topTags: [], topTagCounts: [] };
  }

  const stats = {
    total: data.length,
    favorites: data.filter(i => i.is_favorite).length,
    byType: {},
    topTags: [],
    topTagCounts: []
  };

  const tagCount = {};
  data.forEach(item => {
    stats.byType[item.source_type] = (stats.byType[item.source_type] || 0) + 1;
    if (Array.isArray(item.tags)) {
      item.tags.forEach(t => {
        tagCount[t] = (tagCount[t] || 0) + 1;
      });
    }
  });

  stats.topTagCounts = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  stats.topTags = stats.topTagCounts.map(([tag]) => tag);

  return stats;
}

/**
 * Cria uma anotação ou item diretamente no Supabase
 */
export async function insertBrainItem(item) {
  const { data, error } = await supabase
    .from('brain_items')
    .insert([item])
    .select()
    .single();

  if (error) {
    console.error('Erro ao inserir item no Supabase:', error);
    throw error;
  }
  return data;
}

/**
 * Alterna status de favorito
 */
export async function toggleItemFavorite(id, currentStatus) {
  const { data, error } = await supabase
    .from('brain_items')
    .update({ is_favorite: !currentStatus })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Erro ao favoritar item:', error);
    throw error;
  }
  return data;
}

/**
 * Remove um item do Segundo Cérebro
 */
export async function deleteBrainItem(id) {
  const { error } = await supabase
    .from('brain_items')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Erro ao excluir item:', error);
    throw error;
  }
  return true;
}

/**
 * Chama uma Edge Function do Supabase e devolve mensagens de erro compreensíveis em PT-BR
 */
async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;

  const status = error.context?.status;
  if (status === 404) {
    throw new Error(`A função "${name}" ainda não foi publicada no Supabase.`);
  }
  if (status === 401 || status === 403) {
    throw new Error('Sessão expirada ou sem permissão. Entre novamente.');
  }
  let message = '';
  try {
    message = (await error.context?.json?.())?.error || '';
  } catch {
    message = '';
  }
  throw new Error(message || `Não foi possível falar com a função "${name}".`);
}

/**
 * Pergunta ao Segundo Cérebro (busca híbrida + resposta em PT-BR com fontes)
 */
export async function askBrain(question, history = []) {
  return invokeFunction('brain-ask', { question, history });
}

/**
 * Reprocessa um item: átomos de conhecimento, varredura de links e índice de busca
 */
export async function processItemKnowledge(itemId) {
  return invokeFunction('brain-process', { item_id: itemId });
}

/**
 * Processa itens pendentes (lotes pequenos). Devolve { results, remaining }
 */
export async function processPendingItems(limit = 1) {
  return invokeFunction('brain-process', { mode: 'pending', limit });
}

const ATOM_COLUMNS =
  'id,item_id,kind,name,content,explanation,use_for,url,language,inferred,fetch_status,fetch_error,contents_summary,tags,created_at,brain_items(title)';

/**
 * Lista átomos de conhecimento (ferramentas, links, códigos, ideias...) com filtros
 */
export async function getAtoms({ kind = '', search = '', limit = 40, offset = 0 } = {}) {
  let query = supabase
    .from('brain_atoms')
    .select(ATOM_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id')
    .range(offset, offset + limit - 1);

  if (kind) query = query.eq('kind', kind);

  const term = sanitizeFilterTerm(search);
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      ['name', 'explanation', 'use_for', 'url', 'content', 'contents_summary'].map(c => `${c}.ilike.${like}`).join(',')
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Átomos de um item específico (para a ficha da nota)
 */
export async function getItemAtoms(itemId) {
  const { data, error } = await supabase
    .from('brain_atoms')
    .select(ATOM_COLUMNS)
    .eq('item_id', itemId)
    .order('created_at', { ascending: true })
    .order('id');
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Panorama do acervo: totais por categoria, tipo de fonte e tipo de átomo
 */
export async function getBrainOverview() {
  const { data, error } = await supabase.rpc('brain_overview');
  if (error) throw new Error(error.message);
  return data || {};
}

/**
 * Avisa a cada mudança em brain_items (inclusive status de processamento/indexação). Devolve a função que cancela.
 */
export function subscribeToItemChanges(onChange) {
  const channel = supabase
    .channel('brain-items-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'brain_items' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function getBrainItemById(id) {
  const { data, error } = await supabase.from('brain_items').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Quantos itens ainda aguardam a indexação avançada (0 se a migração ainda não foi aplicada)
 */
export async function getPendingIndexCount() {
  const { count, error } = await supabase
    .from('brain_items')
    .select('id', { count: 'exact', head: true })
    .eq('analysis_status', 'pending');
  return error ? 0 : (count || 0);
}

/**
 * Ligações entre notas (citam a mesma coisa ou têm assunto parecido).
 * `failed` só é true em erro real (rede, permissão): se a migração ainda não foi aplicada,
 * devolve [] sem alarde e o grafo segue só com tags/entidades.
 * @returns {Promise<{links: object[], failed: boolean}>}
 */
export async function getItemLinks({ minSimilarity } = {}) {
  const params = minSimilarity === undefined ? {} : { p_min_similarity: minSimilarity };
  const { data, error } = await supabase.rpc('brain_item_links', params);
  if (!error) return { links: data || [], failed: false };
  const missing = error.code === 'PGRST202' || error.code === '42883';
  return { links: [], failed: !missing };
}

/**
 * Já existe nota com este link? (compara o link normalizado: sem www, utm, barra final...)
 * Devolve [] se a migração ainda não foi aplicada, para não impedir a captura.
 */
export async function findDuplicatesByUrl(url) {
  const { data, error } = await supabase.rpc('brain_find_duplicates_by_url', { p_url: url });
  return error ? [] : (data || []);
}

/**
 * Notas com o mesmo link ou muito parecidas com esta (ainda sem decisão do usuário)
 */
export async function getPossibleDuplicates(itemId, minSimilarity = 0.9) {
  const { data, error } = await supabase.rpc('brain_possible_duplicates', {
    p_item_id: itemId,
    p_min_similarity: minSimilarity
  });
  return error ? [] : (data || []);
}

/**
 * Todos os pares de notas duplicadas (mesmo link ou muito parecidas) ainda sem decisão.
 * `unavailable` indica que a migração 20261021110000_duplicate_pairs.sql ainda não foi aplicada.
 */
export async function getDuplicatePairs({ minSimilarity = 0.9, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('brain_duplicate_pairs', {
    p_min_similarity: minSimilarity,
    p_limit: limit
  });
  if (!error) return { pairs: data || [], unavailable: false };
  if (error.code === 'PGRST202' || error.code === '42883') return { pairs: [], unavailable: true };
  throw new Error(error.message);
}

/**
 * "Manter as duas": o aviso deste par não aparece mais
 */
export async function setDuplicateDecision(itemA, itemB) {
  const { error } = await supabase.rpc('brain_set_duplicate_decision', { p_a: itemA, p_b: itemB });
  if (error) throw new Error(error.message);
}

/**
 * Junta a nota `removeId` na nota `keepId` (conteúdo, tags, entidades) e apaga `removeId`
 */
export async function mergeItems(keepId, removeId) {
  const { error } = await supabase.rpc('brain_merge_items', { p_keep: keepId, p_remove: removeId });
  if (error) throw new Error(error.message);
}
