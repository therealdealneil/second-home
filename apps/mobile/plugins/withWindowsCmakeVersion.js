const { withProjectBuildGradle } = require("expo/config-plugins");

const TAG = "// @generated withWindowsCmakeVersion";
const CMAKE_VERSION = "3.31.6";

const GRADLE_SNIPPET = `${TAG}
if (org.gradle.internal.os.OperatingSystem.current().isWindows()) {
  subprojects { sub ->
    def configureWindowsCmake = {
      def androidComponents = sub.extensions.findByName("androidComponents")
      if (androidComponents != null) {
        androidComponents.finalizeDsl { extension ->
          if (sub.name == "app" || extension.externalNativeBuild?.cmake?.path != null) {
            extension.externalNativeBuild.cmake.version = "${CMAKE_VERSION}"
          }
        }
      }
    }
    sub.pluginManager.withPlugin("com.android.library") { configureWindowsCmake() }
    sub.pluginManager.withPlugin("com.android.application") { configureWindowsCmake() }
  }
}
// @generated end withWindowsCmakeVersion`;

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
    const contents = exportedConfig.modResults.contents;
    if (contents.includes(TAG)) {
      return exportedConfig;
    }
    const anchor = 'apply plugin: "expo-root-project"';
    if (contents.includes(anchor)) {
      exportedConfig.modResults.contents = contents.replace(
        anchor,
        `${GRADLE_SNIPPET}\n\n${anchor}`,
      );
    }
    return exportedConfig;
  });
}

module.exports = withWindowsCmakeVersion;
