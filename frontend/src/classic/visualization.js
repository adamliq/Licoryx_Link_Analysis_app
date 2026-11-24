/*
 * Licoryx Link Analysis (Classic) - legacy custom visualization entry point.
 *
 * Built by build.mjs into an AMD module:
 *   define(['api/SplunkVisualizationBase', 'api/SplunkVisualizationUtils'],
 *          function (SplunkVisualizationBase, SplunkVisualizationUtils) { ...this bundle... });
 * so SplunkVisualizationBase / SplunkVisualizationUtils below are the real Splunk
 * Web modules supplied by that wrapper.
 */
/* global SplunkVisualizationBase, SplunkVisualizationUtils */
import createLinkAnalysisClass from '../core/link_analysis_core.js';
import '../core/core.css';

const APP = 'licoryx_link_analysis_app';
const COLLECTION = 'cyto_graphs';

// Splunk Web URL prefix (locale and optional root_endpoint), e.g. "/en-US" or "/splunk/en-US".
function webPrefix() {
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

// Save a graph to the app's KV store collection using the viewer's own Splunk Web session.
function saveToKvStore(record) {
    const url = `${webPrefix()}/splunkd/__raw/servicesNS/nobody/${APP}/storage/collections/data/${COLLECTION}?output_mode=json`;
    return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Splunk-Form-Key': csrfToken(),
        },
        body: JSON.stringify(record),
    }).then((res) => {
        if (res.ok) return res.json();
        return res.text().then((text) => {
            let message = `HTTP ${res.status}`;
            try {
                const body = JSON.parse(text);
                if (body.messages && body.messages[0]) message += `: ${body.messages[0].text}`;
            } catch (e) {
                // not JSON
            }
            throw new Error(message);
        });
    });
}

export default createLinkAnalysisClass(SplunkVisualizationBase, SplunkVisualizationUtils, {
    kvstore: true,
    saveToKvStore,
});
