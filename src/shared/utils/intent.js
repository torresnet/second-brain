const URL_PATTERN = /https?:\/\/[^\s]+/i;
const QUESTION_START = /^(o que|oque|qual|quais|como|onde|quando|quem|quanto|quantos|por que|porque|pra que|para que|tem|existe|cadê|cade|me (mostra|mostre|diga|fala|ajuda|explica)|resuma|resume|explique|explica|liste|lista)(?=\s|$)/i;
const MIN_WORDS_FOR_QUESTION = 6;

/**
 * Descobre o que a pessoa quer com o texto da barra de comando:
 * link → capturar; pergunta → perguntar ao cérebro; termo curto → buscar no acervo.
 */
export function detectIntent(rawText) {
  const text = (rawText || '').trim();
  if (!text) return { kind: 'empty', text: '' };

  const match = text.match(URL_PATTERN);
  if (match) {
    const hint = text.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
    return { kind: 'capture', text, url: match[0], hint };
  }

  const wordCount = text.split(/\s+/).length;
  if (text.endsWith('?') || QUESTION_START.test(text) || wordCount >= MIN_WORDS_FOR_QUESTION) {
    return { kind: 'ask', text };
  }

  return { kind: 'search', text };
}
