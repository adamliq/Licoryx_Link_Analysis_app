import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CATEGORY20, DEFAULT_MAX_ROWS, MAX_ROWS_LIMIT, countByKey, detectColumns, drilldownData, fieldIndex, isDarkColor,
    matchNodeName, menuColors, nodeAttributes, nodeSizes, ordinalColor, parseGraphJson, parseMaxRows, parsePositiveInt,
    planLayout, scaleSize, isSafeColor, sanitizeGraph, escapeSplValue, buildExpandSearch, ringPositions, edgeWidths,
    shapeScale, NODE_SHAPES, parseTime, timelineSteps, extraFields,
} from '../src/core/util.js';

const f = (...names) => names.map((name) => ({ name }));

test('parseMaxRows: default, clamp and invalid values', () => {
    assert.equal(parseMaxRows(undefined), DEFAULT_MAX_ROWS);
    assert.equal(parseMaxRows('abc'), DEFAULT_MAX_ROWS);
    assert.equal(parseMaxRows('0'), DEFAULT_MAX_ROWS);
    assert.equal(parseMaxRows('250'), 250);
    assert.equal(parseMaxRows('999999'), MAX_ROWS_LIMIT);
    assert.equal(parsePositiveInt('-3', 7), 7);
    assert.equal(parsePositiveInt('12', 7), 12);
});

test('ordinalColor assigns palette colours in first-seen order and is stable', () => {
    const color = ordinalColor();
    assert.equal(color('a'), CATEGORY20[0]);
    assert.equal(color('b'), CATEGORY20[1]);
    assert.equal(color('a'), CATEGORY20[0]);
    const small = ordinalColor(['#111', '#222']);
    small('x'); small('y');
    assert.equal(small('z'), '#111'); // wraps around
});

test('countByKey counts and sorts descending', () => {
    const r = countByKey([{ name: 'a' }, { name: 'b' }, { name: 'a' }]);
    assert.deepEqual(r, [{ key: 'a', value: 2 }, { key: 'b', value: 1 }]);
});

test('isDarkColor', () => {
    assert.equal(isDarkColor('#000000'), true);
    assert.equal(isDarkColor('#212527'), true);
    assert.equal(isDarkColor('#fff'), false);
    assert.equal(isDarkColor('#ffeecc'), false);
    assert.equal(isDarkColor('not a colour'), false);
});

test('fieldIndex is case-insensitive', () => {
    assert.equal(fieldIndex(f('src', 'dest', 'Count'), ['count']), 2);
    assert.equal(fieldIndex(f('src', 'dest'), ['count']), -1);
});

test('detectColumns: named count, legacy numeric third column, optional fields', () => {
    assert.deepEqual(detectColumns(f('s', 'd', 'line_label', 'count')).count, 3);
    assert.equal(detectColumns(f('s', 'd', 'hits')).count, 2); // legacy: third column is the count
    assert.equal(detectColumns(f('s', 'd', 'line_label')).count, -1); // previously misread as the count
    const c = detectColumns(f('s', 'd', 'count', 'src_group', 'dest_group', 'src_colour', 'dest_color'));
    assert.deepEqual(c, { count: 2, srcGroup: 3, destGroup: 4, srcColor: 5, destColor: 6, srcType: -1, destType: -1, time: -1 });
    const t = detectColumns(f('s', 'd', 'src_type', 'dest_type', '_time'));
    assert.deepEqual([t.count, t.srcType, t.destType, t.time], [-1, 2, 3, 4]);
    assert.equal(detectColumns(f('count', 'dest')).count, -1); // source/target columns are never optional fields
});

test('nodeAttributes: degree, weighted count, groups and colours', () => {
    const fields = f('s', 'd', 'count', 'src_group', 'dest_group', 'src_color');
    const rows = [
        ['a', 'b', '3', 'web', 'db', ''],
        ['a', 'c', '2', 'web', '', '#ff0000'],
        ['c', 'b', 'x', '', 'db', ''],
    ];
    const attrs = nodeAttributes(rows, detectColumns(fields));
    assert.deepEqual(attrs.get('a'), { group: 'web', color: '#ff0000', type: null, degree: 2, weight: 5 });
    assert.deepEqual(attrs.get('b'), { group: 'db', color: null, type: null, degree: 2, weight: 4 }); // non-numeric count counts as 1
    assert.deepEqual(attrs.get('c'), { group: null, color: null, type: null, degree: 2, weight: 3 });
    // unsafe colours are ignored
    const bad = nodeAttributes([['a', 'b', '1', '', '', 'url(http://x)']], detectColumns(fields));
    assert.equal(bad.get('a').color, null);
});

