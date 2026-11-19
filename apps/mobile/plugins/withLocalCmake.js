// Local Windows builds only: point Gradle at a newer SDK CMake whose ninja (>= 1.12) is long-path aware.
// The default CMake 3.22.1 ships ninja 1.10.2, which fails on Reanimated's deep C++ object paths even with
// Windows LongPathsEnabled=1. Activated ONLY when FLERO_CMAKE_DIR is set, so EAS/CI builds are unaffected.
// android/ is generated (Continuous Native Generation) — this plugin is the sanctioned way to customise it.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withLocalCmake(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = process.env.FLERO_CMAKE_DIR;
      if (!dir) return cfg;
      if (!fs.existsSync(path.join(dir, 'bin', 'ninja.exe')) && !fs.existsSync(path.join(dir, 'bin', 'ninja'))) {
        throw new Error(`FLERO_CMAKE_DIR=${dir} has no bin/ninja`);
      }
      const file = path.join(cfg.modRequest.platformProjectRoot, 'local.properties');
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const escaped = dir.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
      const lines = existing.split(/\r?\n/).filter((l) => l && !l.startsWith('cmake.dir='));
      lines.push(`cmake.dir=${escaped}`);
      fs.writeFileSync(file, lines.join('\n') + '\n');
      return cfg;
    },
  ]);
};
