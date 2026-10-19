// Importa um vault do Obsidian para o Segundo Cérebro (tabela brain_items).
//   node scripts/import-obsidian.mjs [--vault <pasta>] [--include-moc] [--all]          simula (não grava nada)
//   SB_EMAIL=... SB_PASSWORD=... node scripts/import-obsidian.mjs --apply                grava
// Reexecutar é seguro: notas já importadas (mesmo caminho no vault) são puladas.
// As notas entram como "pendentes"; clique em "Indexar agora" no app para gerar átomos e vetores de busca.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { noteToItem } from '../src/shared/utils/obsidianImport.js';

const DEFAULT_VAULT = 'D:\\OneDrive\\Obsidian Segundo Cérebro';
const ROOT_FOLDER = 'Achados na internet';
const CONTENT_FOLDERS = ['Notas', 'Conceitos', 'Setup', 'Projetos'];
const MOC_FOLDER = 'MOCs';
const IGNORED_FOLDERS = new Set(['.obsidian', '_to_delete', '_raspagem', '__pycache__', 'node_modules']);
const BATCH_MAX_ROWS = 20;
const BATCH_MAX_BYTES = 1_500_000;
const PAGE_SIZE = 1000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at > -1 && args[at + 1] ? args[at + 1] : fallback;
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function readAnonKeyFromConfig() {
  const text = readFileSync(new URL('../src/shared/constants/config.js', import.meta.url), 'utf8');
  return text.match(/anonKey:\s*'([^']+)'/)?.[1];
}

function listMarkdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED_FOLDERS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdown(full);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [full] : [];
  });
}

function selectFolders() {
  if (flag('--all')) return [''];
  return [...CONTENT_FOLDERS, ...(flag('--include-moc') ? [MOC_FOLDER] : [])].map((f) => join(ROOT_FOLDER, f));
}

function readNotes(vault) {
  const files = selectFolders().flatMap((folder) => {
    const dir = join(vault, folder);
    try {
      return listMarkdown(dir);
    } catch {
      console.warn(`Pasta não encontrada, ignorada: ${folder || vault}`);
      return [];
    }
  });
  return files.map((file) => {
    const relPath = relative(vault, file);
    return { relPath, item: noteToItem({ relPath, text: readFileSync(file, 'utf8'), mtime: statSync(file).mtime }) };
  });
}

const countBy = (items, pick) => items.reduce((acc, item) => ({ ...acc, [pick(item)]: (acc[pick(item)] ?? 0) + 1 }), {});

function printSummary(items, emptyNotes) {
  const totalLinks = items.reduce((sum, i) => sum + i.entities.length, 0);
  console.log(`\nNotas a importar: ${items.length}  (vazias ignoradas: ${emptyNotes.length})`);
  console.log('Por tipo de mídia:', countBy(items, (i) => i.source_type));
  console.log('Por estágio:', countBy(items, (i) => i.stage));
  console.log(`Favoritas (⭐): ${items.filter((i) => i.is_favorite).length} | com link de origem: ${items.filter((i) => i.source_url).length}`);
  console.log(`Wikilinks viram entidades: ${totalLinks} no total (${(totalLinks / Math.max(items.length, 1)).toFixed(1)} por nota)`);
  const sample = items[0];
  if (sample) {
    console.log('\nExemplo:', JSON.stringify({ ...sample, raw_content: `${sample.raw_content.slice(0, 120)}…` }, null, 2));
  }
}

async function loadExistingPaths(supabase) {
  const paths = new Set();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('brain_items')
      .select('path:metadata->obsidian->>path')
      .not('metadata->obsidian->>path', 'is', null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail(`Não foi possível ler as notas já importadas: ${error.message}`);
    data.forEach((row) => paths.add(row.path));
    if (data.length < PAGE_SIZE) return paths;
  }
}

function toBatches(items) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const item of items) {
    const size = item.raw_content.length;
    if (current.length && (current.length >= BATCH_MAX_ROWS || bytes + size > BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current = [...current, item];
    bytes += size;
  }
  return current.length ? [...batches, current] : batches;
}

async function insertBatch(supabase, batch) {
  const { error } = await supabase.from('brain_items').insert(batch);
  if (!error) return { saved: batch.length, failed: [] };
  // Isola a nota problemática: regrava uma a uma para não perder o lote inteiro
  const failed = [];
  let saved = 0;
  for (const row of batch) {
    const { error: rowError } = await supabase.from('brain_items').insert(row);
    if (rowError) failed.push({ path: row.metadata.obsidian.path, reason: rowError.message });
    else saved++;
  }
  return { saved, failed };
}

async function apply(items) {
  const { SB_EMAIL, SB_PASSWORD } = process.env;
  if (!SB_EMAIL || !SB_PASSWORD) fail('Defina SB_EMAIL e SB_PASSWORD (login do dono do cérebro) para usar --apply.');
  const supabase = createClient(
    process.env.SB_URL || 'https://eicmqisneklcvhakvgce.supabase.co',
    process.env.SB_ANON_KEY || readAnonKeyFromConfig(),
    { auth: { persistSession: false } }
  );
  const { error: loginError } = await supabase.auth.signInWithPassword({ email: SB_EMAIL, password: SB_PASSWORD });
  if (loginError) fail(`Login falhou: ${loginError.message}`);

  const existing = await loadExistingPaths(supabase);
  const fresh = items.filter((i) => !existing.has(i.metadata.obsidian.path));
  console.log(`\nJá importadas antes: ${items.length - fresh.length} | novas: ${fresh.length}`);

  let saved = 0;
  const failed = [];
  for (const batch of toBatches(fresh)) {
    const result = await insertBatch(supabase, batch);
    saved += result.saved;
    failed.push(...result.failed);
    console.log(`  ${saved}/${fresh.length} gravadas`);
  }
  console.log(`\nConcluído: ${saved} gravadas, ${failed.length} com falha.`);
  failed.forEach((f) => console.log(`  FALHA ${f.path}: ${f.reason}`));
  if (saved) console.log('\nPróximo passo: abra o app e clique em "Indexar agora" para gerar a busca e as ligações por IA.');
  if (failed.length) process.exitCode = 1;
}

const vault = option('--vault', DEFAULT_VAULT);
try {
  statSync(vault);
} catch {
  fail(`Vault não encontrado: ${vault}`);
}

const notes = readNotes(vault);
const items = notes.filter((n) => n.item).map((n) => n.item);
printSummary(items, notes.filter((n) => !n.item));

if (flag('--apply')) await apply(items);
else console.log('\nSimulação: nada foi gravado. Rode com --apply (e SB_EMAIL/SB_PASSWORD) para importar.');
