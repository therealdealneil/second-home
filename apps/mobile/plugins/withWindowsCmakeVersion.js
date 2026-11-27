const path = require("node:path");
const { createRunOncePlugin, withProjectBuildGradle } = require("expo/config-plugins");
const { mergeContents } = require(
  require.resolve("@expo/config-plugins/build/utils/generateCode", {
    paths: [path.dirname(require.resolve("expo/config-plugins"))],
  }),
);

const PLUGIN_NAME = "withWindowsCmakeVersion";
const DEFAULT_CMAKE_VERSION = "3.31.6";

const GRADLE_SNIPPET = `if (System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT).contains("win")) {
  subprojects { sub ->
    def configureWindowsCmake = {
      def androidComponents = sub.extensions.findByName("androidComponents")
      if (androidComponents != null) {
        androidComponents.finalizeDsl { extension ->
          if (sub.name == "app" || extension.externalNativeBuild?.cmake?.path != null) {
            def windowsCmakeVersion = sub.findProperty("android.windowsCmakeVersion") ?: "${DEFAULT_CMAKE_VERSION}"
            extension.externalNativeBuild.cmake.version = windowsCmakeVersion.toString()
          }
        }
      }
    }
    sub.pluginManager.withPlugin("com.android.library") { configureWindowsCmake() }
    sub.pluginManager.withPlugin("com.android.application") { configureWindowsCmake() }
  }
}`;

function applyWindowsCmakeToBuildGradle(contents) {
  return mergeContents({
    tag: PLUGIN_NAME,
    src: contents,
    newSrc: GRADLE_SNIPPET,
    anchor: /apply plugin: "expo-root-project"/,
    offset: 0,
    comment: "//",
  }).contents;
}

/**
 * On Windows, CMake 3.22.1 bundles Ninja 1.10.2 which fails on pnpm store paths
 * exceeding MAX_PATH (260 chars). Pinning CMake 3.31.6 (Ninja 1.12.1) via AGP 9's
 * `androidComponents.finalizeDsl` before `expo-root-project` avoids both the
 * 260-char Stat/dirty-manifest bug and AGP 9's late-mutation error.
 */
function withWindowsCmakeVersion(config) {
  return withProjectBuildGradle(config, (exportedConfig) => {
    if (exportedConfig.modResults.language !== "groovy") {
      return exportedConfig;
    }
    exportedConfig.modResults.contents = applyWindowsCmakeToBuildGradle(
      exportedConfig.modResults.contents,
    );
    return exportedConfig;
  });
}

module.exports = createRunOncePlugin(withWindowsCmakeVersion, PLUGIN_NAME, "1.0.0");
module.exports.applyWindowsCmakeToBuildGradle = applyWindowsCmakeToBuildGradle;
