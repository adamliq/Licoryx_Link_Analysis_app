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
            'src_group', 'dest_group', 'src_color', 'dest_color', 'src_colour', 'dest_colour'];
        if (!known.includes(third)) count = 2;
    }
    return {
        count,
        srcGroup: idx('src_group'),
        destGroup: idx('dest_group'),
        srcColor: idx('src_color', 'src_colour'),
        destColor: idx('dest_color', 'dest_colour'),
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
        if (!nodes.has(name)) nodes.set(name, { group: null, color: null, degree: 0, weight: 0 });
        return nodes.get(name);
    };
    const value = (row, i) => (i >= 0 && row[i] !== undefined && row[i] !== null && String(row[i]) !== '' ? String(row[i]) : null);
    rows.forEach((row) => {
        const count = columns.count >= 0 ? parseFloat(row[columns.count]) : NaN;
        const w = Number.isFinite(count) ? count : 1;
        [[row[0], columns.srcGroup, columns.srcColor], [row[1], columns.destGroup, columns.destColor]].forEach(([name, gi, ci]) => {
            const n = get(name);
            n.degree += 1;
            n.weight += w;
            const g = value(row, gi);
            if (g !== null) n.group = g;
            const c = value(row, ci);
            if (c !== null) n.color = c;
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
