import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { VitePlugin } from '@electron-forge/plugin-vite'

const config: ForgeConfig = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'app/application/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'app/application/preload/px.ts',
          config: 'vite.preload.config.ts',
        },
        {
          entry: 'app/services/process/shared-process/node/shared-process-bootstrap.ts',
          config: 'vite.fork.config.ts',
        },
        {
          entry: 'app/services/process/daemon-process/node/daemon-process-bootstrap.ts',
          config: 'vite.fork.config.ts',
        },
        {
          entry: 'app/services/process/pagelet-process/node/pagelet-process-bootstrap.ts',
          config: 'vite.fork.config.ts',
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
}

export default config
