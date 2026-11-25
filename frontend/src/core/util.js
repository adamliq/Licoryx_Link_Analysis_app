/*
 * Pure helpers used by the link analysis core. No DOM or Cytoscape access here,
 * so everything in this file is covered by unit tests (frontend/test/util.test.js).
 */

// Rows: default drawn, and hard upper limit fetched/drawn.
export const DEFAULT_MAX_ROWS = 10000;
export const MAX_ROWS_LIMIT = 50000;

// Above this many nodes, slow force-directed layouts fall back to "grid".
export const DEFAULT_LARGE_GRAPH_NODES = 2000;
// Above this many edges, edge labels are hidden (they are unreadable and slow).
export const EDGE_LABEL_LIMIT = 1000;
export const SLOW_LAYOUTS = ['fcose', 'cose', 'cose-bilkent', 'klay', 'dagre'];

// The classic d3 "category20" palette, used for automatic node groups.
export const CATEGORY20 = [
    '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a', '#d62728', '#ff9896', '#9467bd', '#c5b0d5',
    '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d', '#17becf', '#9edae5',
];

export function parseMaxRows(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ROWS;
    return Math.min(n, MAX_ROWS_LIMIT);
}

export function parsePositiveInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Ordinal colour scale: each new key gets the next palette colour (like d3.scaleOrdinal). */
export function ordinalColor(palette = CATEGORY20) {
    const assigned = new Map();
    return (key) => {
        const k = String(key);
        if (!assigned.has(k)) assigned.set(k, palette[assigned.size % palette.length]);
        return assigned.get(k);
    };
}

