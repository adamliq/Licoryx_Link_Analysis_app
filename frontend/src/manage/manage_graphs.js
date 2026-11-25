/*
 * Manage Saved Graphs (Classic Simple XML dashboard script).
 * Lists graphs saved by "Save State" in the app KV store (collection cyto_graphs) and lets
 * the user open, rename and delete them, or import a graph from "Export Graph JSON".
 * Uses the viewer's own Splunk Web session; KV store permissions apply.
 */
import { APP, checkKvStore, currentUser, graphs, makeId, webPrefix } from '../classic/splunkweb.js';
import { parseGraphJson, sanitizeGraph } from '../core/util.js';
import Modal from '../core/Modal.js';
import '../core/core.css';
import './manage_graphs.css';

// In-page dialogs (instead of window.prompt / window.confirm).
function promptDialog(title, label, value) {
    return new Promise((resolve) => {
        const m = new Modal('llm-dialog', { title, keyboard: true, destroyOnHide: true });
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'llm-dialog-input';
        input.value = value || '';
        const p = document.createElement('p');
        p.textContent = label;
        m.body.append(p, input);
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn btn-primary';
        ok.id = 'llm-dialog-ok';
        ok.textContent = 'Save';
        ok.setAttribute('data-dismiss', 'modal');
        ok.addEventListener('click', () => finish(input.value));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { finish(input.value); m.hide(); } });
        m.footer.append(ok);
        m.$el.on('hide', () => finish(null));
        m.show();
    });
}

function confirmDialog(title, text, actionLabel) {
    return new Promise((resolve) => {
        const m = new Modal('llm-dialog', { title, keyboard: true, destroyOnHide: true });
        const p = document.createElement('p');
        p.textContent = text;
        m.body.append(p);
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn';
        cancel.textContent = 'Cancel';
        cancel.setAttribute('data-dismiss', 'modal');
        cancel.addEventListener('click', () => finish(false));
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn btn-primary llm-danger';
        ok.id = 'llm-dialog-ok';
        ok.textContent = actionLabel;
        ok.setAttribute('data-dismiss', 'modal');
        ok.addEventListener('click', () => finish(true));
        m.footer.append(cancel, ok);
        m.$el.on('hide', () => finish(false));
        m.show();
    });
}

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
}

function formatTime(epoch) {
    const n = Number(epoch);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toLocaleString() : '';
}

function mount(root) {
    const status = el('div', { class: 'llm-status', role: 'status' });
    const tableBody = el('tbody');
    const table = el('table', { class: 'llm-table' },
        el('thead', {}, el('tr', {},
            el('th', {}, 'Description'), el('th', {}, 'Saved by'), el('th', {}, 'Saved at'),
            el('th', {}, 'Graph id'), el('th', {}, 'Actions'))),
        tableBody);

    const importDesc = el('input', { type: 'text', class: 'llm-input', id: 'llm-import-description', placeholder: 'Description' });
    const importJson = el('textarea', { class: 'llm-input', id: 'llm-import-json', rows: '6', placeholder: 'Paste the JSON from "Export Graph JSON" here' });
    const importButton = el('button', { type: 'button', class: 'btn btn-primary', id: 'llm-import' }, 'Import graph');

    root.textContent = '';
    root.append(
        status,
        el('div', { class: 'llm-toolbar' },
            el('button', { type: 'button', class: 'btn', id: 'llm-refresh', onclick: () => load() }, 'Refresh')),
        table,
        el('h3', {}, 'Import graph'),
        el('p', { class: 'llm-help' }, 'Use this to save a graph from a Dashboard Studio dashboard: in the graph, open Menu > Export Graph JSON, copy the JSON and paste it here.'),
        importDesc, importJson, importButton,
        el('p', { class: 'llm-help' }, 'Graphs saved through the HTTP Event Collector (index=cyto) are events and are not listed here; manage them with the index retention settings.'),
    );

    const setStatus = (text, kind = 'info') => {
        status.textContent = text || '';
        status.className = `llm-status llm-${kind}`;
        status.style.display = text ? 'block' : 'none';
    };

    function row(g) {
        const open = el('a', {
            href: `${webPrefix()}/app/${APP}/link_analysis_historical_view?form.cytoId=${encodeURIComponent(g.graph_id)}`,
            class: 'btn btn-small',
        }, 'Open');
        const rename = el('button', { type: 'button', class: 'btn btn-small llm-rename' }, 'Rename');
        const del = el('button', { type: 'button', class: 'btn btn-small llm-delete' }, 'Delete');
        rename.addEventListener('click', async () => {
            const name = await promptDialog('Rename saved graph', 'New description', g.description || '');
            if (name === null) return;
            graphs.get(g._key)
                .then((full) => graphs.update(g._key, { ...full, description: name }))
                .then(() => { setStatus(`Renamed to "${name}".`, 'ok'); load(); })
                .catch((e) => setStatus(`Rename failed: ${e.message}`, 'error'));
        });
        del.addEventListener('click', async () => {
            const yes = await confirmDialog('Delete saved graph', `Delete "${g.description || g.graph_id}"? This cannot be undone.`, 'Delete');
            if (!yes) return;
            graphs.remove(g._key)
                .then(() => { setStatus(`Deleted "${g.description || g.graph_id}".`, 'ok'); load(); })
                .catch((e) => setStatus(`Delete failed: ${e.message}`, 'error'));
        });
        return el('tr', { 'data-key': g._key },
            el('td', {}, g.description || ''), el('td', {}, g.saved_by || ''), el('td', {}, formatTime(g.saved_at)),
            el('td', { class: 'llm-id' }, g.graph_id || ''), el('td', { class: 'llm-actions' }, open, rename, del));
    }

    function load() {
        return checkKvStore().then((kv) => {
            if (!kv.ready) {
                tableBody.textContent = '';
                importButton.disabled = true;
                setStatus(`The KV store is not available on this Splunk server (${kv.status}). Saved graphs in the KV store cannot be listed or changed until it is running.`, 'error');
                return;
            }
            importButton.disabled = false;
            return graphs.list().then((list) => {
                tableBody.textContent = '';
                if (!list.length) {
                    tableBody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'llm-empty' }, 'No saved graphs yet. Use Menu > Save State in a link analysis graph.')));
                } else {
                    list.forEach((g) => tableBody.appendChild(row(g)));
                }
                if (status.className.includes('llm-error')) setStatus('');
            });
        }).catch((e) => setStatus(`Could not load saved graphs: ${e.message}`, 'error'));
    }

    importButton.addEventListener('click', () => {
        let graph;
        try {
            // Imported graphs are user-supplied: keep only data the app understands.
            graph = sanitizeGraph(parseGraphJson(importJson.value));
        } catch (e) {
            setStatus(`Import failed: ${e.message}`, 'error');
            return;
        }
        const record = {
            graph_id: makeId(),
            description: importDesc.value.trim() || 'Imported graph',
            graph_info: JSON.stringify(graph),
            saved_at: Math.floor(Date.now() / 1000),
        };
        currentUser().catch(() => null)
            .then((user) => { if (user) record.saved_by = user; return graphs.create(record); })
            .then(() => {
                setStatus(`Imported "${record.description}" (${record.graph_id}).`, 'ok');
                importJson.value = '';
                importDesc.value = '';
                load();
            })
            .catch((e) => setStatus(`Import failed: ${e.message}`, 'error'));
    });

    load();
}

function start() {
    const root = document.getElementById('llm-root');
    if (root) mount(root);
    else setTimeout(start, 200); // the dashboard's html panel renders after this script loads
}
start();
