export const APP_CONFIG = {
  name: 'Segundo Cérebro AI',
  version: '0.4.1',
  supabase: {
    url: 'https://eicmqisneklcvhakvgce.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpY21xaXNuZWtsY3ZoYWt2Z2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDYwNzYsImV4cCI6MjEwNzU4MjA3Nn0.Upgv8GrnpfwnwWNHsUDSM5S00PZQTJzLVcHsFvlZx0s'
  },
  // Webhook de ingestão no n8n. Definido em build via VITE_N8N_WEBHOOK_URL (a URL é pública no bundle;
  // a proteção real é o token de sessão validado pelo próprio workflow).
  n8n: {
    webhookUrl: import.meta.env.VITE_N8N_WEBHOOK_URL || ''
  },
  // `icon` é o nome do símbolo em shared/utils/icons.js; `color` pinta o ícone do tipo nas listas e no grafo
  mediaTypes: {
    all: { label: 'Todos', icon: 'globe' },
    reel: { label: 'Reels / Shorts', icon: 'play', color: 'var(--badge-reel)' },
    tiktok: { label: 'TikTok', icon: 'play', color: 'var(--badge-tiktok)' },
    youtube: { label: 'YouTube', icon: 'video', color: 'var(--badge-youtube)' },
    audio: { label: 'Áudio / Voz', icon: 'mic', color: 'var(--badge-audio)' },
    pdf: { label: 'PDF / Docs', icon: 'doc', color: 'var(--badge-pdf)' },
    article: { label: 'Artigo / Web', icon: 'link', color: 'var(--badge-article)' },
    note: { label: 'Nota Rápida', icon: 'note', color: 'var(--badge-note)' }
  }
};
