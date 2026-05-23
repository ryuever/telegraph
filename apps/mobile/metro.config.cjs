const path = require('node:path')
const fs = require('node:fs')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')
const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
]

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(moduleName, { paths: [projectRoot] })
    }
  }

  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const sourcePath = path.resolve(path.dirname(context.originModulePath), moduleName)
    const tsPath = sourcePath.replace(/\.js$/, '.ts')
    const tsxPath = sourcePath.replace(/\.js$/, '.tsx')

    if (tsPath.startsWith(workspaceRoot) && fs.existsSync(tsPath)) {
      return { type: 'sourceFile', filePath: tsPath }
    }

    if (tsxPath.startsWith(workspaceRoot) && fs.existsSync(tsxPath)) {
      return { type: 'sourceFile', filePath: tsxPath }
    }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
