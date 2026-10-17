import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../constants/config.js';

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
    const term = `%${search.trim()}%`;
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
    return { total: 0, favorites: 0, byType: {}, topTags: [] };
  }

  const stats = {
    total: data.length,
    favorites: data.filter(i => i.is_favorite).length,
    byType: {},
    topTags: []
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

  stats.topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  return stats;
}

/**
 * Busca semântica vetorial através da função RPC do Supabase
 */
export async function searchBrainSemantics(queryEmbedding, threshold = 0.25, count = 6) {
  const { data, error } = await supabase.rpc('match_brain_chunks', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: count
  });

  if (error) {
    console.error('Erro na busca semântica vetorial:', error);
    throw error;
  }
  return data || [];
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
