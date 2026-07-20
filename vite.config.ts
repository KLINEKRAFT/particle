import { defineConfig } from 'vite';

// Static-site friendly config. `base: './'` makes the production build work when
// served from a subpath (GitHub Pages project pages) as well as from a domain root
// (Vercel / Netlify).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 5173,
  },
});
