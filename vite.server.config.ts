import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * Bundles the EMS server (src/server) into build/server/:
 *   main.cjs  runs the server (web deployments; the desktop app starts one per workspace)
 *   ems.cjs   the server as a library, for the desktop app's connection tools
 * Everything is bundled, so neither needs node_modules.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  publicDir: false,
  build: {
    ssr: true,
    outDir: 'build/server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: { main: 'src/server/main.ts', ems: 'src/server/index.ts' },
      // pg looks for an optional native driver that EMS doesn't use.
      external: ['pg-native'],
      output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: '[name]-[hash].cjs' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
