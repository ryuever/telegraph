module.exports = function babelConfig(api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        extensions: ['.ios.ts', '.android.ts', '.ts', '.ios.tsx', '.android.tsx', '.tsx', '.js', '.jsx', '.json'],
        alias: {
          '@/apps/mobile': './src',
          '@/apps/remote-control': '../remote-control/src',
          '@/packages/agent-protocol': '../../packages/agent-protocol/src',
          '@/packages/remote-protocol': '../../packages/remote-protocol/src',
          '@/packages/run-protocol': '../../packages/run-protocol/src'
        }
      }]
    ]
  }
}
