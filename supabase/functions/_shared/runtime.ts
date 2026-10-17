// Código específico do Deno / Supabase Edge Runtime (não roda nos testes em Node).

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AskDeps, AtomRow, ItemBrief, SearchHit } from './ask.ts';
import { createGemini } from './gemini.ts';
import type { Gemini } from './gemini.ts';
import type { ChunkInput, ItemRow, ProcessStore } from './process.ts';
import { safeFetchText } from './ssrf.ts';
import type { DnsResolver } from './ssrf.ts';
import type { SafeFetch } from './crawl.ts';

const DEFAULT_ORIGINS = ['https://2cerebro.scaladigital.com.br', 'http://localhost:5173', 'http://localhost:4173'];

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS')?.split(',').map(o => o.trim()).filter(Boolean)) ?? DEFAULT_ORIGINS;
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders(req) }) : null;
}

export async function readJson(req: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Valida o token da sessão e confirma que é o dono do cérebro (mesma regra do RLS). */
export async function requireOwner(req: Request): Promise<{ supabase: SupabaseClient } | { error: Response }> {
  const authorization = req.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return { error: json(req, { error: 'Não autenticado.' }, 401) };

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return { error: json(req, { error: 'Servidor sem configuração do Supabase.' }, 500) };

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.rpc('owner_check');
  if (error) return { error: json(req, { error: 'Sessão inválida ou expirada.' }, 401) };
  if (data?.is_owner !== true) return { error: json(req, { error: 'Acesso negado.' }, 403) };
  return { supabase };
}

export function geminiFromEnv(): Gemini | null {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;
  return createGemini({
    apiKey,
    model: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash',
    embeddingModel: Deno.env.get('GEMINI_EMBEDDING_MODEL') ?? 'gemini-embedding-001'
  });
}

// Resolve DNS por DNS-over-HTTPS para barrar nomes públicos que apontam para IPs internos
const dohResolver: DnsResolver = async host => {
  const query = async (type: 'A' | 'AAAA'): Promise<string[]> => {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }
    });
    if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
    const body = await res.json();
    return (body.Answer ?? [])
      .filter((a: { type: number }) => a.type === (type === 'A' ? 1 : 28))
      .map((a: { data: string }) => a.data);
  };
  const [v4, v6] = await Promise.all([query('A'), query('AAAA').catch(() => [] as string[])]);
  return [...v4, ...v6];
};

export const safeFetch: SafeFetch = (url, headers) => safeFetchText(url, { resolve: dohResolver, headers });

const ITEM_COLUMNS = 'id,title,summary,source_type,source_url,raw_content,key_takeaways,entities,tags,metadata,analysis_status';

export function createProcessStore(supabase: SupabaseClient): ProcessStore {
  return {
    async getItem(id) {
      const { data, error } = await supabase.from('brain_items').select(ITEM_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw new Error(`Falha ao ler o item: ${error.message}`);
      return (data as ItemRow | null) ?? null;
    },
    async claim(id) {
      const { data, error } = await supabase.rpc('brain_claim_item', { p_item_id: id });
      if (error) throw new Error(`Falha ao reservar o item: ${error.message}`);
      return data === true;
    },
    async replace(args) {
      const { data, error } = await supabase.rpc('brain_replace_item_knowledge', {
        p_item_id: args.itemId,
        p_atoms: args.atoms,
        p_chunks: args.chunks.map((c: ChunkInput) => ({
          ...c,
          embedding: c.embedding ? c.embedding.map(v => Math.round(v * 1e5) / 1e5) : null
        })),
        p_category: args.category,
        p_use_cases: args.useCases,
        p_status: args.status,
        p_error: args.error
      });
      if (error) throw new Error(`Falha ao gravar o conhecimento: ${error.message}`);
      return data as { atoms: number; chunks: number };
    },
    async markFailed(id, message) {
      await supabase
        .from('brain_items')
        .update({ analysis_status: 'failed', analysis_error: message, analysis_attempts: 0, analysis_updated_at: new Date().toISOString() })
        .eq('id', id);
    }
  };
}

const ATOM_COLUMNS =
  'id,item_id,kind,name,content,explanation,use_for,url,language,inferred,fetch_status,fetch_error,contents_summary';
const ITEM_BRIEF_COLUMNS = 'id,title,summary,source_type,source_url,category';

export function createAskDeps(supabase: SupabaseClient, gemini: Gemini): AskDeps {
  return {
    gemini,
    async search({ embedding, queryText, keywords, count, kinds }) {
      const { data, error } = await supabase.rpc('search_brain', {
        query_embedding: embedding,
        query_text: queryText,
        keywords,
        match_count: count,
        filter_kinds: kinds,
        filter_category: null
      });
      if (error) throw new Error(`Falha na busca: ${error.message}`);
      return (data ?? []) as SearchHit[];
    },
    async loadContext(atomIds, itemIds) {
      const [atoms, items] = await Promise.all([
        atomIds.length
          ? supabase.from('brain_atoms').select(ATOM_COLUMNS).in('id', atomIds.slice(0, 60))
          : Promise.resolve({ data: [], error: null }),
        supabase.from('brain_items').select(ITEM_BRIEF_COLUMNS).in('id', itemIds.slice(0, 60))
      ]);
      if (atoms.error) throw new Error(`Falha ao ler átomos: ${atoms.error.message}`);
      if (items.error) throw new Error(`Falha ao ler itens: ${items.error.message}`);
      return { atoms: (atoms.data ?? []) as AtomRow[], items: (items.data ?? []) as ItemBrief[] };
    },
    async overview() {
      const { data, error } = await supabase.rpc('brain_overview');
      if (error) throw new Error(`Falha no panorama: ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    }
  };
}
