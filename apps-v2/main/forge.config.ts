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
          entry: 'src/application/electron-main/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/application/electron-browser/preload.ts',
          config: 'vite.preload.config.ts',
        },
        {
          entry: '../setting/src/application/electron-browser/preload.ts',
          config: 'vite.setting-preload.config.ts',
        },
        {
          entry: '../connection/src/application/node/main.ts',
          config: 'vite.connection.config.ts',
        },
        {
          entry: '../shared/src/application/node/main.ts',
          config: 'vite.shared.config.ts',
        },
        {
          entry: '../daemon/src/application/node/main.ts',
          config: 'vite.daemon.config.ts',
        },
        {
          entry: '../monitor/src/application/node/main.ts',
          config: 'vite.monitor.config.ts',
        },
        {
          entry: '../setting/src/application/node/main.ts',
          config: 'vite.setting.config.ts',
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
