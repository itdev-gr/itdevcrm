import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        // Split only the always-eager vendor deps (React, router, data layer)
        // into their own long-lived cache chunks, trimming the main entry bundle.
        // Everything else (incl. the heavy lazy-route deps: xlsx, cytoscape,
        // katex, html2canvas) is left to default chunking so it stays lazy —
        // a blanket vendor rule would hoist those into the initial load.
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id))
            return 'react-vendor';
          if (/[\\/]node_modules[\\/](@supabase|@tanstack)[\\/]/.test(id)) return 'data-vendor';
          // App-wide UI utilities (icons + class helpers) — eager via shared
          // components. recharts/@dnd-kit are intentionally NOT here: they live
          // only in lazy routes and must stay lazy.
          if (/[\\/]node_modules[\\/](lucide-react|clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id))
            return 'ui-vendor';
          return undefined;
        },
      },
    },
  },
});