test('nodeSizes and scaleSize', () => {
    const attrs = new Map([['a', { degree: 1, weight: 1 }], ['b', { degree: 4, weight: 100 }]]);
    assert.equal(nodeSizes(attrs, 'fixed'), null);
    const byDegree = nodeSizes(attrs, 'degree');
    assert.equal(byDegree.get('a'), 20);
    assert.equal(byDegree.get('b'), 80);
    assert.equal(scaleSize(5, 5, 5), 50); // all equal -> middle size
});

test('matchNodeName: exact, case-insensitive, substring, none', () => {
    const names = ['dc01.corp', 'DC02.corp', '10.1.4.23'];
    assert.equal(matchNodeName(names, 'dc01.corp'), 'dc01.corp');
    assert.equal(matchNodeName(names, 'dc02.CORP'), 'DC02.corp');
    assert.equal(matchNodeName(names, '4.23'), '10.1.4.23');
    assert.equal(matchNodeName(names, '  '), null);
    assert.equal(matchNodeName(names, 'zzz'), null);
});

test('drilldownData for nodes and edges', () => {
    const ctx = { srcField: 'src_ip', destField: 'dest_ip', srcNames: new Set(['alpha']) };
    assert.deepEqual(drilldownData(ctx, { kind: 'node', label: 'alpha' }), { src_ip: 'alpha' });
    assert.deepEqual(drilldownData(ctx, { kind: 'node', label: 'bravo' }), { dest_ip: 'bravo' });
    assert.deepEqual(drilldownData(ctx, { kind: 'edge', source: 'alpha', target: 'bravo' }), { src_ip: 'alpha', dest_ip: 'bravo' });
    assert.deepEqual(drilldownData({}, { kind: 'edge', source: 'a', target: 'b' }), { source: 'a', target: 'b' });
});

test('planLayout: large graph fallback and edge label limit', () => {
    assert.deepEqual(planLayout('fcose', 100, 200), { layout: 'fcose', showEdgeLabels: true, notices: [] });
    const big = planLayout('fcose', 5000, 200, 2000);
    assert.equal(big.layout, 'grid');
    assert.equal(big.notices.length, 1);
    assert.equal(planLayout('circle', 5000, 10).layout, 'circle'); // fast layouts are kept
    const edges = planLayout('grid', 10, 5000);
    assert.equal(edges.showEdgeLabels, false);
    assert.match(edges.notices[0], /edge labels are hidden/);
});

test('menuColors differ for dark and light backgrounds', () => {
    assert.notEqual(menuColors(true).fillColor, menuColors(false).fillColor);
    assert.equal(menuColors(true).itemColor, '#ffffff');
});

test('parseGraphJson accepts exported graphs and HEC-style wrappers', () => {
    assert.deepEqual(parseGraphJson('{"elements":{"nodes":[]}}'), { elements: { nodes: [] } });
    assert.deepEqual(parseGraphJson('{"graph_info":{"elements":[]}}'), { elements: [] });
    assert.throws(() => parseGraphJson('nope'), /Not valid JSON/);
    assert.throws(() => parseGraphJson('{"a":1}'), /no "elements"/);
});

