import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], publicDir: '../../packages/portal-ui/public', server: { port: 5174, strictPort: true }, preview: { port: 4174, strictPort: true } });
