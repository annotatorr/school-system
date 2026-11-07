import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], publicDir: '../../packages/portal-ui/public', server: { port: 5173, strictPort: true }, preview: { port: 4173, strictPort: true } });
