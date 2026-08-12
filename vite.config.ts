import { defineConfig } from 'vite';

// Tauri serves this over a custom protocol in production, so assets must be relative.
export default defineConfig(({ mode }) => ({
  // Tauri loads over a custom protocol (relative), Vercel serves from root.
  base: mode === 'web' ? '/' : './',
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  build: {
    target: 'esnext',
    // Chromium (WebView2) / WebKit only — no legacy transpiling weight.
    minify: 'esbuild',
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1500,
  },
}));
