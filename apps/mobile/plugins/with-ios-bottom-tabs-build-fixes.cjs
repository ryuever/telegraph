const { createRunOncePlugin, withPodfile, withPodfileProperties } = require('@expo/config-plugins');

const SOURCE_BUILD_PROPERTY = 'ios.buildReactNativeFromSource';
const SWIFT_UI_INTROSPECT_POD = "  pod 'SwiftUIIntrospect', '1.4.0-beta.3'";

function withReactNativeSourceBuild(config) {
  return withPodfileProperties(config, (config) => {
    config.modResults[SOURCE_BUILD_PROPERTY] = 'true';
    return config;
  });
}

function withPodfileFixes(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes("pod 'SwiftUIIntrospect'")) {
      contents = contents.replace('  use_expo_modules!\n', `  use_expo_modules!\n${SWIFT_UI_INTROSPECT_POD}\n`);
    }

    if (!contents.includes("target.name == 'fmt'")) {
      const reactNativePostInstall = [
        '    react_native_post_install(',
        '      installer,',
        '      config[:reactNativePath],',
        '      :mac_catalyst_enabled => false,',
        '      :ccache_enabled => ccache_enabled?(podfile_properties),',
        '    )',
      ].join('\n');
      const fmtBuildFix = [
        '',
        "    installer.pods_project.targets.each do |target|",
        "      next unless target.name == 'fmt'",
        '',
        '      target.build_configurations.each do |config|',
        "        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']",
        "        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_USE_CONSTEVAL=0'",
        "        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'",
        '      end',
        '    end',
      ].join('\n');

      contents = contents.replace(reactNativePostInstall, `${reactNativePostInstall}${fmtBuildFix}`);
    }

    config.modResults.contents = contents;
    return config;
  });
}

function withIosBottomTabsBuildFixes(config) {
  config = withReactNativeSourceBuild(config);
  config = withPodfileFixes(config);
  return config;
}

module.exports = createRunOncePlugin(
  withIosBottomTabsBuildFixes,
  'with-ios-bottom-tabs-build-fixes',
  '0.1.0'
);
