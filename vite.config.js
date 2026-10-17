import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [
    {
      name: 'app-version',
      transformIndexHtml: (html) => html.replaceAll('__APP_VERSION__', version)
    }
  ]
});
