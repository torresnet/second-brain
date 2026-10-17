import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent } from '../../src/shared/utils/intent.js';

test('texto vazio não tem intenção', () => {
  assert.deepEqual(detectIntent('   '), { kind: 'empty', text: '' });
});

test('link vira captura e o resto do texto vira contexto', () => {
  const intent = detectIntent('olha isso https://youtu.be/abc123 sobre n8n');
  assert.equal(intent.kind, 'capture');
  assert.equal(intent.url, 'https://youtu.be/abc123');
  assert.equal(intent.hint, 'olha isso sobre n8n');
});

test('link sozinho vira captura sem contexto', () => {
  const intent = detectIntent('https://www.instagram.com/reel/xyz/');
  assert.equal(intent.kind, 'capture');
  assert.equal(intent.hint, '');
});

test('frase terminada em interrogação vira pergunta', () => {
  assert.equal(detectIntent('webhook do whatsapp?').kind, 'ask');
});

test('frase começando com palavra interrogativa vira pergunta', () => {
  assert.equal(detectIntent('qual ferramenta eu salvei pra transcrever reels').kind, 'ask');
  assert.equal(detectIntent('Como configurar o pgvector').kind, 'ask');
  assert.equal(detectIntent('por que usar busca híbrida').kind, 'ask');
});

test('frase longa sem interrogação vira pergunta', () => {
  assert.equal(detectIntent('me ajuda a montar um fluxo de captura de leads no n8n').kind, 'ask');
});

test('termo curto vira busca', () => {
  const intent = detectIntent('  supabase rls ');
  assert.equal(intent.kind, 'search');
  assert.equal(intent.text, 'supabase rls');
});

test('palavra parecida com interrogativa não engana a detecção', () => {
  assert.equal(detectIntent('comandos git').kind, 'search');
  assert.equal(detectIntent('qualidade de vídeo').kind, 'search');
});
