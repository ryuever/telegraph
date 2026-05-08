// Phase 3 — Forge config: main + preload + design utility + one renderer.
//
// The `design_utility` build entry is the third bundle, output as
// `.vite/build/design_utility/index.js`. `DesignPageletProcess` (main side)
// resolves the entry path relative to its own __dirname, which after vite
// build also lands at `.vite/build/index.js` — so the relative path
// `./design_utility/index.js` is the same in dev and packaged.
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [new MakerSquirrel({}), new MakerZIP({}, ['darwin']), new MakerRpm({}), new MakerDeb({})],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/application/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/application/preload/preload.ts',
          config: 'vite.preload.config.ts',
        },
        {
          entry: '../design/src/main.ts',
          config: 'vite.design.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