/** Count occurrences of item[keyName]; returns [{key, value}] sorted by value, descending. */
export function countByKey(items, keyName = 'name') {
    const counts = new Map();
    items.forEach((item) => {
        const k = item[keyName];
        counts.set(k, (counts.get(k) || 0) + 1);
    });
    return Array.from(counts, ([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export function isDarkColor(color) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(color).trim());
    if (!m) return false;
    const hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** Index of the first field whose name matches one of names (case-insensitive), or -1. */
export function fieldIndex(fields, names) {
    const wanted = names.map((n) => n.toLowerCase());
    return fields.findIndex((f) => wanted.includes(String(f && f.name !== undefined ? f.name : f).toLowerCase()));
}

/**
 * Work out which optional columns a result set has.
 * Columns 0 and 1 are always source and target.
 */
export function detectColumns(fields) {
    const idx = (...names) => {
        const i = fieldIndex(fields, names);
        return i > 1 ? i : -1; // never treat the source/target columns as optional fields
    };
    let count = idx('count');
    // Backwards compatible: a numeric third column was always used as the count.
    if (count === -1 && fields.length > 2) {
        const third = String(fields[2] && fields[2].name !== undefined ? fields[2].name : fields[2]).toLowerCase();
        const known = ['line_label', 'line_color', 'line_colour', 'filter_start', 'filter_end', 'remove',
            'src_group', 'dest_group', 'src_color', 'dest_color', 'src_colour', 'dest_colour', 'src_type', 'dest_type', '_time'];
        if (!known.includes(third)) count = 2;
    }
    const time = fieldIndex(fields, ['_time']);
    return {
        count,
        srcGroup: idx('src_group'),
        destGroup: idx('dest_group'),
        srcColor: idx('src_color', 'src_colour'),
        destColor: idx('dest_color', 'dest_colour'),
        srcType: idx('src_type'),
        destType: idx('dest_type'),
        time: time > 1 ? time : -1,
    };
}

/**
 * Per-node attributes from optional columns:
 *   group: from src_group / dest_group (last non-empty value wins)
 *   color: from src_color / dest_color (explicit colour)
 *   degree: number of edges touching the node
 *   weight: sum of the numeric count of edges touching the node (degree if no count)
 */
export function nodeAttributes(rows, columns) {
    const nodes = new Map();
    const get = (name) => {
        if (!nodes.has(name)) nodes.set(name, { group: null, color: null, type: null, degree: 0, weight: 0 });
        return nodes.get(name);
    };
    const value = (row, i) => (i >= 0 && row[i] !== undefined && row[i] !== null && String(row[i]) !== '' ? String(row[i]) : null);
    rows.forEach((row) => {
        const count = columns.count >= 0 ? parseFloat(row[columns.count]) : NaN;
        const w = Number.isFinite(count) ? count : 1;
        [[row[0], columns.srcGroup, columns.srcColor, columns.srcType], [row[1], columns.destGroup, columns.destColor, columns.destType]].forEach(([name, gi, ci, ti]) => {
            const n = get(name);
            n.degree += 1;
            n.weight += w;
            const g = value(row, gi);
            if (g !== null) n.group = g;
            const c = value(row, ci);
            if (c !== null && isSafeColor(c)) n.color = c;
            const t = value(row, ti === undefined ? -1 : ti);
            if (t !== null) n.type = t;
        });
    });
    return nodes;
}

/** Map a value in [min, max] to a node size in pixels [minSize, maxSize] (square-root scale). */
export function scaleSize(value, min, max, minSize = 20, maxSize = 80) {
    if (!(max > min)) return (minSize + maxSize) / 2;
    const t = Math.sqrt((value - min) / (max - min));
    return Math.round(minSize + t * (maxSize - minSize));
}

/** Node sizes for nodeSize mode 'fixed' | 'degree' | 'count'; returns Map name -> px or null for fixed. */
export function nodeSizes(attributes, mode) {
    if (mode !== 'degree' && mode !== 'count') return null;
    const key = mode === 'degree' ? 'degree' : 'weight';
    const values = Array.from(attributes.values(), (a) => a[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sizes = new Map();
    attributes.forEach((a, name) => sizes.set(name, scaleSize(a[key], min, max)));
    return sizes;
}

/** Find a node name for a search term: exact, then case-insensitive exact, then substring. */
export function matchNodeName(names, term) {
    const q = String(term || '').trim();
    if (!q) return null;
    if (names.includes(q)) return q;
    const lower = q.toLowerCase();
    return names.find((n) => String(n).toLowerCase() === lower) ||
        names.find((n) => String(n).toLowerCase().includes(lower)) ||
        null;
}

/** Drilldown data for a double-clicked node or edge. */
export function drilldownData({ srcField, destField, srcNames }, element) {
    const src = srcField || 'source';
    const dest = destField || 'target';
    if (element.kind === 'node') {
        return { [srcNames && srcNames.has(element.label) ? src : dest]: element.label };
    }
    return { [src]: element.source, [dest]: element.target };
}

/** Decide the layout to use and any notices for large graphs. */
export function planLayout(requested, nodeCount, edgeCount, largeGraphNodes = DEFAULT_LARGE_GRAPH_NODES) {
    const notices = [];
    let layout = requested || 'fcose';
    if (nodeCount > largeGraphNodes && SLOW_LAYOUTS.includes(layout)) {
        notices.push(`${nodeCount} nodes: using the "grid" layout instead of "${layout}" for speed ` +
            `(limit ${largeGraphNodes}, see "Large graph threshold").`);
        layout = 'grid';
    }
    const showEdgeLabels = edgeCount <= EDGE_LABEL_LIMIT;
    if (!showEdgeLabels) notices.push(`${edgeCount} edges: edge labels are hidden (shown up to ${EDGE_LABEL_LIMIT}).`);
    return { layout, showEdgeLabels, notices };
}

/** Context-menu colours that stay visible on dark and light backgrounds. */
export function menuColors(dark) {
    return dark
        ? { fillColor: 'rgba(78, 86, 98, 0.94)', activeFillColor: 'rgba(232, 48, 74, 0.9)', itemColor: '#ffffff', itemTextShadowColor: 'transparent' }
        : { fillColor: 'rgba(32, 34, 40, 0.86)', activeFillColor: 'rgba(232, 48, 74, 0.9)', itemColor: '#ffffff', itemTextShadowColor: 'transparent' };
}

/** Validate pasted Cytoscape JSON (from "Export Graph JSON") before importing it. */
export function parseGraphJson(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error('Not valid JSON');
    }
    const graph = parsed && parsed.graph_info ? parsed.graph_info : parsed;
    if (!graph || typeof graph !== 'object' || !graph.elements) throw new Error('JSON has no "elements" (not a Cytoscape graph)');
    return graph;
}

// ---------------------------------------------------------------------------
// 2.4.0: safety of saved graphs, node expansion, styling and timeline helpers
// ---------------------------------------------------------------------------

const NAMED_COLOR = /^[a-z]{3,20}$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/+-]+\)$/i;

/** True for plain CSS colours (hex, rgb()/hsl(), or a colour keyword) - never url() or other functions. */
export function isSafeColor(value) {
    const v = String(value === undefined || value === null ? '' : value).trim();
    return HEX_COLOR.test(v) || FUNC_COLOR.test(v) || NAMED_COLOR.test(v);
}

// Classes the visualization itself adds to elements; anything else in a saved graph is dropped.
export const KNOWN_CLASSES = ['highlighted', 'nodehighlighted', 'nodehighlightedchildren', 'lla-filtered', 'lla-hidden-time'];

function cleanString(value, max = 1000) {
    if (value === undefined || value === null) return undefined;
    const s = String(value);
    return s.length > max ? s.slice(0, max) : s;
}

function cleanNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function cleanClasses(classes) {
    const list = Array.isArray(classes) ? classes : String(classes || '').split(/\s+/);
    return list.filter((c) => KNOWN_CLASSES.includes(c)).join(' ');
}

function cleanElement(el, kind) {
    if (!el || typeof el !== 'object' || !el.data || el.data.id === undefined) return null;
    const d = el.data;
    const data = { id: cleanString(d.id, 200) };
    if (kind === 'edges') {
        if (d.source === undefined || d.target === undefined) return null;
        data.source = cleanString(d.source, 200);
        data.target = cleanString(d.target, 200);
    }
    const label = cleanString(d.label);
    if (label !== undefined) data.label = label;
    if (isSafeColor(d.color)) data.color = String(d.color).trim();
    ['size', 'width', 'weight', 'count', 'time'].forEach((k) => {
        const n = cleanNumber(d[k]);
        if (n !== undefined) data[k] = n;
    });
    ['group', 'type', 'shape'].forEach((k) => {
        const v = cleanString(d[k], 200);
        if (v !== undefined) data[k] = v;
    });
    const out = { data };
    if (kind === 'nodes' && el.position) {
        const x = cleanNumber(el.position.x);
        const y = cleanNumber(el.position.y);
        if (x !== undefined && y !== undefined) out.position = { x, y };
    }
    const classes = cleanClasses(el.classes);
    if (classes) out.classes = classes;
    return out;
}

/**
 * Reduce a saved Cytoscape graph to data the visualization understands: element ids,
 * labels, safe colours, numbers, positions and known classes. Stylesheets, URLs
 * (e.g. background-image), scripts and unknown properties are dropped, so a crafted
 * saved graph cannot make the viewer's browser load external resources.
 */
export function sanitizeGraph(graph) {
    const elements = graph && graph.elements ? graph.elements : {};
    let nodes = [];
    let edges = [];
    if (Array.isArray(elements)) {
        elements.forEach((el) => {
            if (el && el.group === 'edges') edges.push(el);
            else if (el && el.data && el.data.source !== undefined && el.data.target !== undefined) edges.push(el);
            else nodes.push(el);
        });
    } else {
        nodes = elements.nodes || [];
        edges = elements.edges || [];
    }
    const cleanNodes = nodes.map((n) => cleanElement(n, 'nodes')).filter(Boolean);
    const ids = new Set(cleanNodes.map((n) => n.data.id));
    const cleanEdges = edges.map((e) => cleanElement(e, 'edges'))
        .filter((e) => e && ids.has(e.data.source) && ids.has(e.data.target));
    const out = { elements: { nodes: cleanNodes, edges: cleanEdges } };
    const zoom = cleanNumber(graph && graph.zoom);
    if (zoom !== undefined && zoom > 0) out.zoom = zoom;
    if (graph && graph.pan) {
        const x = cleanNumber(graph.pan.x);
        const y = cleanNumber(graph.pan.y);
        if (x !== undefined && y !== undefined) out.pan = { x, y };
    }
    return out;
}

/** Escape a value for use inside a double-quoted SPL string. */
export function escapeSplValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the "Expand node" search. The node name is always added as an escaped,
 * double-quoted search term (never pasted raw into SPL):
 *   base  "index=fw sourcetype=fw"      -> search index=fw sourcetype=fw "<node>" <stats>
 *   base  "| inputlookup x | search"    -> | inputlookup x | search "<node>" <stats>
 * stats defaults to "| stats count by src dest" style output supplied by the caller.
 */
export function buildExpandSearch(base, stats, nodeName) {
    const b = String(base || '').trim();
    if (!b) throw new Error('No "Expand base search" is configured');
    const term = `"${escapeSplValue(nodeName)}"`;
    const tail = String(stats || '').trim();
    const head = b.startsWith('|') ? b : `search ${b}`;
    return `${head} ${term}${tail ? ' ' + (tail.startsWith('|') ? tail : '| ' + tail) : ''}`;
}

/** Positions for n new nodes on a circle around an anchor position. */
export function ringPositions(anchor, n, radius = 160) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / Math.max(n, 1);
        out.push({ x: Math.round(anchor.x + radius * Math.cos(a)) || 0, y: Math.round(anchor.y + radius * Math.sin(a)) || 0 });
    }
    return out;
}

