# Local Android release build on Windows (dev machine)

These are the issues found on 2026-11-14 and their fixes. All of them are scoped to the build command; none change system security settings.

| Problem | Symptom | Fix |
|---|---|---|
| Stale `JAVA_HOME` (points to a removed JDK) | Gradle can't start | `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot` for the command (or fix the Windows env var) |
| Avast Web Shield HTTPS scanning | `PKIX path validation failed` downloading Gradle | `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` (Java uses the Windows trust store) |
| pnpm global virtual store junctions | CMake "re-running" forever, `build.ninja still dirty` | `nodeLinker: hoisted` + `enableGlobalVirtualStore: false` in `pnpm-workspace.yaml` (done) |
| Windows MAX_PATH | `ninja: error: mkdir(...)` in Reanimated | Owner enabled `LongPathsEnabled=1` **and** CMake 3.31.6 (ninja 1.12.1) via `sdkmanager "cmake;3.31.6"`, wired by `apps/mobile/plugins/withLocalCmake.js` when `FLERO_CMAKE_DIR` is set |
| `expo run:android` uses `--configure-on-demand` | `Props.h` / `EventEmitters.h` not found (library codegen skipped) | Run Gradle directly (below) |
| Shared Metro cache across different roots | Web dev server blank (fonts never load) | Never build from a `subst` drive; restart web with `--clear` |
| Gradle release bundling (NODE_ENV=production) shares Metro's cache with the running web dev server | Web preview goes blank after an Android release build | Restart the `mobile-web` preview (launch config already passes `--clear`) |

## Commands (Git Bash)

```bash
cd apps/mobile
export FLERO_CMAKE_DIR="C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk\\cmake\\3.31.6"
export JAVA_HOME="C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.21.9-hotspot"
export JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStoreType=Windows-ROOT"
CI=1 npx expo prebuild --platform android --no-install        # regenerates android/ with cmake.dir
cd android && NODE_ENV=production ./gradlew.bat app:assembleRelease -x lint -x test -PreactNativeArchitectures=arm64-v8a,x86_64
adb install -r app/build/outputs/apk/release/app-release.apk
```

Measured on the first successful build: 7 min 11 s, APK 56 MB (two ABIs, unoptimized; size work comes later).

## Frame-time gate
`node tools/perf/android-scroll-gate.mjs --serial <device>` writes `docs/evidence/perf-android-*.json`. **Only a physical midrange device counts.** Emulator runs are labeled `NOT VALID`.
