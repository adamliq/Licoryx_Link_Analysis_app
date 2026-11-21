#!/usr/bin/env node
// Copy the esbuild output and config.json for each Studio visualization into the
// app's appserver/static/visualizations/<viz>/ directory.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
for (const viz of readdirSync(join(here, 'visualizations'))) {
    const built = join(here, 'dist', viz, 'visualization.js');
    if (!existsSync(built)) throw new Error(`Missing ${built}; run the build first`);
    const dest = join(appRoot, 'appserver', 'static', 'visualizations', viz);
    mkdirSync(dest, { recursive: true });
    copyFileSync(built, join(dest, 'visualization.js'));
    copyFileSync(join(here, 'visualizations', viz, 'config.json'), join(dest, 'config.json'));
    console.log(`Installed ${viz} -> ${dest}`);
}