/** Edge widths (px) from counts, square-root scaled to [minW, maxW]; null for "fixed". */
export function edgeWidths(counts, mode, minW = 2, maxW = 14) {
    if (mode !== 'count') return null;
    const values = counts.map((c) => {
        const n = parseFloat(c);
        return Number.isFinite(n) ? n : 1;
    });
    const min = Math.min(...values);
    const max = Math.max(...values);
    return values.map((v) => scaleSize(v, min, max, minW, maxW));
}

export const NODE_SHAPES = ['ellipse', 'round-rectangle', 'triangle', 'diamond', 'hexagon', 'star', 'vee', 'pentagon', 'octagon', 'rhomboid'];
// Legend symbols matching NODE_SHAPES.
export const SHAPE_SYMBOLS = ['●', '▢', '▲', '◆', '⬢', '★', '⌄', '⬟', '⯃', '▱'];

/** Ordinal shape scale for node types: returns (type) => {shape, symbol}. */
export function shapeScale() {
    const assigned = new Map();
    return (type) => {
        const k = String(type);
        if (!assigned.has(k)) {
            const i = assigned.size % NODE_SHAPES.length;
            assigned.set(k, { shape: NODE_SHAPES[i], symbol: SHAPE_SYMBOLS[i] });
        }
        return assigned.get(k);
    };
}

