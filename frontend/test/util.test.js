import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CATEGORY20, DEFAULT_MAX_ROWS, MAX_ROWS_LIMIT, countByKey, detectColumns, drilldownData, fieldIndex, isDarkColor,
    matchNodeName, menuColors, nodeAttributes, nodeSizes, ordinalColor, parseGraphJson, parseMaxRows, parsePositiveInt,
    planLayout, scaleSize,
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
    assert.deepEqual(c, { count: 2, srcGroup: 3, destGroup: 4, srcColor: 5, destColor: 6 });
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
    assert.deepEqual(attrs.get('a'), { group: 'web', color: '#ff0000', degree: 2, weight: 5 });
    assert.deepEqual(attrs.get('b'), { group: 'db', color: null, degree: 2, weight: 4 }); // non-numeric count counts as 1
    assert.deepEqual(attrs.get('c'), { group: null, color: null, degree: 2, weight: 3 });
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
