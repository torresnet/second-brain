import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertPublicUrl, safeFetchText } from '../../supabase/functions/_shared/ssrf.ts';

test('isPrivateIp reconhece faixas internas (v4 e v6)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1', '999.1.1.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '151.101.1.69', '2606:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('assertPublicUrl bloqueia esquemas, credenciais, hosts internos e DNS interno', async () => {
  const pub = async () => ['93.184.216.34'];
  const priv = async () => ['10.0.0.5'];
  await assert.rejects(assertPublicUrl('file:///etc/passwd', pub), /Protocolo/);
  await assert.rejects(assertPublicUrl('http://user:pw@exemplo.com', pub), /credenciais/);
  await assert.rejects(assertPublicUrl('http://localhost:8080', pub), /interno/);
  await assert.rejects(assertPublicUrl('http://media-fetcher:8080', pub), /interno/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest', pub), /interno/);
  await assert.rejects(assertPublicUrl('http://[::1]/', pub), /interno/);
  await assert.rejects(assertPublicUrl('https://exemplo.com', priv), /interno/);
  await assert.rejects(assertPublicUrl('https://exemplo.com', async () => { throw new Error('x'); }), /resolvido/);
  const ok = await assertPublicUrl('https://exemplo.com/a', pub);
  assert.equal(ok.hostname, 'exemplo.com');
});

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test('safeFetchText segue redirecionamento e revalida o destino', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://a.com/') return response('', { status: 302, headers: { location: 'https://b.com/final' } });
    return response('conteúdo', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const res = await safeFetchText('https://a.com/', { fetchImpl, resolve: async () => ['8.8.8.8'] });
  assert.equal(res.body, 'conteúdo');
  assert.equal(res.url, 'https://b.com/final');
  assert.deepEqual(calls, ['https://a.com/', 'https://b.com/final']);
});

test('safeFetchText bloqueia redirecionamento para rede interna', async () => {
  const fetchImpl = async () => response('', { status: 301, headers: { location: 'http://169.254.169.254/' } });
  await assert.rejects(safeFetchText('https://a.com/', { fetchImpl, resolve: async () => ['8.8.8.8'] }), /interno/);
});

test('safeFetchText limita redirecionamentos e tamanho', async () => {
  const loop = async () => response('', { status: 302, headers: { location: 'https://a.com/x' } });
  await assert.rejects(safeFetchText('https://a.com/', { fetchImpl: loop, resolve: async () => ['8.8.8.8'], maxRedirects: 2 }), /Redirecionamentos/);
  const big = async () => response('a'.repeat(5000));
  const res = await safeFetchText('https://a.com/', { fetchImpl: big, resolve: async () => ['8.8.8.8'], maxBytes: 1000 });
  assert.equal(res.truncated, true);
  assert.equal(res.body.length, 1000);
});

test('safeFetchText converte timeout em mensagem clara', async () => {
  const slow = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
  });
  await assert.rejects(safeFetchText('https://a.com/', { fetchImpl: slow, resolve: async () => ['8.8.8.8'], timeoutMs: 20 }), /Tempo esgotado/);
});

test('isPrivateIp: IPv6 normalizado pelo URL (mapeado, NAT64, 6to4, compatível) é tratado como interno', () => {
  for (const host of ['[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]', '[::127.0.0.1]', '[64:ff9b::7f00:1]', '[2002:7f00:1::]', '[2001:0:1234::1]', '[fe80::1]', '[::]']) {
    const normalized = new URL(`http://${host}/`).hostname.replace(/^\[|\]$/g, '');
    assert.equal(isPrivateIp(normalized), true, `${host} -> ${normalized}`);
  }
  for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('assertPublicUrl bloqueia IPv6 mapeado, portas incomuns e localhost com ponto final', async () => {
  const pub = async () => ['93.184.216.34'];
  await assert.rejects(assertPublicUrl('http://[::ffff:a9fe:a9fe]/', pub), /interno/);
  await assert.rejects(assertPublicUrl('https://exemplo.com:6379/', pub), /Porta/);
  await assert.rejects(assertPublicUrl('http://localhost./', pub), /interno/);
  assert.ok(await assertPublicUrl('https://exemplo.com:443/x', pub));
});
