/**
 * Default Vite config for `vite` / `vite build` / `pnpm dev`.
 * Same as the Electron renderer build: Tailwind runs via PostCSS
 * (`postcss.config.mjs` + `src/renderer.css`), not `@tailwindcss/vite`.
 */
export { default } from './vite.renderer.config'
