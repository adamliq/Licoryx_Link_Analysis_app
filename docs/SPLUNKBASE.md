# Splunkbase listing notes

Material for publishing the Licoryx Link Analysis App on Splunkbase. Not part of the app package.

## Listing

**Title:** Licoryx Link Analysis App

**Short description:** Explore relationships in your data as an interactive graph: network maps, attack paths, and who-talks-to-whom, in Dashboard Studio and Classic dashboards.

**Long description:**
Turn any search that returns a source, a target and optionally a count into an interactive link analysis graph.
- Dashboard Studio visualization (Splunk 10.4+) and a Classic visualization for the search page and Simple XML dashboards
- Expand nodes on demand with a follow-up search, find paths between nodes, focus on neighbourhoods
- Colour, shape and size nodes by group, type, connections, count, PageRank or betweenness; find clusters
- Timeline playback for results with `_time`
- Save graphs (KV store, no tokens needed) and reopen them in the Historical View; manage, export and import graphs
- Splunk Cloud compatible (AppInspect cloud checks pass)

**Categories:** Security, Fraud & Compliance; IT Operations; Utilities

**Supported Splunk versions:** 9.4 (Classic visualization), 10.4, 10.6 (Classic and Dashboard Studio)

**Platform:** Splunk Enterprise, Splunk Cloud Platform

**License:** MIT (see LICENSE); bundled Cytoscape.js and extensions are MIT-licensed (see cyto-LICENSE)

## Screenshots (docs/screenshots)
1. `01-explorer-studio.png` - Link Analysis Explorer (Dashboard Studio) with node shapes, legend and hover details
2. `02-classic-timeline-clusters.png` - Classic visualization on the search page: PageRank sizing, clusters, timeline, toolbar
3. `03-save-state.png` - Save State to the KV store
4. `04-historical-view.png` - Reopening a saved graph
5. `05-manage-saved-graphs.png` - Managing saved graphs

## Splunk Cloud vetting
- AppInspect: run `splunk-appinspect inspect <package> --mode precert --included-tags cloud` (also done by CI and the release workflow; the report is attached to each GitHub Release).
- Expected warnings: `check_for_legacy_custom_visualizations` (the Classic visualization is kept for the search page and Simple XML dashboards) and `check_collections_conf` (informational).
- The visualization bundles are minified builds of the source in this repository (`frontend/src`), built with `frontend/build.mjs` (esbuild). Reviewers can rebuild them with `cd frontend && npm ci && npm run build`; CI checks the committed bundles match the source.
- Network access from the browser: only Splunk's own REST endpoints (KV store, search jobs) with the user's session; the optional HTTP Event Collector URL is entered by the user. No external services.
