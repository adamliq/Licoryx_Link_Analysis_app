#!/usr/bin/env node
/*
 * Browser smoke tests for the Licoryx Link Analysis App against a running Splunk
 * (e.g. the splunk/splunk Docker image) with the app installed.
 *
 *   SPLUNK_WEB=http://localhost:8000 SPLUNK_MGMT=https://localhost:8089 \
 *   SPLUNK_PASSWORD=... node tests/smoke.mjs [screenshot-dir]
 *
 * Requires Playwright with Chromium. Exits non-zero if any check fails.
 * Set SKIP_STUDIO=1 for Splunk versions without the Dashboard Studio
 * extension framework (before 10.4): only the classic checks run.
 * Set LLA_EDITION=studio-only to test the Studio-only package (see package-studio-only.sh).
 * Set SKIP_KVSTORE=1 when the host's KV store cannot run (e.g. Splunk 10.4's
 * MongoDB on Linux kernel 6.19+): the KV-store checks are reported as SKIP.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WEB = process.env.SPLUNK_WEB || 'http://localhost:8000';
const MGMT = process.env.SPLUNK_MGMT || 'https://localhost:8089';
const USER = process.env.SPLUNK_USER || 'admin';
const PASS = process.env.SPLUNK_PASSWORD;
const OUT = process.argv[2] || 'smoke-screenshots';
const APP = 'licoryx_link_analysis_app';
const SKIP_STUDIO = /^(1|true|yes)$/i.test(process.env.SKIP_STUDIO || '');
const SKIP_KVSTORE = /^(1|true|yes)$/i.test(process.env.SKIP_KVSTORE || '');
// LLA_EDITION=studio-only: the Dashboard Studio-only package (package-studio-only.sh). Classic checks
// are skipped; the removed features (Save State, Expand, exports, Manage page) must be absent.
const STUDIO_ONLY = process.env.LLA_EDITION === 'studio-only';
if (!PASS) {
    console.error('SPLUNK_PASSWORD is required');
    process.exit(2);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // test container uses a self-signed cert
mkdirSync(OUT, { recursive: true });

const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
async function rest(path, { method = 'GET', form, json } = {}) {
    const res = await fetch(`${MGMT}${path}${path.includes('?') ? '&' : '?'}output_mode=json`, {
        method,
        headers: { Authorization: AUTH, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    if (!res.ok && res.status !== 409) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
}
const skipped = [];
function skip(name, reason) {
    skipped.push(name);
    console.log(`SKIP  ${name}  - ${reason}`);
}

const SAMPLE = '| makeresults count=30 | streamstats count as n | eval src_ip="10.0.".(n%5).".".(n%7), dest_ip="dc-".(n%4), count=n | table src_ip dest_ip count';
const TWO_NODES = '| makeresults | eval src_ip="alpha", dest_ip="bravo", count=1 | table src_ip dest_ip count';
const CLASSIC = `${APP}.link_analysis`;
// Expand search used by the tests: three neighbours of "alpha" (the node name is appended as a quoted term).
const EXPAND_BASE = '| makeresults count=3 | streamstats count as n | eval src_ip="alpha", dest_ip="nbr-".n, count=1, _raw=src_ip." ".dest_ip | search';

// Classic (Simple XML) dashboard: two link analysis panels + a drilldown token.
const classicDashboard = `<dashboard version="1.1" theme="light">
  <label>LLA smoke classic</label>
  <row>
    <panel><title>Panel A</title>
      <viz type="${CLASSIC}">
        <search><query>${TWO_NODES.replace(/</g, '&lt;')}</query><earliest>-15m</earliest><latest>now</latest></search>
        <option name="${CLASSIC}.layoutStyle">grid</option>
        <option name="${CLASSIC}.expandBase">${EXPAND_BASE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</option>
        <option name="${CLASSIC}.expandStats">| stats count by src_ip dest_ip</option>
        <option name="height">400</option>
        <drilldown><set token="clicked">$click.name$ src=$row.src_ip$ dest=$row.dest_ip$</set></drilldown>
      </viz>
    </panel>
    <panel><title>Panel B</title>
      <viz type="${CLASSIC}">
        <search><query>${SAMPLE.replace(/</g, '&lt;')}</query><earliest>-15m</earliest><latest>now</latest></search>
        <option name="height">400</option>
      </viz>
    </panel>
  </row>
  <row><panel><html><p id="lla-clicked">clicked: $clicked$</p></html></panel></row>
</dashboard>`;

const STUDIO = `${APP}.link_analysis_studio`;
const BIG = '| makeresults count=20000 | streamstats count as n | eval src_ip="h".(n%3000), dest_ip="s".(n%50), count=n | table src_ip dest_ip count';
const studioDefinition = {
    title: 'LLA smoke studio',
    dataSources: {
        ds_two: { type: 'ds.search', options: { query: TWO_NODES, queryParameters: { earliest: '-15m', latest: 'now' } } },
        ds_big: { type: 'ds.search', options: { query: BIG, queryParameters: { earliest: '-15m', latest: 'now' } } },
        ds_timed: { type: 'ds.search', options: { query: '| makeresults count=12 | streamstats count as n | eval _time=_time-n*300, src_ip="host".(n%4), dest_ip="srv".(n%3), count=n, src_type="workstation", dest_type="server" | table src_ip dest_ip count src_type dest_type _time', queryParameters: { earliest: '-24h', latest: 'now' } } },
        ds_expand: { type: 'ds.search', options: { query: `${EXPAND_BASE} $expand_node|s$ | stats count by src_ip dest_ip`, queryParameters: { earliest: '-15m', latest: 'now' } } },
    },
    visualizations: {
        viz_two: {
            type: STUDIO, title: 'two', dataSources: { primary: 'ds_two', expand: 'ds_expand' },
            options: { layoutStyle: 'grid' },
            eventHandlers: [{ type: 'drilldown.setToken', options: { tokens: [{ token: 'clicked', key: 'value' }, { token: 'expand_node', key: 'value' }] } }],
        },
        viz_big: { type: STUDIO, title: 'big', dataSources: { primary: 'ds_big' }, options: { layoutStyle: 'grid', maxRows: 15000 } },
        viz_md: { type: 'splunk.markdown', options: { markdown: 'clicked=$clicked$' } },
        viz_timed: { type: STUDIO, title: 'timed', dataSources: { primary: 'ds_timed' }, options: { edgeWidth: 'count' } },
    },
    inputs: {},
    defaults: {},
    layout: {
        type: 'absolute', options: { width: 1400, height: 840 },
        structure: [
            { item: 'viz_two', type: 'block', position: { x: 0, y: 0, w: 700, h: 400 } },
            { item: 'viz_big', type: 'block', position: { x: 700, y: 0, w: 700, h: 400 } },
            { item: 'viz_md', type: 'block', position: { x: 0, y: 420, w: 700, h: 60 } },
            { item: 'viz_timed', type: 'block', position: { x: 700, y: 420, w: 700, h: 400 } },
        ],
    },
};
if (STUDIO_ONLY) {
    delete studioDefinition.dataSources.ds_expand;
    delete studioDefinition.visualizations.viz_two.dataSources.expand;
}
const studioDashboard = `<dashboard version="2" theme="light"><label>LLA smoke studio</label><definition><![CDATA[${JSON.stringify(studioDefinition)}]]></definition></dashboard>`;

// Wait (up to ~5 minutes) for the KV store; returns true when ready.
async function waitForKvStore() {
    for (let i = 0; i < 30; i++) {
        try {
            const status = await rest('/services/kvstore/status');
            const current = status.entry[0].content.current.status;
            if (current === 'ready') return true;
            console.log(`      info: kvstore status ${current}, waiting...`);
        } catch (e) {
            console.log(`      info: kvstore status unavailable (${e.message.slice(0, 80)}), waiting...`);
        }
        await new Promise((r) => setTimeout(r, 10000));
    }
    return false;
}

async function login(page) {
    await page.goto(`${WEB}/en-US/account/login`);
    await page.fill('input[name=username]', USER);
    await page.fill('input[name=password]', PASS);
    await page.click('input[type=submit]');
    await page.waitForURL((u) => !u.pathname.includes('/account/login'), { timeout: 60000 });
}

async function dismissPopups(page) {
    for (const name of ['Got it!', 'Got it', "Don't show me this again", 'Skip tour']) {
        const b = page.getByRole('button', { name });
        if (await b.count()) await b.first().click().catch(() => {});
    }
}

// With the KV store down, Splunk Web's own "Recently viewed" / "Favorites" features
// (KV collections RecentlyViewedKO, Favorites in the system app) parse Splunk's XML
// error reply as JSON and throw this. It is not caused by the app, so it is only
// tolerated when SKIP_KVSTORE is set.
const SPLUNK_KV_DOWN_ERROR = /Unexpected token '<', "<\?xml vers"\.\.\. is not valid JSON/;

function collectErrors(page, sink) {
    page.on('pageerror', (e) => {
        if (SKIP_KVSTORE && SPLUNK_KV_DOWN_ERROR.test(e.message)) {
            console.log(`      info: ignored Splunk Web KV-store error (SKIP_KVSTORE): ${e.message}`);
            return;
        }
        sink.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/Failed to load resource|favicon|telemetry/i.test(t)) return;
        sink.push(`console: ${t.slice(0, 300)}`);
    });
}

// Open the cxtmenu at (x, y) with the right mouse button and release on the named command.
async function cxtCommand(page, frame, x, y, command, expectSelector) {
    for (let attempt = 0; attempt < 2; attempt++) {
        await openCxtCommand(page, frame, x, y, command);
        if (!expectSelector) return;
        if (await frame.locator(expectSelector).count()) return;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
    }
    throw new Error(`"${command}" did not open ${expectSelector}`);
}

async function openCxtCommand(page, frame, x, y, command) {
    // Try a few points (offset from the requested one) until the command is fully on screen;
    // the radial menu is ~200px wide, so points near the page edge can push items off-screen.
    const viewport = page.viewportSize();
    for (const [dx, dy] of [[0, 0], [120, 120], [200, 60], [60, 200]]) {
        const px = x + dx, py = y + dy;
        await page.mouse.move(px, py);
        await page.mouse.down({ button: 'right' });
        await page.waitForTimeout(600);
        const box = await frame.locator('.cxtmenu-item', { hasText: command }).first().boundingBox().catch(() => null);
        const onScreen = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
        if (onScreen) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
            await page.mouse.up({ button: 'right' });
            await page.waitForTimeout(600);
            return;
        }
        // Release back at the press point (centre of the menu = no selection).
        await page.mouse.move(px, py);
        await page.mouse.up({ button: 'right' });
        await page.waitForTimeout(400);
    }
    throw new Error(`context menu command "${command}" not reachable`);
}

// Move along the middle of a graph until the hover tooltip shows; returns {x, y, text} or null.
async function findNode(page, frame, box, wanted) {
    for (let fx = 0.04; fx < 0.98; fx += 0.02) {
        const x = box.x + box.width * fx;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.waitForTimeout(120);
        const tip = frame.locator('.lla-tooltip');
        const visible = await tip.first().evaluate((el) => el.style.display === 'block').catch(() => false);
        if (visible) {
            const text = (await tip.first().innerText()).trim();
            if (!wanted || text.startsWith(wanted)) return { x, y, text };
        }
    }
    return null;
}

// Choose a command from a node's context menu.
async function nodeCommand(page, frame, at, command) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(600);
    const item = frame.locator('.cxtmenu-item', { hasText: command }).first();
    const box = await item.boundingBox();
    if (!box) {
        await page.mouse.up({ button: 'right' });
        throw new Error(`node menu command "${command}" not found`);
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(600);
}

// Run a Menu item via the toolbar's Menu button of the first visualization in scope.
async function menuItem(page, scope, item) {
    await scope.locator('.lla-tool-menu').first().click();
    await page.fill('#menu_select', item);
    await page.click('.lla-modal-footer .btn-primary');
    await page.waitForTimeout(1200);
}

(async () => {
    // Fixture: classic dashboard (replace if it exists).
    await rest(`/servicesNS/${USER}/${APP}/data/ui/views/lla_smoke_classic`, { method: 'DELETE' }).catch(() => {});
    await rest(`/servicesNS/${USER}/${APP}/data/ui/views`, { method: 'POST', form: { name: 'lla_smoke_classic', 'eai:data': classicDashboard } });
    if (!SKIP_STUDIO) {
        await rest(`/servicesNS/${USER}/${APP}/data/ui/views/lla_smoke_studio`, { method: 'DELETE' }).catch(() => {});
        await rest(`/servicesNS/${USER}/${APP}/data/ui/views`, { method: 'POST', form: { name: 'lla_smoke_studio', 'eai:data': studioDashboard } });
    }

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage();
    await login(page);

    // 1. Classic viz on the search page.
    if (!STUDIO_ONLY) {
        const errors = [];
        collectErrors(page, errors);
        const q = encodeURIComponent(SAMPLE);
        await page.goto(`${WEB}/en-US/app/${APP}/search?q=${q}&earliest=-15m&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations&display.visualizations.type=custom&display.visualizations.custom.type=${CLASSIC}`);
        await page.waitForSelector('.lla-cy canvas', { timeout: 90000 }).catch(() => {});
        await dismissPopups(page);
        await page.waitForTimeout(3000);
        await dismissPopups(page);
        await page.waitForTimeout(1000);
        const canvases = await page.locator('.lla-cy canvas').count();
        await page.screenshot({ path: `${OUT}/classic-search.png` });
        check('classic viz renders on the search page', canvases > 0, `${canvases} canvases`);

        // Search Nodes twice: the suggestion list must survive the first search.
        const cyBox = await page.locator('.lla-cy:has(canvas)').last().boundingBox();
        let searchOk = false;
        let detail = '';
        try {
            for (const term of ['dc-1', '10.0.2']) {
                await cxtCommand(page, page, cyBox.x + 30, cyBox.y + 30, 'Search Nodes', '#node_search');
                await page.fill('#node_search', term);
                await page.click('.lla-modal-footer .btn-primary');
                await page.waitForTimeout(1500);
            }
            const lists = await page.locator('datalist[id$="-node_list"] option').count();
            searchOk = lists > 0;
            detail = `${lists} node suggestions after two searches`;
        } catch (e) {
            detail = e.message;
        }
        check('Search Nodes works repeatedly and keeps suggestions', searchOk, detail);

        // Save State to the KV store (classic default).
        const kvReady = SKIP_KVSTORE ? false : await waitForKvStore();
        const listGraphs = async () => {
            try {
                const docs = await rest(`/servicesNS/nobody/${APP}/storage/collections/data/cyto_graphs`);
                return Array.isArray(docs) ? docs : [];
            } catch (e) {
                return [];
            }
        };
        const before = (await listGraphs()).length;
        let saveDetail = '';
        if (!SKIP_KVSTORE) try {
            await cxtCommand(page, page, cyBox.x + 30, cyBox.y + 30, 'Menu', '#menu_select');
            await page.fill('#menu_select', 'Save State');
            await page.click('.lla-modal-footer .btn-primary');
            await page.waitForTimeout(800);
            await page.fill('#http_description', 'smoke test graph');
            await page.click('.lla-modal-footer .btn-primary');
            await page.waitForTimeout(3000);
            saveDetail = (await page.locator('.lla-modal-body').allTextContents()).join(' ').trim();
            await page.screenshot({ path: `${OUT}/classic-save.png` });
            await page.click('.lla-modal-footer .btn-primary').catch(() => {});
        } catch (e) {
            saveDetail = e.message;
        }
        const docs = await listGraphs();
        const saved = docs.find((d) => d.description === 'smoke test graph');
        if (SKIP_KVSTORE) {
            skip('Save State stores the graph in the KV store (no token)', 'SKIP_KVSTORE set');
        } else {
            check('Save State stores the graph in the KV store (no token)', !!saved && docs.length > before,
                kvReady ? saveDetail : `KV store not ready; ${saveDetail}`);
        }
        globalThis.savedGraphId = saved && saved.graph_id;
        check('no page errors on the search page', errors.length === 0, errors.join(' | '));
    }

    // 1a. KV store down: Save State must switch to the HTTP Event Collector by itself.
    if (SKIP_KVSTORE && !STUDIO_ONLY) {
        let detail = '';
        let ok = false;
        try {
            const cyBox = await page.locator('.lla-cy:has(canvas)').last().boundingBox();
            await cxtCommand(page, page, cyBox.x + 30, cyBox.y + 30, 'Menu', '#menu_select');
            await page.fill('#menu_select', 'Save State');
            await page.click('.lla-modal-footer .btn-primary');
            await page.waitForTimeout(3000);
            const method = await page.locator('#lla_save_method').inputValue();
            const note = (await page.locator('.lla-kv-note').innerText().catch(() => '')).trim();
            ok = method === 'hec' && /not available/.test(note);
            detail = `method=${method}; ${note}`;
            await page.keyboard.press('Escape');
            await page.locator('.lla-modal-close').click().catch(() => {});
        } catch (e) {
            detail = e.message;
        }
        check('Save State falls back to HEC when the KV store is down', ok, detail);
    }

    // 1c. Styling: src_group/dest_group legend, node size by count, large-graph layout fallback.
    if (!STUDIO_ONLY) {
        const GROUPS = '| makeresults count=12 | streamstats count as n | eval src_ip="host".(n%4), dest_ip="srv".(n%3), count=n, src_group="workstations", dest_group="servers" | table src_ip dest_ip count src_group dest_group';
        const q = encodeURIComponent(GROUPS);
        await page.goto(`${WEB}/en-US/app/${APP}/search?q=${q}&earliest=-15m&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations&display.visualizations.type=custom&display.visualizations.custom.type=${CLASSIC}&display.visualizations.custom.${CLASSIC}.nodeSize=count`);
        await page.waitForSelector('.lla-cy canvas', { timeout: 90000, state: 'attached' }).catch(() => {});
        await page.waitForTimeout(4000);
        const legend = (await page.locator('.lla-legend-item').allTextContents()).map((t) => t.trim()).sort();
        await page.screenshot({ path: `${OUT}/classic-legend.png` });
        check('src_group/dest_group colour nodes and show a legend', legend.join(',') === 'servers,workstations', legend.join(','));

        const BIGGRAPH = '| makeresults count=400 | streamstats count as n | eval src_ip="a".n, dest_ip="b".(n%150), count=1 | table src_ip dest_ip count';
        await page.goto(`${WEB}/en-US/app/${APP}/search?q=${encodeURIComponent(BIGGRAPH)}&earliest=-15m&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations&display.visualizations.type=custom&display.visualizations.custom.type=${CLASSIC}&display.visualizations.custom.${CLASSIC}.largeGraphNodes=100`);
        await page.waitForSelector('.lla-cy canvas', { timeout: 90000, state: 'attached' }).catch(() => {});
        await page.waitForTimeout(4000);
        const notices = (await page.locator('.lla-notice').allTextContents()).join(' ');
        check('large graphs switch slow layouts to grid with a notice', /using the "grid" layout/.test(notices), notices);
    }

    // 1e. Timeline (_time), node types (src_type/dest_type) with shapes, edge width by count, WebGL renderer.
    if (!STUDIO_ONLY) {
        const TIMED = '| makeresults count=12 | streamstats count as n | eval _time=_time-n*300, src_ip="host".(n%4), dest_ip="srv".(n%3), count=n, src_type="workstation", dest_type="server" | table src_ip dest_ip count src_type dest_type _time';
        await page.goto(`${WEB}/en-US/app/${APP}/search?q=${encodeURIComponent(TIMED)}&earliest=-24h&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations&display.visualizations.type=custom&display.visualizations.custom.type=${CLASSIC}&display.visualizations.custom.${CLASSIC}.edgeWidth=count`);
        await page.waitForSelector('.lla-cy canvas', { timeout: 90000, state: 'attached' }).catch(() => {});
        await page.waitForTimeout(4000);
        const types = (await page.locator('.lla-legend-type').allTextContents()).map((t) => t.trim().slice(1)).sort();
        check('src_type/dest_type give node shapes with a legend', types.join(',') === 'server,workstation', types.join(','));
        const slider = page.locator('.lla-timeline-slider');
        let tl = '';
        if (await slider.count()) {
            const last = await page.locator('.lla-timeline-label').innerText();
            await slider.fill('0');
            await page.waitForTimeout(500);
            const first = await page.locator('.lla-timeline-label').innerText();
            tl = first && last && first !== last ? `${first} .. ${last}` : '';
        }
        check('_time adds a timeline slider', !!tl, tl || 'no timeline');
        await page.screenshot({ path: `${OUT}/classic-timeline.png` });

        const errors = [];
        const onErr = (e) => errors.push(e.message);
        page.on('pageerror', onErr);
        await page.goto(`${WEB}/en-US/app/${APP}/search?q=${encodeURIComponent(SAMPLE)}&earliest=-15m&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations&display.visualizations.type=custom&display.visualizations.custom.type=${CLASSIC}&display.visualizations.custom.${CLASSIC}.renderer=webgl`);
        await page.waitForSelector('.lla-cy canvas', { timeout: 90000, state: 'attached' }).catch(() => {});
        await page.waitForTimeout(4000);
        const n = await page.locator('.lla-cy canvas').count();
        page.off('pageerror', onErr);
        check('WebGL renderer option renders without errors', n > 0 && errors.length === 0, `${n} canvases ${errors.join(' | ')}`);
    }

    // 1d. Manage Saved Graphs: list, rename, import (from Export Graph JSON format) and delete.
    if (!SKIP_KVSTORE && !STUDIO_ONLY) {
        let detail = '';
        let ok = false;
        try {
            await page.goto(`${WEB}/en-US/app/${APP}/manage_saved_graphs`);
            await page.waitForSelector('.llm-table tbody tr', { timeout: 60000 });
            await dismissPopups(page);
            const listed = await page.locator('.llm-table tbody tr', { hasText: 'smoke test graph' }).count();
            // Import a small graph, then rename and delete it.
            const graph = { elements: { nodes: [{ data: { id: 'n0', label: 'x' }, position: { x: 0, y: 0 } }], edges: [] } };
            await page.fill('#llm-import-description', 'smoke import');
            await page.fill('#llm-import-json', JSON.stringify(graph));
            await page.click('#llm-import');
            await page.waitForSelector('.llm-table tbody tr:has-text("smoke import")', { timeout: 20000 });
            await page.locator('.llm-table tbody tr', { hasText: 'smoke import' }).locator('.llm-rename').click();
            await page.fill('#llm-dialog-input', 'smoke renamed');
            await page.click('#llm-dialog-ok');
            await page.waitForSelector('.llm-table tbody tr:has-text("smoke renamed")', { timeout: 20000 });
            await page.locator('.llm-table tbody tr', { hasText: 'smoke renamed' }).locator('.llm-delete').click();
            await page.click('#llm-dialog-ok');
            await page.locator('.llm-table tbody tr', { hasText: 'smoke renamed' }).waitFor({ state: 'detached', timeout: 20000 });
            await page.screenshot({ path: `${OUT}/manage-saved-graphs.png` });
            ok = listed > 0;
            detail = `listed smoke test graph: ${listed}; import, rename and delete worked`;
        } catch (e) {
            detail = e.message;
        }
        check('Manage Saved Graphs lists, imports, renames and deletes graphs', ok, detail);

        // Imported graphs are sanitised: no styles or URLs are stored.
        try {
            const evil = {
                style: [{ selector: 'node', style: { 'background-image': 'http://127.0.0.1:9/beacon-style.png' } }],
                elements: { nodes: [
                    { data: { id: 'e0', label: 'evil', color: 'url(http://127.0.0.1:9/beacon-color.png)' }, position: { x: 0, y: 0 }, style: { 'background-image': 'http://127.0.0.1:9/beacon-inline.png' } },
                    { data: { id: 'e1', label: 'ok' }, position: { x: 100, y: 0 } },
                ], edges: [{ data: { id: 'x', source: 'e0', target: 'e1' } }] },
            };
            await page.fill('#llm-import-description', 'smoke evil');
            await page.fill('#llm-import-json', JSON.stringify(evil));
            await page.click('#llm-import');
            await page.waitForSelector('.llm-table tbody tr:has-text("smoke evil")', { timeout: 20000 });
            const docs = await rest(`/servicesNS/nobody/${APP}/storage/collections/data/cyto_graphs`);
            const stored = docs.find((d) => d.description === 'smoke evil');
            check('imported graphs are stored without styles or URLs', !!stored && !/127\.0\.0\.1|background-image|url\(/.test(stored.graph_info), stored ? stored.graph_info.slice(0, 120) : 'not stored');
        } catch (e) {
            check('imported graphs are stored without styles or URLs', false, e.message);
        }
    } else if (!STUDIO_ONLY) {
        skip('Manage Saved Graphs lists, imports, renames and deletes graphs', 'SKIP_KVSTORE set');
        await page.goto(`${WEB}/en-US/app/${APP}/manage_saved_graphs`);
        await page.waitForTimeout(8000);
        const text = (await page.locator('.llm-status').innerText().catch(() => '')).trim();
        check('Manage Saved Graphs explains that the KV store is unavailable', /KV store is not available/.test(text), text);
    }

    // 1b. Row limit warning (classic): 30 rows with maxRows=10.
    if (!STUDIO_ONLY) {
        const q = encodeURIComponent(SAMPLE);
        await page.goto(`${WEB}/en-US/app/${APP}/search?q=${q}&earliest=-15m&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations&display.visualizations.type=custom&display.visualizations.custom.type=${CLASSIC}&display.visualizations.custom.${CLASSIC}.maxRows=10`);
        await page.waitForSelector('.lla-cy canvas', { timeout: 90000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const warning = (await page.locator('.lla-row-warning').allTextContents()).join(' ');
        check('classic warns when rows exceed "Maximum rows"', /first 10 of 30/.test(warning), warning);
    }

    // 2. Two classic panels on one dashboard + drilldown.
    if (!STUDIO_ONLY) {
        const p2 = await context.newPage();
        const errors = [];
        collectErrors(p2, errors);
        await p2.goto(`${WEB}/en-US/app/${APP}/lla_smoke_classic`);
        await p2.waitForTimeout(15000);
        await dismissPopups(p2);
        const containers = await p2.locator('.lla-cy').count();
        const withCanvas = await p2.locator('.lla-cy:has(canvas)').count();
        const ids = await p2.locator('.lla-cy').evaluateAll((els) => els.map((e) => e.id));
        check('two classic panels on one dashboard render independently', containers === 2 && withCanvas === 2 && new Set(ids).size === 2, ids.join(', '));

        // Grid layout with two nodes on one row: scan across the middle of the panel.
        const box = await p2.locator('.lla-cy').first().boundingBox();
        let clicked = '';
        for (let fx = 0.06; fx < 0.96; fx += 0.04) {
            await p2.mouse.dblclick(box.x + box.width * fx, box.y + box.height / 2);
            await p2.waitForTimeout(700);
            clicked = (await p2.locator('#lla-clicked').innerText().catch(() => '')).trim();
            if (/src_ip src=alpha|dest_ip .*dest=bravo/.test(clicked)) break;
        }
        await p2.screenshot({ path: `${OUT}/classic-dashboard.png` });
        check('classic double-click drilldown sets $click.name$ and $row.<field>$', /src_ip src=alpha|dest_ip .*dest=bravo/.test(clicked), clicked);

        // Toolbar + hover details + Expand (classic runs the expand search itself).
        const panelA = p2.locator('.lla-cy').first();
        const vizA = panelA.locator('xpath=..');
        const tools = await vizA.locator('.lla-toolbar .lla-tool').allTextContents();
        check('toolbar shows Search, Menu, Fit and Save', tools.join(',') === 'Search,Menu,Fit,Save', tools.join(','));
        const alpha = await findNode(p2, vizA, box, 'alpha');
        check('hovering a node shows its details', !!alpha && /Connections:\s*1/.test(alpha.text), alpha ? alpha.text.replace(/\n/g, ' | ') : 'no tooltip');
        let expandDetail = '';
        let expandOk = false;
        if (alpha) {
            try {
                const listId = (await panelA.getAttribute('id')).replace(/-cy$/, '-node_list');
                const before = await p2.locator(`datalist#${listId} option`).count();
                await nodeCommand(p2, p2, alpha, 'Expand');
                await vizA.locator('.lla-notice', { hasText: 'Expanded "alpha"' }).waitFor({ timeout: 60000 });
                const after = await p2.locator(`datalist#${listId} option`).count();
                expandDetail = `${(await vizA.locator('.lla-notice').allTextContents()).join(' ')} (node list ${before} -> ${after})`;
                expandOk = after === before + 3;
            } catch (e) {
                expandDetail = e.message;
            }
        }
        check('Expand adds the neighbours found by the expand search', expandOk, expandDetail);
        await p2.screenshot({ path: `${OUT}/classic-expand.png` });

        // Analytics, filter and image export via the toolbar's Menu button.
        await menuItem(p2, vizA, 'Size by PageRank');
        const pr = (await vizA.locator('.lla-notice').allTextContents()).join(' ');
        check('Menu > Size by PageRank', /PageRank/.test(pr), pr);
        await menuItem(p2, vizA, 'Find Clusters');
        const clusters = await vizA.locator('.lla-legend-item', { hasText: 'Cluster' }).count();
        check('Menu > Find Clusters colours clusters with a legend', clusters > 0, `${clusters} clusters`);
        await menuItem(p2, vizA, 'Filter by Connections');
        await p2.fill('#lla_min_degree', '2');
        await p2.click('.lla-modal-footer .btn-primary');
        await p2.waitForTimeout(800);
        const filt = (await vizA.locator('.lla-notice').allTextContents()).join(' ');
        check('Menu > Filter by Connections hides low-degree nodes', /hidden/.test(filt), filt);
        await menuItem(p2, vizA, 'Clear Filters');
        await menuItem(p2, vizA, 'Export Image (PNG)');
        const src = await p2.locator('#lla_export_image').getAttribute('src').catch(() => '');
        check('Menu > Export Image shows a PNG of the graph', /^data:image\/png;base64,/.test(src || '') && src.length > 1000, `${(src || '').length} characters`);
        await p2.locator('.lla-modal-footer .btn-primary').click().catch(() => {});
        check('no page errors on the classic dashboard', errors.length === 0, errors.join(' | '));
        await p2.close();
    }

    // 2b. Studio: drilldown token and row limit.
    if (!SKIP_STUDIO) {
        const p4 = await context.newPage();
        const errors = [];
        collectErrors(p4, errors);
        await p4.goto(`${WEB}/en-US/app/${APP}/lla_smoke_studio`);
        await p4.waitForTimeout(25000);
        await dismissPopups(p4);
        const frames = [];
        for (const f of p4.frames().filter((fr) => fr.url() === 'about:srcdoc')) {
            frames.push({ frame: f, box: await (await f.frameElement()).boundingBox() });
        }
        frames.sort((a, b) => a.box.x - b.box.x);
        // Expand first (fresh expand search), before the double-click test sets the same token.
        let sExpand = '';
        let sExpandOk = false;
        if (STUDIO_ONLY && frames[0]) {
            const alphaAt = await findNode(p4, frames[0].frame, frames[0].box, 'alpha');
            let items = [];
            if (alphaAt) {
                await p4.mouse.move(alphaAt.x, alphaAt.y);
                await p4.mouse.down({ button: 'right' });
                await p4.waitForTimeout(600);
                items = (await frames[0].frame.locator('.cxtmenu-content').allTextContents()).map((t) => t.trim());
                await p4.mouse.up({ button: 'right' });
            }
            check('studio-only: node menu has no Expand', items.length > 0 && !items.includes('Expand'), items.join(', '));
        } else if (frames[0]) {
            try {
                const alphaAt = await findNode(p4, frames[0].frame, frames[0].box, 'alpha');
                if (!alphaAt) throw new Error('alpha not found');
                await nodeCommand(p4, frames[0].frame, alphaAt, 'Expand');
                await frames[0].frame.locator('.lla-notice', { hasText: 'Expanded "alpha"' }).waitFor({ timeout: 60000 });
                sExpand = (await frames[0].frame.locator('.lla-notice').allTextContents()).join(' ');
                sExpandOk = /3 new nodes/.test(sExpand);
            } catch (e) {
                sExpand = e.message;
            }
        }
        if (!STUDIO_ONLY) check('Studio Expand merges the "expand" data source into the graph', sExpandOk, sExpand);
        let clicked = '';
        if (frames[0]) {
            const box = frames[0].box;
            for (let fx = 0.06; fx < 0.96; fx += 0.04) {
                await p4.mouse.dblclick(box.x + box.width * fx, box.y + box.height / 2);
                await p4.waitForTimeout(700);
                clicked = (await p4.getByText(/^clicked=/).first().innerText().catch(() => '')).trim();
                if (/clicked=(alpha|bravo)/.test(clicked)) break;
            }
        }
        check('Studio double-click drilldown sets a token to the node name', /clicked=(alpha|bravo)/.test(clicked), clicked);

        const warning = frames[1] ? (await frames[1].frame.locator('.lla-row-warning').allTextContents()).join(' ') : '';
        console.log(`      info: Studio row warning for 20000-row search with maxRows=15000: "${warning}"`);
        check('Studio warns when rows exceed "Maximum rows"', /first 15000 of 20000/.test(warning), warning || 'no warning shown');
        await p4.screenshot({ path: `${OUT}/studio-smoke.png` });
        let timedFrame = null;
        for (const f of p4.frames().filter((fr) => fr.url() === 'about:srcdoc')) {
            if (await f.locator('.lla-timeline-slider').count()) timedFrame = f;
        }
        const sTypes = timedFrame ? (await timedFrame.locator('.lla-legend-type').allTextContents()).map((t) => t.trim().slice(1)).sort() : [];
        check('Studio: _time adds a timeline and src_type/dest_type add shapes with a legend', !!timedFrame && sTypes.join(',') === 'server,workstation', timedFrame ? sTypes.join(',') : 'no timeline in any Studio panel');
        check('no page errors on the Studio smoke dashboard', errors.length === 0, errors.join(' | '));
        await p4.close();
    }

    // 3. Studio dashboards.
    if (!SKIP_STUDIO) {
        const p3 = await context.newPage();
        const errors = [];
        collectErrors(p3, errors);
        await p3.goto(`${WEB}/en-US/app/${APP}/link_analysis_explorer`);
        await p3.waitForTimeout(20000);
        await dismissPopups(p3);
        const frame = p3.frames().find((f) => f.url() === 'about:srcdoc');
        const n = frame ? await frame.locator('canvas').count() : 0;
        await p3.screenshot({ path: `${OUT}/studio-explorer.png` });
        check('Studio viz renders in Link Analysis Explorer', n > 0, `${n} canvases`);

        let exportDetail = '';
        let exportOk = false;
        if (STUDIO_ONLY) {
            const tools = await frame.locator('.lla-toolbar .lla-tool').allTextContents();
            check('studio-only: toolbar is Search, Menu, Fit (no Save)', tools.join(',') === 'Search,Menu,Fit', tools.join(','));
            const menuItems = await frame.locator('datalist[id$="-menu_list"] option').evaluateAll((os) => os.map((o) => o.value));
            const removed = ['Save State', 'Export Graph JSON', 'Export Image (PNG)'].filter((m) => menuItems.includes(m));
            check('studio-only: Menu has no Save State or exports', menuItems.length > 0 && removed.length === 0, `${menuItems.length} items; present: ${removed.join(', ') || 'none'}`);
            // Typing a removed item into the Menu dialog does nothing.
            await frame.locator('.lla-tool-menu').first().click();
            await frame.fill('#menu_select', 'Save State');
            await frame.click('.lla-modal-footer .btn-primary');
            await p3.waitForTimeout(1000);
            const opened = await frame.locator('.lla-modal-title').allTextContents();
            check('studio-only: typing "Save State" in Menu opens nothing', opened.length === 0, opened.join(', ') || 'no dialog');
        } else try {
            const box = await (await frame.frameElement()).boundingBox();
            await cxtCommand(p3, frame, box.x + 40, box.y + 40, 'Menu', '#menu_select');
            await frame.fill('#menu_select', 'Export Graph JSON');
            await frame.click('.lla-modal-footer .btn-primary');
            await p3.waitForTimeout(1000);
            const json = await frame.locator('#lla_export_json').inputValue();
            const parsed = JSON.parse(json);
            exportOk = !!(parsed.elements && parsed.elements.nodes && parsed.elements.nodes.length);
            exportDetail = `${json.length} characters, ${parsed.elements.nodes.length} nodes`;
            await frame.click('.lla-modal-footer .btn-primary').catch(() => {});
        } catch (e) {
            exportDetail = e.message;
        }
        if (!STUDIO_ONLY) check('Studio "Export Graph JSON" shows the graph as JSON', exportOk, exportDetail);

        // Features kept in every edition, exercised inside Dashboard Studio.
        try {
            const fbox = await (await frame.frameElement()).boundingBox();
            const hovered = await findNode(p3, frame, { x: fbox.x, y: fbox.y + fbox.height * 0.1, width: fbox.width, height: fbox.height * 0.8 }, null)
                || await findNode(p3, frame, { x: fbox.x, y: fbox.y + fbox.height * 0.3, width: fbox.width, height: fbox.height * 0.4 }, null);
            check('Studio: hovering a node or edge shows its details', !!hovered && /Connections:|Count:/.test(hovered.text), hovered ? hovered.text.replace(/\n/g, ' | ') : 'no tooltip');
            await frame.locator('.lla-tool-search').first().click();
            await frame.fill('#node_search', 'dc-1');
            await frame.press('#node_search', 'Enter');
            await p3.waitForTimeout(1500);
            check('Studio: toolbar Search finds a node', (await frame.locator('.lla-modal-title').count()) === 0, 'searched dc-1');
            const scope = frame.locator('body');
            const menuIn = async (item) => {
                await frame.locator('.lla-tool-menu').first().click();
                await frame.fill('#menu_select', item);
                await frame.click('.lla-modal-footer .btn-primary');
                await p3.waitForTimeout(1200);
            };
            await menuIn('Size by PageRank');
            const pr = (await scope.locator('.lla-notice').allTextContents()).join(' ');
            check('Studio: Menu > Size by PageRank', /PageRank/.test(pr), pr);
            await menuIn('Find Clusters');
            const cl = await scope.locator('.lla-legend-item', { hasText: 'Cluster' }).count();
            check('Studio: Menu > Find Clusters', cl > 0, `${cl} clusters`);
            await menuIn('Filter by Connections');
            await frame.fill('#lla_min_degree', '3');
            await frame.click('.lla-modal-footer .btn-primary');
            await p3.waitForTimeout(800);
            const fl = (await scope.locator('.lla-notice').allTextContents()).join(' ');
            check('Studio: Menu > Filter by Connections', /hidden/.test(fl), fl);
            await menuIn('Clear Filters');
        } catch (e) {
            check('Studio: Explorer features (hover, search, analytics, filters)', false, e.message);
        }

        if (STUDIO_ONLY && !SKIP_KVSTORE) {
            await rest(`/servicesNS/nobody/${APP}/storage/collections/data/cyto_graphs`, { method: 'POST', json: {
                graph_id: 'smokeStudioOnly', description: 'smoke studio-only', saved_at: Math.floor(Date.now() / 1000),
                graph_info: JSON.stringify({ elements: { nodes: [{ data: { id: 'a', label: 'alpha', color: '#1f77b4' }, position: { x: 0, y: 0 } }, { data: { id: 'b', label: 'bravo' }, position: { x: 120, y: 40 } }], edges: [{ data: { id: 'ab', source: 'a', target: 'b' } }] } }),
            } });
            globalThis.savedGraphId = 'smokeStudioOnly';
        }
        if (globalThis.savedGraphId) {
            await p3.goto(`${WEB}/en-US/app/${APP}/link_analysis_historical_view?form.cytoId=${globalThis.savedGraphId}`);
            await p3.waitForTimeout(20000);
            const f2 = p3.frames().find((f) => f.url() === 'about:srcdoc');
            const shown = f2 ? await f2.locator('.lla-saved').evaluate((el) => getComputedStyle(el).display !== 'none' && !!el.querySelector('canvas')) : false;
            await p3.screenshot({ path: `${OUT}/studio-historical.png` });
            check('Historical View (Studio) loads the KV-store graph', shown, globalThis.savedGraphId);
        } else if (SKIP_KVSTORE) {
            skip('Historical View (Studio) loads the KV-store graph', 'SKIP_KVSTORE set');
        } else {
            check('Historical View (Studio) loads the KV-store graph', false, 'nothing was saved');
        }
        if (!SKIP_KVSTORE) {
            // A crafted graph written straight to the KV store (bypassing the import sanitiser)
            // must still not make the Historical View load external URLs.
            const requests = [];
            const onReq = (r) => { if (r.url().includes('127.0.0.1:9')) requests.push(r.url()); };
            p3.on('request', onReq);
            await rest(`/servicesNS/nobody/${APP}/storage/collections/data/cyto_graphs`, { method: 'POST', json: {
                graph_id: 'smokeEvilDirect', description: 'smoke evil direct', saved_at: Math.floor(Date.now() / 1000),
                graph_info: JSON.stringify({
                    style: [{ selector: 'node', style: { 'background-image': 'http://127.0.0.1:9/beacon-style.png' } }],
                    elements: { nodes: [{ data: { id: 'a', label: 'evil', color: 'url(http://127.0.0.1:9/c.png)' }, position: { x: 0, y: 0 }, style: { 'background-image': 'http://127.0.0.1:9/beacon-inline.png' } }, { data: { id: 'b', label: 'ok' }, position: { x: 80, y: 0 } }], edges: [{ data: { id: 'ab', source: 'a', target: 'b' } }] },
                }),
            } });
            await p3.goto(`${WEB}/en-US/app/${APP}/link_analysis_historical_view?form.cytoId=smokeEvilDirect`);
            await p3.waitForTimeout(20000);
            const f3 = p3.frames().find((fr) => fr.url() === 'about:srcdoc');
            const drawn = f3 ? await f3.locator('.lla-saved canvas').count() : 0;
            p3.off('request', onReq);
            check('Historical View draws crafted saved graphs without loading their URLs', drawn > 0 && requests.length === 0, `canvases=${drawn}, external requests=${requests.length}`);
        }
        check('no page errors on Studio dashboards', errors.length === 0, errors.join(' | '));
        await p3.close();
    }

    if (STUDIO_ONLY) {
        const p5 = await context.newPage();
        const res = await p5.goto(`${WEB}/en-US/app/${APP}/manage_saved_graphs`);
        await p5.waitForTimeout(4000);
        const body = await p5.locator('body').innerText();
        check('studio-only: no Manage Saved Graphs page', !/Import graph/.test(body) && (res.status() === 404 || /not found|could not find|does not exist/i.test(body)), `HTTP ${res.status()}`);
        const q = encodeURIComponent(SAMPLE);
        await p5.goto(`${WEB}/en-US/app/${APP}/search?q=${q}&earliest=-15m&latest=now&display.page.search.tab=visualizations&display.general.type=visualizations`);
        await p5.waitForTimeout(12000);
        await dismissPopups(p5);
        await p5.locator('text=Chart:').first().click().catch(() => {});
        await p5.waitForTimeout(1500);
        const picker = await p5.locator('body').innerText();
        check('studio-only: search page does not offer the Studio-only visualization', !/Licoryx Link Analysis(?! App)/.test(picker), (picker.match(/Licoryx[^\n]*/g) || []).join(' | '));
        await p5.close();
    }

    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed` +
        (skipped.length ? `, ${skipped.length} skipped` : ''));
    process.exit(failed.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
