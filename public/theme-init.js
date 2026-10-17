// Aplica o tema salvo antes da pintura (evita o "piscar"). Arquivo externo para a CSP não precisar de 'unsafe-inline'.
try {
  const t = localStorage.getItem('sb:theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* armazenamento indisponível: segue o sistema */ }
