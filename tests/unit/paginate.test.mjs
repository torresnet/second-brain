import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from '../../src/shared/utils/paginate.js';

const source = (total) => Array.from({ length: total }, (_, i) => i);
const pager = (rows, calls = []) => async (from, to) => {
  calls.push([from, to]);
  return { data: rows.slice(from, to + 1), error: null };
};

test('junta todas as páginas quando há mais de 1000 linhas', async () => {
  const calls = [];
  const { data, error } = await fetchAllPages(pager(source(2500), calls), 1000);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('para após uma página incompleta', async () => {
  const calls = [];
  const { data } = await fetchAllPages(pager(source(40), calls), 1000);
  assert.equal(data.length, 40);
  assert.equal(calls.length, 1);
});

test('pede uma página extra quando o total é múltiplo exato do tamanho', async () => {
  const calls = [];
  const { data } = await fetchAllPages(pager(source(2000), calls), 1000);
  assert.equal(data.length, 2000);
  assert.equal(calls.length, 3);
});

test('devolve o erro de qualquer página sem dados parciais', async () => {
  const boom = new Error('rede');
  const fetchPage = async (from) => (from === 0
    ? { data: source(1000), error: null }
    : { data: null, error: boom });
  const result = await fetchAllPages(fetchPage, 1000);
  assert.equal(result.error, boom);
  assert.equal(result.data, null);
});

test('trata data nula como página vazia', async () => {
  const { data, error } = await fetchAllPages(async () => ({ data: null, error: null }), 1000);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});
