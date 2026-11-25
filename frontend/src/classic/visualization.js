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
import { checkKvStore, currentUser, graphs, runExpandSearch } from './splunkweb.js';
import '../core/core.css';

export default createLinkAnalysisClass(SplunkVisualizationBase, SplunkVisualizationUtils, {
    kvstore: true,
    saveToKvStore: (record) => graphs.create(record),
    checkKvStore,
    currentUser,
    runSearch: runExpandSearch,
});
