// Avalia se o Segundo Cérebro consegue recuperar o que já tem salvo.
//   SB_EMAIL=... SB_PASSWORD=... node scripts/eval-recall.mjs [--sample 30]
// 1) auto-teste: sorteia átomos e faz uma das perguntas que a IA previu para cada um;
//    passa se a nota de origem aparecer nas fontes da resposta.
// 2) perguntas manuais de tests/eval/questions.json (opcional).
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SB_URL || 'https://eicmqisneklcvhakvgce.supabase.co';
const ANON_KEY = process.env.SB_ANON_KEY || readAnonKeyFromConfig();
const { SB_EMAIL, SB_PASSWORD } = process.env;

function readAnonKeyFromConfig() {
  const text = readFileSync(new URL('../src/shared/constants/config.js', import.meta.url), 'utf8');
  return text.match(/anonKey:\s*'([^']+)'/)?.[1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SB_EMAIL || !SB_PASSWORD) fail('Defina SB_EMAIL e SB_PASSWORD (login do dono do cérebro).');
const sampleArg = process.argv.indexOf('--sample');
const SAMPLE = sampleArg > -1 ? Math.max(1, Number(process.argv[sampleArg + 1]) || 20) : 20;

const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { error: loginError } = await supabase.auth.signInWithPassword({ email: SB_EMAIL, password: SB_PASSWORD });
if (loginError) fail(`Login falhou: ${loginError.message}`);

async function ask(question) {
  const { data, error } = await supabase.functions.invoke('brain-ask', { body: { question, history: [] } });
  if (error) throw new Error(error.message);
  return data;
}

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

let passed = 0;
let total = 0;

const { data: atoms, error: atomsError } = await supabase
  .from('brain_atoms')
  .select('id,item_id,kind,name,questions')
  .not('questions', 'eq', '{}')
  .limit(2000);
if (atomsError) fail(`Não foi possível ler os átomos: ${atomsError.message}`);

console.log(`\n== Auto-teste de recuperação (${Math.min(SAMPLE, atoms.length)} de ${atoms.length} átomos) ==`);
for (const atom of shuffle(atoms).slice(0, SAMPLE)) {
  const question = shuffle(atom.questions)[0];
  total++;
  try {
    const result = await ask(question);
    const hit = (result.sources || []).some(s => s.item_id === atom.item_id);
    if (hit) passed++;
    console.log(`${hit ? 'OK  ' : 'FALHA'} [${atom.kind}] ${atom.name} <- "${question}"`);
  } catch (error) {
    console.log(`ERRO  "${question}": ${error.message}`);
  }
}

const manualPath = new URL('../tests/eval/questions.json', import.meta.url);
if (existsSync(manualPath)) {
  const manual = JSON.parse(readFileSync(manualPath, 'utf8'));
  console.log(`\n== Perguntas manuais (${manual.length}) ==`);
  for (const { question, must_include = [] } of manual) {
    total++;
    try {
      const result = await ask(question);
      const haystack = `${result.answer} ${(result.sources || []).map(s => s.title).join(' ')}`.toLowerCase();
      const missing = must_include.filter(t => !haystack.includes(String(t).toLowerCase()));
      if (!missing.length) passed++;
      console.log(`${missing.length ? 'FALHA' : 'OK  '} "${question}"${missing.length ? ` (faltou: ${missing.join(', ')})` : ''}`);
    } catch (error) {
      console.log(`ERRO  "${question}": ${error.message}`);
    }
  }
}

console.log(`\nResultado: ${passed}/${total} (${total ? Math.round((passed / total) * 100) : 0}%)`);
process.exit(passed === total ? 0 : 2);
