/*
 * Graph features that work on a Cytoscape instance and a container element:
 * hover details, toolbar, timeline playback, analytics, filters, PNG export and the
 * stylesheet for saved graphs. Used by link_analysis_core.js (both builds) and by the
 * Studio entry (saved graphs).
 */
import { ordinalColor, parseTime, timelineSteps } from './util.js';

// ---------------------------------------------------------------------------
// Hover details
// ---------------------------------------------------------------------------

/** Show a small details panel when hovering nodes and edges. */
export function attachTooltip(cy, container) {
    let tip = container.querySelector('.lla-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'lla-tooltip';
        tip.setAttribute('role', 'tooltip');
        container.appendChild(tip);
    }
    tip.style.display = 'none';

    const row = (k, v) => {
        const r = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = `${k}: `;
        r.appendChild(b);
        r.appendChild(document.createTextNode(String(v)));
        return r;
    };

    function show(evt) {
        const ele = evt.target;
        tip.textContent = '';
        if (ele.isNode()) {
            const title = document.createElement('div');
            title.className = 'lla-tooltip-title';
            title.textContent = ele.data('label');
            tip.appendChild(title);
            tip.appendChild(row('Connections', ele.degree(false)));
            if (ele.data('weight_total') !== undefined) tip.appendChild(row('Total count', ele.data('weight_total')));
            if (ele.data('group')) tip.appendChild(row('Group', ele.data('group')));
            if (ele.data('type')) tip.appendChild(row('Type', ele.data('type')));
            if (ele.data('metric') !== undefined) tip.appendChild(row(ele.data('metricName') || 'Score', Number(ele.data('metric')).toFixed(4)));
        } else {
            const title = document.createElement('div');
            title.className = 'lla-tooltip-title';
            title.textContent = `${ele.source().data('label')} → ${ele.target().data('label')}`;
            tip.appendChild(title);
            if (ele.data('count') !== undefined) tip.appendChild(row('Count', ele.data('count')));
            if (ele.data('label')) tip.appendChild(row('Label', ele.data('label')));
            if (ele.data('time') !== undefined) tip.appendChild(row('Time', new Date(ele.data('time')).toLocaleString()));
            (ele.data('extra') || []).forEach(([k, v]) => tip.appendChild(row(k, v)));
        }
        const pos = evt.renderedPosition || ele.renderedPosition();
        const maxX = container.clientWidth - 240;
        tip.style.left = `${Math.max(4, Math.min(pos.x + 14, maxX))}px`;
        tip.style.top = `${Math.max(4, pos.y + 14)}px`;
        tip.style.display = 'block';
    }
    cy.on('mouseover', 'node, edge', show);
    cy.on('mouseout', 'node, edge', () => { tip.style.display = 'none'; });
    cy.on('pan zoom tapstart', () => { tip.style.display = 'none'; });
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/**
 * Small on-graph toolbar so the main actions are visible and keyboard accessible.
 * actions: [{id, label, title, handler}]
 */
export function createToolbar(container, actions) {
    let bar = container.querySelector('.lla-toolbar');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.className = 'lla-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Link analysis actions');
    actions.forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `lla-tool lla-tool-${a.id}`;
        b.textContent = a.label;
        b.title = a.title || a.label;
        b.setAttribute('aria-label', a.title || a.label);
        b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            a.handler();
        });
        bar.appendChild(b);
    });
    container.appendChild(bar);
    return bar;
}

// ---------------------------------------------------------------------------
// Timeline playback
// ---------------------------------------------------------------------------

/**
 * If edges carry a time (from _time), show a slider that reveals the graph up to a
 * point in time, with play/pause. Returns a cleanup function.
 */
export function createTimeline(cy, container) {
    const old = container.querySelector('.lla-timeline');
    if (old) old.remove();
    const edges = cy.edges().filter((e) => Number.isFinite(e.data('time')));
    if (edges.length === 0) return () => {};
    const steps = timelineSteps(edges.map((e) => e.data('time')));
    if (steps.length < 2) return () => {};

    const box = document.createElement('div');
    box.className = 'lla-timeline';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'lla-timeline-play';
    play.textContent = '▶';
    play.title = 'Play timeline';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(steps.length - 1);
    slider.value = String(steps.length - 1);
    slider.className = 'lla-timeline-slider';
    slider.setAttribute('aria-label', 'Show the graph up to this time');
    const label = document.createElement('span');
    label.className = 'lla-timeline-label';
    box.append(play, slider, label);
    container.appendChild(box);

    function apply() {
        const t = steps[Number(slider.value)];
        label.textContent = new Date(t).toLocaleString();
        cy.batch(() => {
            cy.edges().forEach((e) => {
                const et = e.data('time');
                e.toggleClass('lla-hidden-time', Number.isFinite(et) && et > t);
            });
            cy.nodes().forEach((n) => {
                const visible = n.connectedEdges().some((e) => !e.hasClass('lla-hidden-time')) || n.connectedEdges().length === 0;
                n.toggleClass('lla-hidden-time', !visible);
            });
        });
    }
    let timer = null;
    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
        play.textContent = '▶';
        play.title = 'Play timeline';
    }
    play.addEventListener('click', () => {
        if (timer) { stop(); return; }
        if (Number(slider.value) >= steps.length - 1) slider.value = '0';
        apply();
        play.textContent = '⏸';
        play.title = 'Pause timeline';
        timer = setInterval(() => {
            if (Number(slider.value) >= steps.length - 1) { stop(); return; }
            slider.value = String(Number(slider.value) + 1);
            apply();
        }, Math.max(80, Math.round(8000 / steps.length)));
    });
    slider.addEventListener('input', () => { stop(); apply(); });
    apply();
    return () => { stop(); box.remove(); };
}

