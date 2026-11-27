# Moving to Dashboard Studio only

Findings from investigating Splunk's Studio-native options and from testing a Studio-only edition of the app.
Tested in Docker on Splunk 10.6.2 and 10.4 (November 2026).

## What Splunk says (docs)
- Splunk 10.6 deprecates **custom visualizations in Classic dashboards** and advises moving those dashboards to Dashboard Studio. No removal version or date is given; deprecated features keep working until removed.
  ([Deprecated and removed in 10.6](https://help.splunk.com/en/splunk-enterprise/release-notes-and-updates/release-notes/10.6/deprecated-features/deprecated-and-removed-in-version-10.6))
- Classic (Simple XML) dashboards as a whole are **not** deprecated.
- The Studio custom visualization framework "is specific to Dashboard Studio"; Dashboard Studio still supports (renders) legacy custom visualizations.
  ([Custom visualizations for Dashboard Studio](https://help.splunk.com/en/splunk-enterprise/developing-views-and-apps-for-splunk-web/10.4/custom-visualizations-for-dashboard-studio))
- AppInspect warns (`check_for_legacy_custom_visualizations`) for any `legacy_visualization`.

## What testing showed
| Question | Result |
|---|---|
| Does Splunk's built-in `splunk.networkGraph` replace the app? | No. With a source/target search it draws only the source nodes and no links; listing every node makes it fail (`Cannot read properties of null`); no drilldown token from node clicks; no paths, expand, saving, analytics or timeline; 1,000 links by default (10,000 max). |
| Can the Studio-framework visualization run on the search page or in Classic dashboards? | No: `DashboardExtensionAPI is not available`. Only the classic visualization works there. |
| Does Studio render the classic visualization? | Yes, unchanged (including its toolbar). |
| Can Studio visualizations use the viewer's Splunk session or download files? | No (sandboxed iframe, `allow-scripts` only). Save State to the KV store, running searches (Expand), file downloads and a script-driven Manage page are not possible natively. |

## The Studio-only edition
`./package-studio-only.sh` builds `dist/licoryx_link_analysis_app-<version>-studio-only.tgz` from the same source:

| Kept | Removed |
|---|---|
| Studio visualization (graph, layouts, paths, focus/condense, Search Nodes, toolbar, hover details, analytics, clusters, filters, timeline, shapes, sizes, drilldown, row limit, background colour) | Classic (legacy) visualization and its options |
| Link Analysis Explorer (Studio) | Save State (HEC and KV store), Expand, Export Graph JSON, Export Image |
| Link Analysis Historical View (Studio), read-only for graphs saved earlier | Manage Saved Graphs (Classic dashboard with custom JavaScript) |

The visualization is kept out of the search page's chart picker (`allow_user_selection = false`), where Studio-framework visualizations cannot run.

### Results
- **AppInspect (Splunk Cloud checks):** 0 failures, 0 errors; the only warning is the informational `check_collections_conf`. The legacy-visualization warning is gone.
- **Smoke tests** (`LLA_EDITION=studio-only node tests/smoke.mjs`): 19/19 on Splunk 10.6.2 and 19/19 on 10.4. These cover the kept features inside Studio, and check that the removed features are absent, also when typed into the Menu, that the Manage page returns 404, and that the search page does not offer the visualization.
- CI builds the edition, runs AppInspect on it and runs its smoke tests on Splunk 10.6.2.

### What users would lose
- Graphs from the search page's Visualization tab and in Classic dashboards.
- Saving graphs (and so new entries for the Historical View), Expand, exports and graph management.

## Recommendation
- Keep shipping the full app while Splunk supports legacy visualizations: it is the only way to graph from the search page, and 10.6 removes nothing.
- Keep the Studio-only edition building and tested in CI so switching is a packaging decision, not a project, when Splunk announces a removal date.
- Do not adopt `splunk.networkGraph`.
