import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], publicDir: '../../packages/portal-ui/public', server: { port: 5178, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5180' } }, preview: { port: 4178, strictPort: true } });
