// Metro config for the pnpm workspace (hoisted). Expo's default config already watches the monorepo root;
// we additionally watch the REAL paths of workspace packages (@flero/*), because their links resolve to
// absolute paths that may lie outside the root Metro sees (e.g. when building from a `subst` drive to
// stay under the Windows 260-char path limit).
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);
const pkg = require('./package.json');

const workspaceDirs = Object.keys(pkg.dependencies ?? {})
  .filter((name) => name.startsWith('@flero/'))
  .map((name) => {
    const candidates = [path.join(__dirname, 'node_modules', name), path.join(__dirname, '../../node_modules', name)];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error(`workspace package ${name} is not installed (run pnpm install)`);
    return fs.realpathSync(found);
  });

config.watchFolders = [...new Set([...(config.watchFolders ?? []), ...workspaceDirs])];

module.exports = config;
