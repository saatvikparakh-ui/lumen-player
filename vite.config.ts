import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Guard plugin: prevents accidental bundling of large installer binaries (> 5MB) into client assets
function guardPublicAssetSizes() {
  return {
    name: 'guard-public-asset-sizes',
    buildStart() {
      const publicDir = path.resolve(__dirname, 'public');
      if (fs.existsSync(publicDir)) {
        const files = fs.readdirSync(publicDir);
        for (const file of files) {
          const filePath = path.join(publicDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size > 5 * 1024 * 1024) {
            throw new Error(`[Build Security] Asset public/${file} is ${(stat.size / (1024 * 1024)).toFixed(1)} MB (exceeds 5 MB limit). Binaries must not be bundled in client assets.`);
          }
        }
      }
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), guardPublicAssetSizes()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2018', 'chrome79']
  }
});
