#!/usr/bin/env node
/*
 * Builds both visualizations from the shared source in src/:
 *   src/classic/visualization.js -> appserver/static/visualizations/link_analysis/visualization.js (AMD)
 *   src/studio/visualization.js  -> appserver/static/visualizations/link_analysis_studio/visualization.js (ESM)
 * and copies src/studio/config.json next to the Studio bundle.
 *
 *   node build.mjs           production build (minified)
 *   node build.mjs --dev     unminified, with inline source maps
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vizRoot = join(here, '..', 'appserver', 'static', 'visualizations');
const dev = process.argv.includes('--dev');

// Import .css files as code that injects a <style> element.
const cssInjectPlugin = {
    name: 'css-inject',
    setup(b) {
        b.onLoad({ filter: /\.css$/ }, (args) => {
            const css = readFileSync(args.path, 'utf8');
            return {
                loader: 'js',
                contents: `(function(){var s=document.createElement('style');s.setAttribute('data-lla','');` +
                    `s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);})();`,
            };
        });
    },
};

const common = {
    bundle: true,
    platform: 'browser',
    target: 'es2017',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    // Some bundled libraries (e.g. numeric, used by the fcose layout) register
    // themselves on Node's `global`; map it to the browser global object.
    // Hide AMD's global define() from bundled UMD libraries (jQuery, d3, ...);
    // otherwise they register themselves with Splunk Web's RequireJS and cause
    // "Mismatched anonymous define()" errors.
    define: { global: 'globalThis', define: 'undefined' },
    plugins: [cssInjectPlugin],
    logLevel: 'warning',
    logOverride: { 'duplicate-object-key': 'silent' },
};

// Classic: wrap an IIFE in an AMD define() that receives Splunk's viz API modules.
await build({
    ...common,
    entryPoints: [join(here, 'src', 'classic', 'visualization.js')],
    outfile: join(vizRoot, 'link_analysis', 'visualization.js'),
    format: 'iife',
    globalName: '__llaClassic',
    banner: {
        js: "define(['api/SplunkVisualizationBase','api/SplunkVisualizationUtils'],function(SplunkVisualizationBase,SplunkVisualizationUtils){",
    },
    footer: { js: 'return __llaClassic.default;});' },
});
console.log('Built classic -> appserver/static/visualizations/link_analysis/visualization.js');

// Studio: ES module loaded by Dashboard Studio inside a sandboxed iframe.
mkdirSync(join(vizRoot, 'link_analysis_studio'), { recursive: true });
await build({
    ...common,
    entryPoints: [join(here, 'src', 'studio', 'visualization.js')],
    outfile: join(vizRoot, 'link_analysis_studio', 'visualization.js'),
    format: 'esm',
});
copyFileSync(join(here, 'src', 'studio', 'config.json'), join(vizRoot, 'link_analysis_studio', 'config.json'));
console.log('Built studio  -> appserver/static/visualizations/link_analysis_studio/visualization.js');
