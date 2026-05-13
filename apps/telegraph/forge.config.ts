// Forge config: main + preload + shared + daemon + design + monitor utilities + one renderer.
//
// Build entries:
//   - main: electron main process entry
//   - preload: context-bridge preload for renderer isolation
//   - shared: shared utility process (singleton, spawned by main)
//   - daemon: daemon utility process (singleton, spawned by main)
//   - design: design pagelet utility process
//   - monitor: monitor pagelet utility process
// All utility bundles are output as `.vite/build/{shared,daemon,design,monitor}_utility/index.js`.
// The spawners resolve entry paths relative to the main bundle's __dirname, which
// after vite build lands at `.vite/build/index.js` — so relative paths like
// `./shared_utility/index.js` are consistent across dev and packaged.
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
          entry: '../shared/src/main.ts',
          config: 'vite.shared.config.ts',
        },
        {
          entry: '../daemon/src/main.ts',
          config: 'vite.daemon.config.ts',
        },
        {
          entry: '../design/src/main.ts',
          config: 'vite.design.config.ts',
        },
        {
          entry: '../monitor/src/main.ts',
          config: 'vite.monitor.config.ts',
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