test('isSafeColor accepts plain colours and rejects url()/expressions', () => {
    for (const c of ['#fff', '#e8304a', '#11223344', 'red', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(10, 50%, 50%)']) assert.equal(isSafeColor(c), true, c);
    for (const c of ['url(http://evil/x.png)', 'red;background-image:url(x)', 'expression(alert(1))', '', null, 'var(--x)']) assert.equal(isSafeColor(c), false, String(c));
});

test('sanitizeGraph keeps graph data and drops styles, URLs and unknown properties', () => {
    const graph = {
        style: [{ selector: 'node', style: { 'background-image': 'http://evil/beacon.png' } }],
        zoom: 1.5, pan: { x: 10, y: 20 }, renderer: { name: 'evil' },
        elements: {
            nodes: [
                { data: { id: 'n0', label: 'a', color: 'url(http://evil)', size: '40', onload: 'x' }, position: { x: 1, y: 2 }, classes: 'highlighted evil', style: { 'background-image': 'http://evil' } },
                { data: { id: 'n1', label: 'b', color: '#123456' }, position: { x: 'NaN', y: 3 } },
            ],
            edges: [
                { data: { id: 'e0', source: 'n0', target: 'n1', label: 'x', color: 'green', width: 4 } },
                { data: { id: 'e1', source: 'n0', target: 'missing' } },
            ],
        },
    };
    const clean = sanitizeGraph(graph);
    assert.deepEqual(clean, {
        elements: {
            nodes: [
                { data: { id: 'n0', label: 'a', size: 40 }, position: { x: 1, y: 2 }, classes: 'highlighted' },
                { data: { id: 'n1', label: 'b', color: '#123456' } },
            ],
            edges: [{ data: { id: 'e0', source: 'n0', target: 'n1', label: 'x', color: 'green', width: 4 } }],
        },
        zoom: 1.5,
        pan: { x: 10, y: 20 },
    });
    assert.equal(JSON.stringify(clean).includes('evil'), false);
    // array form of elements is accepted too
    const arr = sanitizeGraph({ elements: [{ group: 'nodes', data: { id: 'a' } }, { group: 'nodes', data: { id: 'b' } }, { group: 'edges', data: { id: 'e', source: 'a', target: 'b' } }] });
    assert.equal(arr.elements.nodes.length, 2);
    assert.equal(arr.elements.edges.length, 1);
});

test('escapeSplValue and buildExpandSearch', () => {
    assert.equal(escapeSplValue('a"b\\c'), 'a\\"b\\\\c');
    assert.equal(buildExpandSearch('index=fw', '| stats count by src dest', 'x"y'), 'search index=fw "x\\"y" | stats count by src dest');
    assert.equal(buildExpandSearch('| inputlookup assets | search', 'stats count by a b', 'n1'), '| inputlookup assets | search "n1" | stats count by a b');
    assert.equal(buildExpandSearch('index=fw', '', 'n'), 'search index=fw "n"');
    // injection attempt stays inside the quoted term
    assert.equal(buildExpandSearch('index=fw', '', 'a" | delete | search "b'), 'search index=fw "a\\" | delete | search \\"b"');
    assert.throws(() => buildExpandSearch('', '', 'a'), /No "Expand base search"/);
});

test('ringPositions places nodes around the anchor', () => {
    const pts = ringPositions({ x: 0, y: 0 }, 4, 100);
    assert.deepEqual(pts, [{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 }, { x: 0, y: -100 }]);
});

test('edgeWidths', () => {
    assert.equal(edgeWidths(['1', '2'], 'fixed'), null);
    assert.deepEqual(edgeWidths(['1', '100', 'x'], 'count'), [2, 14, 2]);
});

test('shapeScale assigns shapes in order and is stable', () => {
    const s = shapeScale();
    assert.equal(s('host').shape, NODE_SHAPES[0]);
    assert.equal(s('user').shape, NODE_SHAPES[1]);
    assert.equal(s('host').shape, NODE_SHAPES[0]);
    assert.ok(s('user').symbol);
});

test('parseTime and timelineSteps', () => {
    assert.equal(parseTime('1700000000'), 1700000000000);
    assert.equal(parseTime('1700000000.5'), 1700000000500);
    assert.equal(parseTime('2026-11-24T12:00:00.000+00:00'), Date.UTC(2026, 10, 24, 12));
    assert.ok(Number.isNaN(parseTime('')));
    assert.ok(Number.isNaN(parseTime('soon')));
    assert.deepEqual(timelineSteps([3, 1, 2, 2, NaN]), [1, 2, 3]);
    assert.equal(timelineSteps(Array.from({ length: 1000 }, (_, i) => i), 50).length, 50);
});

test('extraFields skips source/target, reserved and internal fields', () => {
    const fields = f('src', 'dest', 'count', 'dest_port', '_time', 'app', 'src_group');
    assert.deepEqual(extraFields(fields, ['a', 'b', '3', '443', 't', 'ssl', 'g']), [['dest_port', '443'], ['app', 'ssl']]);
});
