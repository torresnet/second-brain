import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilterTerm } from '../../src/shared/utils/postgrest.js';
import { parseSharedParams } from '../../src/shared/utils/sharedParams.js';

test('filtro PostgREST: remove aspas e demais caracteres de sintaxe', () => {
  assert.equal(sanitizeFilterTerm('  gato "preto", (casa)  *%\\ '), 'gato preto casa');
  assert.equal(sanitizeFilterTerm('a"b'), 'a b');
  assert.equal(sanitizeFilterTerm(null), '');
  assert.equal(sanitizeFilterTerm("D'Água"), "D'Água");
});

test('parâmetros de compartilhamento: só shared_* contam', () => {
  assert.equal(parseSharedParams('?url=https://evil.example').hasAny, false);
  assert.equal(parseSharedParams('?text=oi&title=x').hasAny, false);
  const ok = parseSharedParams('?shared_url=https%3A%2F%2Fexemplo.com&shared_title=T&shared_text=txt');
  assert.deepEqual(ok, { url: 'https://exemplo.com', title: 'T', text: 'txt', hasFile: false, hasAny: true });
  assert.equal(parseSharedParams('?shared_file=1').hasAny, true);
  assert.equal(parseSharedParams('?shared_file=2').hasAny, false);
  assert.equal(parseSharedParams('').hasAny, false);
});
