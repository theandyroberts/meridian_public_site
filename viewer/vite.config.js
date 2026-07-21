import { defineConfig } from 'vite'

// The viewer is served as a static app from the site at /stage/ (embedded in
// an iframe by web/app/stage/page.tsx). A relative base makes the built app
// self-contained so every asset URL resolves under /stage/ regardless of host.
// All runtime asset loads (models, draco) use import.meta.env.BASE_URL.
export default defineConfig({
  base: './',
  build: {
    outDir: '../web/public/stage',
    emptyOutDir: true,
  },
})
