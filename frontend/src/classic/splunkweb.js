/*
 * Splunk Web helpers for code running in the Splunk Web page itself (classic viz and
 * the Manage Saved Graphs dashboard): calls to splunkd with the viewer's own session.
 */
import { buildExpandSearch } from '../core/util.js';

export const APP = 'licoryx_link_analysis_app';
export const COLLECTION = 'cyto_graphs';

// Splunk Web URL prefix (locale and optional root_endpoint), e.g. "/en-US" or "/splunk/en-US".
export function webPrefix() {
    const path = window.location.pathname;
    const i = path.indexOf('/app/');
    if (i >= 0) return path.slice(0, i);
    const m = /^(.*?\/[a-z]{2}-[A-Z]{2})(\/|$)/.exec(path);
    return m ? m[1] : '';
}

function csrfToken() {
    const cookie = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('splunkweb_csrf_token_'));
    return cookie ? decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)) : '';
}

/** Call splunkd through Splunk Web. Resolves with the parsed JSON body; rejects with a readable Error. */
export function splunkd(method, path, body) {
    const url = `${webPrefix()}/splunkd/__raw${path}${path.includes('?') ? '&' : '?'}output_mode=json`;
    const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-Splunk-Form-Key': csrfToken() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
        method,
        credentials: 'same-origin',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((res) => res.text().then((text) => {
        let parsed = null;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch (e) {
            // not JSON (e.g. an XML error from a KV store that is down)
        }
        if (res.ok) return parsed;
        let message = `HTTP ${res.status}`;
        if (parsed && parsed.messages && parsed.messages[0]) message += `: ${parsed.messages[0].text}`;
        else {
            const m = /<msg[^>]*>([^<]+)<\/msg>/.exec(text);
            if (m) message += `: ${m[1]}`;
        }
        throw new Error(message);
    }));
}

const collectionPath = (key) =>
    `/servicesNS/nobody/${APP}/storage/collections/data/${COLLECTION}${key ? '/' + encodeURIComponent(key) : ''}`;

export const graphs = {
    list: () => splunkd('GET', `${collectionPath()}?sort=saved_at:-1&fields=_key,graph_id,description,saved_at,saved_by`),
    get: (key) => splunkd('GET', collectionPath(key)),
    create: (record) => splunkd('POST', collectionPath(), record),
    update: (key, record) => splunkd('POST', collectionPath(key), record),
    remove: (key) => splunkd('DELETE', collectionPath(key)),
};

/**
 * KV store availability (e.g. it cannot start on Splunk 10.4 with Linux kernel 6.19+).
 * Splunk Web does not proxy /services/kvstore/status, so this reads one record of the
 * app's own collection: success means the KV store is usable for Save State.
 */
export function checkKvStore() {
    return splunkd('GET', `${collectionPath()}?limit=1&fields=_key`)
        .then(() => ({ ready: true, status: 'ready' }))
        .catch((err) => ({ ready: false, status: err.message }));
}

/** Name of the logged-in user (stored with saved graphs as "saved_by"; informational only). */
export function currentUser() {
    return splunkd('GET', '/services/authentication/current-context')
        .then((body) => (body && body.entry && body.entry[0] ? body.entry[0].content.username : null));
}

export function makeId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** POST a form to splunkd (e.g. search jobs). */
export function splunkdForm(path, form) {
    const url = `${webPrefix()}/splunkd/__raw${path}`;
    const body = new URLSearchParams({ output_mode: 'json', ...form });
    return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'X-Splunk-Form-Key': csrfToken(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    }).then((res) => res.text().then((text) => {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
        if (res.ok) return parsed;
        let message = `HTTP ${res.status}`;
        if (parsed && parsed.messages && parsed.messages[0]) message += `: ${parsed.messages[0].text}`;
        throw new Error(message);
    }));
}

/**
 * Run the "Expand node" search (one-shot, with the viewer's permissions) and return
 * {fields:[{name}], rows:[[...]]} in the same shape as visualization data.
 */
export function runExpandSearch(base, stats, nodeName, earliest, latest) {
    const search = buildExpandSearch(base, stats || '| stats count by src_ip dest_ip', nodeName);
    return splunkdForm(`/servicesNS/-/${APP}/search/jobs`, {
        search,
        exec_mode: 'oneshot',
        earliest_time: earliest || '-24h@h',
        latest_time: latest || 'now',
        count: '10000',
    }).then((body) => {
        const results = (body && body.results) || [];
        let names = (body && body.fields ? body.fields.map((f) => (typeof f === 'string' ? f : f.name)) : null);
        if (!names || !names.length) names = results.length ? Object.keys(results[0]) : [];
        names = names.filter((n) => !n.startsWith('_') || n === '_time');
        const rows = results.map((r) => names.map((n) => (Array.isArray(r[n]) ? r[n].join(', ') : r[n])));
        return { fields: names.map((name) => ({ name })), rows, search };
    });
}
