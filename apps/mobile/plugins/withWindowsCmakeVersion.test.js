const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { applyWindowsCmakeToBuildGradle } = require("./withWindowsCmakeVersion");

const SAMPLE_BUILD_GRADLE = `allprojects {
  repositories {
    google()
  }
}

apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
`;

describe("withWindowsCmakeVersion", () => {
  it("injects Windows CMake 3.31.6 finalizeDsl hook before expo-root-project", () => {
    const result = applyWindowsCmakeToBuildGradle(SAMPLE_BUILD_GRADLE);
    const hookIdx = result.indexOf("androidComponents.finalizeDsl");
    const applyIdx = result.indexOf('apply plugin: "expo-root-project"');

    assert.ok(hookIdx > -1, "Expected finalizeDsl hook to be inserted");
    assert.ok(applyIdx > hookIdx, "Expected hook to precede apply plugin: expo-root-project");
    assert.ok(result.includes('sub.findProperty("android.windowsCmakeVersion") ?: "3.31.6"'));
  });

  it("is idempotent across repeated mergeContents runs", () => {
    const first = applyWindowsCmakeToBuildGradle(SAMPLE_BUILD_GRADLE);
    const second = applyWindowsCmakeToBuildGradle(first);
    assert.equal(second, first);
  });

  it("throws when the expo-root-project anchor is missing", () => {
    assert.throws(() => applyWindowsCmakeToBuildGradle("allprojects {}"), /expo-root-project/);
  });
});
