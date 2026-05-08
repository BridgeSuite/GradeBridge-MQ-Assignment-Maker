import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Repo name on github.com/VeriQAi for gh-pages base path
const REPO = 'GradeBridge-MQ-Assignment-Maker';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? `/${REPO}/` : '/',
}));
