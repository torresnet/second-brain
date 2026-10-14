export const APP_CONFIG = {
  name: 'Segundo Cérebro AI',
  version: '0.2.0',
  supabase: {
    url: 'https://eicmqisneklcvhakvgce.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpY21xaXNuZWtsY3ZoYWt2Z2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDYwNzYsImV4cCI6MjEwNzU4MjA3Nn0.Upgv8GrnpfwnwWNHsUDSM5S00PZQTJzLVcHsFvlZx0s'
  },
  // URL do webhook de ingestão no n8n (pode ser sobrescrita nas configurações do app)
  n8n: {
    defaultWebhookUrl: 'https://n8n.seu-servidor.com/webhook/second-brain-capture'
  },
  mediaTypes: {
    all: { label: 'Todos', icon: '🌐' },
    reel: { label: 'Reels / Shorts', icon: '📱', color: 'var(--badge-reel)' },
    youtube: { label: 'YouTube', icon: '🎥', color: 'var(--badge-youtube)' },
    audio: { label: 'Áudio / Voz', icon: '🎙️', color: 'var(--badge-audio)' },
    pdf: { label: 'PDF / Docs', icon: '📄', color: 'var(--badge-pdf)' },
    article: { label: 'Artigo / Web', icon: '📑', color: 'var(--badge-article)' },
    note: { label: 'Nota Rápida', icon: '📝', color: 'var(--badge-note)' }
  }
};
