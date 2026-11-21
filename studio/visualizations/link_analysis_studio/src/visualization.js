/*
 * Licoryx Link Analysis - Dashboard Studio visualization entry point.
 *
 * Bridges the Dashboard Studio extension API (@splunk/dashboard-studio-extension)
 * to the link analysis logic in link_analysis_core.js, which was written against
 * the classic SplunkVisualizationBase API. Small stand-ins for that API are
 * defined below so the core logic is shared in behaviour with the classic viz.
 */
import { VisualizationAPI } from '@splunk/dashboard-studio-extension';
import cytoscape from 'cytoscape';
import createLinkAnalysis from './link_analysis_core.js';
import './visualization.css';

// Option keys the core reads (same names as the classic viz / savedsearches.conf).
const NAMESPACE = 'display.visualizations.custom.licoryx_link_analysis_app.link_analysis.';
const DEFAULT_OPTIONS = {
    layoutStyle: 'fcose',
    pathAlgo: 'dijkstra',
    directed: false,
    recursiveLookup: true,
};

let currentTheme = 'light';

// ---------------------------------------------------------------------------
// Stand-ins for api/SplunkVisualizationUtils and api/SplunkVisualizationBase
// ---------------------------------------------------------------------------

const SplunkVisualizationUtils = {
    getCurrentTheme: () => currentTheme,
    escapeHtml(value) {
        if (value === undefined || value === null) return value;
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    normalizeBoolean(value, opts) {
        if (value === undefined || value === null || value === '') {
            return opts && 'default' in opts ? opts.default : false;
        }
        if (typeof value === 'boolean') return value;
        return ['true', '1', 'yes', 'on', 't', 'y'].includes(String(value).trim().toLowerCase());
    },
};

class VisualizationError extends Error {}

function SplunkVisualizationBase(el) {
    this.el = el;
}
SplunkVisualizationBase.prototype.initialize = function initialize() {};
SplunkVisualizationBase.prototype.getPropertyNamespaceInfo = function getPropertyNamespaceInfo() {
    return { propertyNamespace: NAMESPACE };
};
SplunkVisualizationBase.prototype.invalidateUpdateView = function invalidateUpdateView() {
    scheduleRender();
};
SplunkVisualizationBase.prototype.drilldown = function drilldown(spec, browserEvent) {
    // The classic viz drills down on double-click; report the clicked element.
    const target = browserEvent && browserEvent.target;
    const isElement = target && typeof target.isNode === 'function';
    const payload = isElement
        ? { name: target.isNode() ? 'node' : 'edge', value: target.data('name') || target.data('label') || target.id(), data: target.data() }
        : { data: spec && spec.data };
    VisualizationAPI.triggerDrilldown({
        action: 'custom.dblclick',
        payload,
        originalEvent: browserEvent && browserEvent.originalEvent,
    });
};
SplunkVisualizationBase.extend = function extend(proto) {
    function Viz(el) {
        SplunkVisualizationBase.call(this, el);
    }
    Viz.prototype = Object.create(SplunkVisualizationBase.prototype);
    Object.assign(Viz.prototype, proto);
    Viz.prototype.constructor = Viz;
    return Viz;
};
SplunkVisualizationBase.VisualizationError = VisualizationError;
SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE = 'json_rows';
SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN = 'fieldvalue';

const LinkAnalysisViz = createLinkAnalysis(SplunkVisualizationBase, SplunkVisualizationUtils);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const rootElement = document.getElementById('root') || document.body;
const container = document.createElement('div');
container.className = 'lla-container';
rootElement.appendChild(container);

// Separate container for "saved state" graphs (Historical View), see renderSavedState().
const savedContainer = document.createElement('div');
savedContainer.className = 'lla-saved';
rootElement.appendChild(savedContainer);
let savedCy = null;

const message = document.createElement('div');
message.className = 'lla-message';
rootElement.appendChild(message);

const viz = new LinkAnalysisViz(container);
viz.initialize();

const state = { data: null, loading: false, options: {} };
let renderQueued = false;
let lastRenderKey = null;

function showMessage(text) {
    message.textContent = text || '';
    message.style.display = text ? 'flex' : 'none';
}

// Studio delivers column-major data: { fields: [{name}], columns: [[...], ...] }.
// The core expects the classic row-major format: { fields, rows: [[...], ...] }.
function toRowMajor(data) {
    const fields = (data.fields || []).map((f) => (typeof f === 'string' ? { name: f } : f));
    let rows = [];
    if (Array.isArray(data.rows) && data.rows.length) {
        rows = data.rows;
    } else if (Array.isArray(data.columns) && data.columns.length) {
        const n = data.columns[0].length;
        rows = Array.from({ length: n }, (_, i) => data.columns.map((col) => col[i]));
    }
    return { fields, rows };
}

// A saved graph (written by the "Save State" menu via HEC, sourcetype cyto:graph)
// arrives as a result with _raw (or graph_info) holding Cytoscape JSON.
function findSavedState(data) {
    const idx = (name) => data.fields.findIndex((f) => f.name === name);
    const rawIdx = idx('_raw') >= 0 ? idx('_raw') : idx('graph_info');
    if (rawIdx < 0 || !data.rows.length) return null;
    const value = data.rows[0][rawIdx];
    if (typeof value !== 'string' || value.trim().charAt(0) !== '{') return null;
    try {
        const parsed = JSON.parse(value);
        const graph = parsed.graph_info || parsed;
        return graph && graph.elements ? graph : null;
    } catch (e) {
        return null;
    }
}

function renderSavedState(graph) {
    container.style.display = 'none';
    savedContainer.style.display = 'block';
    if (savedCy) savedCy.destroy();
    savedCy = cytoscape({ container: savedContainer });
    savedCy.json(graph);
    const dark = currentTheme === 'dark';
    const bg = dark ? '#212527' : '#ffffff';
    const fg = dark ? '#ffffff' : '#000000';
    savedCy.style().selector('core').style({ background: bg });
    savedCy.style().selector('edge').style({ color: fg, 'text-background-color': bg });
    savedCy.style().selector('node').style({ color: fg }).update();
    savedCy.layout({ name: 'preset' }).run();
    savedCy.fit(undefined, 20);
}

function toClassicConfig(options) {
    const config = {};
    Object.keys(DEFAULT_OPTIONS).forEach((key) => {
        const value = options && options[key] !== undefined && options[key] !== null ? options[key] : DEFAULT_OPTIONS[key];
        config[NAMESPACE + key] = String(value);
    });
    return config;
}

function render() {
    renderQueued = false;
    if (state.loading && !state.data) {
        showMessage('Loading data...');
        return;
    }
    if (!state.data) {
        showMessage('No data available. Search for a source, a target and optionally a count, e.g. | table src_ip, dest_ip, count');
        return;
    }
    const data = toRowMajor(state.data);
    if (data.rows.length < 1) {
        showMessage('No results');
        return;
    }
    const config = toClassicConfig(state.options);
    // Avoid re-running the (expensive) layout when nothing relevant changed.
    const renderKey = JSON.stringify([data, config, currentTheme]);
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;

    showMessage('');
    try {
        VisualizationAPI.clearError();
        const saved = findSavedState(data);
        if (saved) {
            renderSavedState(saved);
            return;
        }
        savedContainer.style.display = 'none';
        container.style.display = 'block';
        const formatted = viz.formatData(data, config);
        viz.updateView(formatted, config);
    } catch (err) {
        lastRenderKey = null;
        // eslint-disable-next-line no-console
        console.error(err);
        VisualizationAPI.setError(err && err.message ? err.message : String(err));
    }
}

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    // Coalesce bursts of listener callbacks (data + options + theme on load).
    setTimeout(render, 0);
}

VisualizationAPI.addThemeListener(
    ({ theme }) => {
        const next = theme === 'dark' ? 'dark' : 'light';
        if (next === currentTheme && lastRenderKey !== null) return;
        currentTheme = next;
        document.documentElement.setAttribute('data-theme', currentTheme);
        viz.initialize();
        scheduleRender();
    },
    { invokeImmediately: true }
);

VisualizationAPI.addOptionsListener(
    ({ options }) => {
        state.options = options || {};
        scheduleRender();
    },
    { invokeImmediately: true }
);

VisualizationAPI.addDataSourcesListener(
    ({ dataSources, loading }) => {
        state.loading = loading;
        const data = dataSources && dataSources.primary && dataSources.primary.data;
        if (data) state.data = data;
        else if (!loading) state.data = null;
        scheduleRender();
    },
    { invokeImmediately: true }
);

VisualizationAPI.addDimensionsListener(
    () => {
        // Cytoscape tracks its container size; ask it to re-check after a resize.
        if (savedCy) {
            savedCy.resize();
            savedCy.fit(undefined, 20);
        }
        const cyEl = document.getElementById('cy');
        if (cyEl) window.dispatchEvent(new Event('resize'));
    },
    { invokeImmediately: false }
);