/** Parse a Splunk _time value (epoch seconds, or an ISO-8601 string) to epoch milliseconds, or NaN. */
export function parseTime(value) {
    if (value === undefined || value === null || value === '') return NaN;
    const s = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s) * 1000;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
}

/** Sorted unique times for the timeline slider (at most maxSteps, evenly sampled). */
export function timelineSteps(times, maxSteps = 200) {
    const unique = Array.from(new Set(times.filter(Number.isFinite))).sort((a, b) => a - b);
    if (unique.length <= maxSteps) return unique;
    const out = [];
    for (let i = 0; i < maxSteps; i++) out.push(unique[Math.round((i * (unique.length - 1)) / (maxSteps - 1))]);
    return Array.from(new Set(out));
}

/** Fields that are part of the graph model; others on a row are shown in tooltips. */
export const RESERVED_FIELDS = ['count', 'line_label', 'line_color', 'line_colour', 'filter_start', 'filter_end', 'remove',
    'src_group', 'dest_group', 'src_color', 'dest_color', 'src_colour', 'dest_colour', 'src_type', 'dest_type', '_time'];

/** Extra fields of a row (beyond source/target and reserved fields) for tooltips. */
export function extraFields(fields, row, limit = 8) {
    const out = [];
    fields.forEach((f, i) => {
        const name = String(f && f.name !== undefined ? f.name : f);
        if (i < 2 || RESERVED_FIELDS.includes(name.toLowerCase()) || name.startsWith('_')) return;
        const v = row[i];
        if (v === undefined || v === null || v === '') return;
        if (out.length < limit) out.push([name, String(v)]);
    });
    return out;
}