/** Edge time in epoch ms from a row value (used when building edges). */
export const edgeTime = parseTime;

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

function sizeNodesBy(cy, values, name) {
    const nums = Array.from(values.values());
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    cy.batch(() => {
        cy.nodes().forEach((n) => {
            const v = values.get(n.id()) || 0;
            const t = max > min ? Math.sqrt((v - min) / (max - min)) : 0.5;
            n.data('size', Math.round(20 + t * 60));
            n.data('metric', v);
            n.data('metricName', name);
        });
    });
    cy.style().selector('node[size]').style({ width: 'data(size)', height: 'data(size)' }).update();
}

/** Size nodes by PageRank. */
export function applyPageRank(cy) {
    const pr = cy.elements().pageRank();
    const values = new Map(cy.nodes().map((n) => [n.id(), pr.rank(n)]));
    sizeNodesBy(cy, values, 'PageRank');
    return 'Node size now shows PageRank (importance by incoming links).';
}

/** Size nodes by betweenness centrality (how often a node is on shortest paths). */
export function applyBetweenness(cy, directed) {
    const bc = cy.elements().betweennessCentrality({ directed: !!directed });
    const values = new Map(cy.nodes().map((n) => [n.id(), bc.betweennessNormalized(n)]));
    sizeNodesBy(cy, values, 'Betweenness');
    return 'Node size now shows betweenness (how often a node lies on shortest paths between others).';
}

/** Colour nodes by community (Markov clustering). Returns a Map of cluster -> colour for the legend. */
export function applyClusters(cy) {
    const clusters = cy.elements().markovClustering({ attributes: [() => 1] });
    const color = ordinalColor();
    const legend = new Map();
    cy.batch(() => {
        clusters.forEach((cluster, i) => {
            const name = `Cluster ${i + 1} (${cluster.length})`;
            const c = color(name);
            legend.set(name, c);
            cluster.forEach((n) => { n.data('color', c); n.data('group', name); });
        });
    });
    return legend;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Hide nodes with fewer than minDegree connections (and their edges). Returns hidden node count. */
export function filterByDegree(cy, minDegree) {
    let hidden = 0;
    cy.batch(() => {
        cy.elements().removeClass('lla-filtered');
        cy.nodes().forEach((n) => {
            if (n.degree(false) < minDegree) {
                n.addClass('lla-filtered');
                n.connectedEdges().addClass('lla-filtered');
                hidden += 1;
            }
        });
    });
    return hidden;
}

/** Show only the k-hop neighbourhood of a node. Returns the number of visible nodes. */
export function filterNeighbourhood(cy, node, hops) {
    let keep = node;
    for (let i = 0; i < hops; i++) keep = keep.union(keep.closedNeighborhood());
    cy.batch(() => {
        cy.elements().removeClass('lla-filtered');
        cy.elements().difference(keep).addClass('lla-filtered');
    });
    return keep.nodes().length;
}

export function clearFilters(cy) {
    cy.elements().removeClass('lla-filtered');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** PNG of the whole graph as a data URL. */
export function graphPng(cy, background) {
    return cy.png({ full: true, scale: 2, bg: background || '#ffffff', maxWidth: 8000, maxHeight: 8000 });
}

/** Try to download a data URL as a file (blocked in Dashboard Studio's sandbox; callers show it too). */
export function downloadDataUrl(dataUrl, filename) {
    try {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return true;
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Classes used by filters and the timeline; added to every graph's stylesheet. */
export function applyFeatureStyles(cy) {
    cy.style()
        .selector('.lla-filtered')
        .style({ display: 'none' })
        .selector('.lla-hidden-time')
        .style({ display: 'none' })
        .selector('node[shape]')
        .style({ shape: 'data(shape)' })
        .selector('edge[width]')
        .style({ width: 'data(width)' })
        .update();
}

/**
 * Stylesheet for saved graphs (they are sanitised, so their own styles are dropped).
 * Mirrors the live graph: labels, data colours, sizes, shapes, highlight classes.
 */
export function savedGraphStyle(dark, background) {
    const fg = dark ? '#ffffff' : '#000000';
    const bg = background || (dark ? '#212527' : '#ffffff');
    return [
        { selector: 'node', style: { label: 'data(label)', color: fg, 'min-zoomed-font-size': 15 } },
        { selector: 'node[color]', style: { 'background-color': 'data(color)' } },
        { selector: 'node[size]', style: { width: 'data(size)', height: 'data(size)' } },
        { selector: 'node[shape]', style: { shape: 'data(shape)' } },
        {
            selector: 'edge',
            style: {
                width: 5, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 2, opacity: 0.3, 'text-opacity': 0.1,
                color: fg, 'text-background-color': bg, 'text-background-opacity': 0.8, 'min-zoomed-font-size': 15,
            },
        },
        { selector: 'edge[color]', style: { 'line-color': 'data(color)', 'target-arrow-color': 'data(color)' } },
        { selector: 'edge[label]', style: { label: 'data(label)' } },
        { selector: 'edge[width]', style: { width: 'data(width)' } },
        { selector: '.nodehighlighted, .nodehighlightedchildren', style: { 'border-width': 5, 'border-color': 'red' } },
        { selector: '.highlighted', style: { 'background-color': '#61bffc', 'line-color': '#cc0000', 'target-arrow-color': '#cc0000', opacity: 1 } },
        { selector: '.lla-filtered, .lla-hidden-time', style: { display: 'none' } },
    ];
}
