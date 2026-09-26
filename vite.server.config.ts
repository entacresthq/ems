import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * Bundles the desktop server (src/server) into one CommonJS file that Electron's
 * main process loads: electron/build/server.cjs. Built with the "desktop" env.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  publicDir: false,
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'electron/build',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'server.cjs' } },
  },
  // Bundle every dependency: the packaged app ships without node_modules.
  ssr: { noExternal: true, target: 'node' },
})
