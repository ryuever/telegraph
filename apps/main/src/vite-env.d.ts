/// <reference types="vite/client" />

/**
 * Injected by @electron-forge/plugin-vite at build time.
 *
 * In dev mode (`electron-forge start`): the URL of the Vite renderer dev server
 * (e.g. "http://localhost:5174" — the actual resolved port, not the configured one).
 * In production builds: `undefined`.
 */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
