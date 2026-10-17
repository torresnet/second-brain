import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../../n8n/second_brain_workflow.json', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = JSON.parse(readFileSync(WORKFLOW, 'utf8')).nodes.find(n => n.id === 'prepare-content').parameters.jsCode;

const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8'));

test('n8n: webhook recusa cedo requisição sem Bearer e não libera origem localhost', async () => {
  const gate = workflow.nodes.find(n => n.id === 'require-token').parameters.jsCode;
  const run = (headers) => new AsyncFunction('$input', gate)({ first: () => ({ json: { headers } }), all: () => [{ json: { headers } }] });
  await assert.rejects(run({}), /Não autenticado/);
  await assert.rejects(run({ authorization: 'Basic abc' }), /Não autenticado/);
  await assert.rejects(run({ authorization: 'Bearer ' }), /Não autenticado/);
  assert.equal((await run({ authorization: 'Bearer abc.def' })).length, 1);

  assert.deepEqual(workflow.connections['Webhook Captura'].main[0].map(c => c.node), ['Exigir Token']);
  assert.deepEqual(workflow.connections['Exigir Token'].main[0].map(c => c.node), ['Configuração']);
  const origins = workflow.nodes.find(n => n.id === 'webhook-trigger').parameters.options.allowedOrigins;
  assert.ok(!/localhost/.test(origins), origins);
});

const HTML =`<html><head><title>Página</title></head><body><article>${'texto legível '.repeat(80)}</article></body></html>`;

/** Executa o nó "Preparar Conteúdo" real com um httpRequest simulado. */
async function runNode(url, { pages = {}, dns = {}, failAaaa = false } = {}) {
  const pageCalls = [];
  const helpers = {
    async httpRequest(opts) {
      if (opts.url.startsWith('https://cloudflare-dns.com/')) {
        const q = new URL(opts.url).searchParams;
        if (q.get('type') === 'AAAA' && failAaaa) throw new Error('DoH 503');
        const answers = (dns[q.get('name')] ?? ['93.184.216.34']).filter(ip => (q.get('type') === 'AAAA') === ip.includes(':'));
        return { Answer: answers.map(data => ({ type: q.get('type') === 'A' ? 1 : 28, data })) };
      }
      pageCalls.push(opts);
      const page = pages[opts.url] ?? { statusCode: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(HTML) };
      return page;
    }
  };
  const input = { strategy: 'web', url, sourceType: 'article', fileBase64: null, fileMime: '' };
  const [{ json }] = await new AsyncFunction('$input', code).call({ helpers }, { first: () => ({ json: input }) });
  return { out: json, pageCalls };
}

const blocked = (res) => res.out.warnings.some(w => w.startsWith('Não foi possível acessar o link')) && res.pageCalls.length === 0;

test('n8n: endereços internos nunca são buscados', async () => {
  for (const url of [
    'http://127.0.0.1/', 'http://localhost/', 'http://media-fetcher:8080/health', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.5/', 'file:///etc/passwd', 'http://user:pw@exemplo.com/',
    'https://exemplo.com:8443/', 'http://servico.internal/'
  ]) {
    assert.ok(blocked(await runNode(url)), url);
  }
});

test('n8n: domínio público que resolve para IP interno é bloqueado', async () => {
  assert.ok(blocked(await runNode('https://rebind.exemplo.com/', { dns: { 'rebind.exemplo.com': ['10.0.0.5'] } })));
  assert.ok(blocked(await runNode('https://v6.exemplo.com/', { dns: { 'v6.exemplo.com': ['93.184.216.34', 'fd00::1'] } })));
});

test('n8n: falha na consulta AAAA bloqueia (não libera só com IPv4)', async () => {
  assert.ok(blocked(await runNode('https://exemplo.com/', { failAaaa: true })));
});

test('n8n: redirect de site público para IP interno é bloqueado no segundo salto', async () => {
  const res = await runNode('https://exemplo.com/', {
    pages: { 'https://exemplo.com/': { statusCode: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' }, body: Buffer.from('') } }
  });
  assert.equal(res.pageCalls.length, 1);
  assert.ok(res.out.warnings.some(w => w.includes('Endereço interno bloqueado')));
  assert.equal(res.out.pageText, '');
});

test('n8n: redirects não são seguidos automaticamente e têm limite', async () => {
  const loop = { statusCode: 302, headers: { location: 'https://exemplo.com/outra' }, body: Buffer.from('') };
  const res = await runNode('https://exemplo.com/a', { pages: { 'https://exemplo.com/a': loop, 'https://exemplo.com/outra': loop } });
  assert.ok(res.pageCalls.every(c => c.disableFollowRedirect === true));
  assert.ok(res.out.warnings.some(w => w.includes('Redirecionamentos demais')));
});

test('n8n: site público normal continua sendo lido', async () => {
  const res = await runNode('https://exemplo.com/artigo');
  assert.equal(res.pageCalls.length, 1);
  assert.ok(res.out.pageText.includes('texto legível'));
  assert.equal(res.out.warnings.length, 0);
});

test('n8n: redirect legítimo entre sites públicos é seguido e revalidado', async () => {
  const res = await runNode('http://exemplo.com/', {
    pages: { 'http://exemplo.com/': { statusCode: 301, headers: { location: 'https://www.exemplo.com/' }, body: Buffer.from('') } }
  });
  assert.equal(res.pageCalls.length, 2);
  assert.ok(res.out.pageText.includes('texto legível'));
});
