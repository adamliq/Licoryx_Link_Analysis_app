# Licoryx Link Analysis App #
This app provides a seperate visualisation framework for doing force directed visualisation with additional functionality.
For more about the visualisation framework visit here.
https://github.com/cytoscape/cytoscape.js
### Installation Instructions
#### Splunk Cloud
Install the app package (`licoryx_link_analysis_app-<version>.tgz`) through *Apps > Manage Apps > Install app from file* (self-service app install) or request installation through Splunk Support.

#### Splunk Enterprise
1. Install the app package through *Apps > Manage Apps > Install app from file*, or extract it to `$SPLUNK_HOME/etc/apps` on your Search Head
2. Restart Splunk if prompted
3. Generate a search that has a 'source', 'target' and optionally a count. 

### Dashboard Studio
The app ships two visualizations:

| Visualization | Type | Use it in |
|---|---|---|
| **Licoryx Link Analysis** | `licoryx_link_analysis_app.link_analysis_studio` (Dashboard Studio extension framework) | Dashboard Studio dashboards |
| **Licoryx Link Analysis (Classic)** | `licoryx_link_analysis_app.link_analysis` (legacy custom viz) | Search page *Visualization* tab, Classic (Simple XML) dashboards |

Both are built from the same source (`frontend/src/core`), draw the same graph and offer the same right-click menus (paths, focus, condense, search nodes, style edges, Save State). Several link analysis panels can be used on one dashboard.

The app's dashboards:
- **Link Analysis Explorer** (Dashboard Studio) - type any search that returns a source, a target and optionally a count and explore the graph.
- **Link Analysis Historical View** (Dashboard Studio) - pick a graph saved with *Save State* and load it with its saved layout.
- **Manage Saved Graphs** (Classic) - open, rename, delete and import graphs saved in the KV store; shows who saved each graph and when.

**Requirements:** the Studio visualization and dashboards need Splunk Enterprise 10.4 or later, or a Splunk Cloud Platform version that includes the Dashboard Studio custom visualization framework. On older versions use the Classic visualization from the search page, or stay on app version 2.0.0.

To use the Studio visualization in your own dashboard, add it from the visualization picker (*Licoryx Link Analysis*) or in the source:
```json
"viz_graph": {
    "type": "licoryx_link_analysis_app.link_analysis_studio",
    "dataSources": { "primary": "ds_graph" },
    "options": { "layoutStyle": "fcose", "pathAlgo": "dijkstra", "directed": false, "recursiveLookup": true, "maxRows": 10000 }
}
```
Options (also in the editor's *Visualization Style* section): `layoutStyle` (fcose, grid, circle, klay, dagre, concentric, breadthfirst, cose, cose-bilkent), `pathAlgo` (dijkstra, aStar, floydWarshall, bellmanFord), `directed`, `recursiveLookup`, `maxRows` (see *Row limit*), `nodeSize` (`fixed`, `degree` = number of connections, `count` = total of the `count` field) and `largeGraphNodes` (see *Large graphs*). The editor's *Background color* is also honoured; label colours switch to stay readable.

If a search returns a saved graph (a `graph_info` field from the KV store, or a `_raw` HEC event, as written by *Save State*), the Studio visualization renders it with its saved positions.

### Drilldown
Double-click a node or an edge to drill down.

| | Classic dashboards | Dashboard Studio |
|---|---|---|
| Node | `$click.name$` = the field the node came from (e.g. `src_ip`), `$row.src_ip$` = the node name | Event `custom.click` with `name` = field, `value` = node name |
| Edge | `$row.<source field>$` and `$row.<target field>$` | `name`/`value` = source field and node; `data` holds both |

Classic example: `<drilldown><set token="node">$row.src_ip$</set></drilldown>`. Note that `$click.value$` is **not** set by classic custom visualizations; use `$row.<field>$`.
Studio example: `"eventHandlers": [{"type": "drilldown.setToken", "options": {"tokens": [{"token": "node", "key": "value"}]}}]`.

### Row limit
Up to 10,000 rows are drawn by default. Change it with **Maximum rows** (1-50,000) in the Format menu (classic) or the Studio editor (`maxRows`). When a search returns more rows than the limit, the graph shows a notice such as *"Showing the first 10000 of 23500 rows"*.

### Large graphs
- A *Laying out graph...* indicator is shown while the layout runs.
- Above **Large graph threshold** nodes (default 2,000; `largeGraphNodes`), the slow force-directed layouts (fcose, cose, cose-bilkent, klay, dagre) are replaced by *grid*, with a notice. Raise the threshold to force them.
- Above 1,000 edges, edge labels (`line_label`) are hidden, with a notice.

### Basic Search Examples
- index=firewall action=allowed | stats count by src_ip, dest_ip | table src_ip, dest_ip, count
- sourcetype=access_combined | stats count by src_ip,uri_path

### Extended Search Examples

#### Optional Fields
- line_label - To specify the line label of an edge
```index=firewall action=allowed | stats count by src_ip, dest_ip, dest_port | rename dest_port as line_label```
***Will make the destination port the line label***
- count - The edge weight. Use a field named `count` (any position); for compatibility, a third column that is not one of the fields below is also treated as the count. Used by *Node size: By total count*.
- src_group / dest_group - Group of the source / target node. Nodes are coloured by group and a legend is shown.
```index=firewall | stats count by src_ip, dest_ip | lookup asset_inventory ip as src_ip OUTPUT category as src_group | lookup asset_inventory ip as dest_ip OUTPUT category as dest_group```
- src_color / dest_color - Explicit colour of the source / target node (e.g. `#e8304a` or `red`); overrides the group colour.
- line_color - To specify a color of an edge
```index=firewall action=allowed | stats count by src_ip, dest_ip | eval line_color=if(count>10,"red","green")```
***If count is greater than 10 make the line red else make it green.***
- remove - For huge graphs, it is often faster to remove all nodes off of the graph and start with only one node on the graph.  All nodes that have any children can be expanded from here.
```index=firewall action=allowed | stats count by src_ip, dest_ip | eval remove="server01"```
***Remove all nodes from the graph except server01, if server01 is clicked the children will be re-added to the graph***
- preFilter - Allows you to prefilter your graph and remove all nodes that are connected to the node specified in the field.
***Delete all nodes from the graph that are not children of server01***

### Configuration Options

#### Format Menu - Vizualization Style

###### Layout Style
Layout styles allow you to change the format of the graph.  Not every format is useful for every data type.  Test with all of the layouts.  Some are also faster than others (Grid is the fastest)
  - FCose (Default)
  - Grid
  - Circle
  - Klay
  - Dagre
  - Concentric
  - Breadthfirst
  - Cose
  - Cose-Bilkent

###### Path Selection Algorithm
This app allows you to build paths between nodes.  The path algorithm is customisable to give you different outcomes.
  - Dijikstra (Default)
  - aStar
  - floydWarshall
  - bellmanFord

###### Path Selection Directed
When performing path highlighting, you can honor the direction of the path by selecting true. So in the following scenario if you wanted to map a path from A through to C in the following  ```A:B B:C``` setting this setting to False would allow the path to be created.
  - True
  - False (Default)

#### Node Selection Options
If you click and hold on a node, a context relevant menu will pop-up with the following options.
- Hlt All Paths (Highlight All Paths)
This option allows you to highlight all paths from the node recursively honoring the direction set in the format menu.  It will add a highlighted class to the nodes selected
- Single Path Select
This option allows you to draw a single path using the Algorithm in the format menu and honoring the direction set.  To use this option, press and hold on the starting node and select ```Single Path Select``` then click and hold the target node and select ```Single Path Select```.  If a path can be found the nodes will be highlighted.
- Condense
The condense option will condense the immediate children around the selected node in a concentric layout
- Focus
Same as condense.  But with a reset button.

#### Core Selection Options
If you click and hold in blank space on the node, a context relevant menu will pop-up with the following options.
- Menu 
Brings up an additional menu with the following options
    - Clear Formatting - Removes the highlighted class from all nodes
    - Delete Highlighted Items - Remove all highlighted items
    - Delete Non Highlighted Items - Remove all non highlighted items
    - Refresh - Refreshes the layout, useful when you have removed nodes and want the layout to be recomputed.
    - Save State - Allows you to save the state of the graph.  Please read save state below.
    - Style Edges - Allows you to enter a single term and a color to modify the style of the edge with that value (Originally Search Edges)
    - Export Graph JSON - Shows the graph as JSON to copy; paste it into *Import graph* on the Manage Saved Graphs page to save it in Splunk (useful from Dashboard Studio, where Save State can only use HEC)
- Search Nodes - Find a node (suggestions as you type; exact, case-insensitive or partial match) and zoom to it.

#### Save State
Save the graph (layout, highlighting, styling) to reopen it later or share it with another analyst in **Link Analysis Historical View**.

**Classic visualization - Splunk KV store (default, no setup).** The graph is saved with your own Splunk login to the app's `cyto_graphs` KV store collection (lookup `cyto_graphs`), together with who saved it (`saved_by`, informational). No token, index or CORS configuration is needed. By default every user of the app can save, read and delete saved graphs; to restrict this, override `[collections/cyto_graphs]` in `metadata/local.meta`, for example `access = read : [ * ], write : [ power, admin, sc_admin ]`. Use **Manage Saved Graphs** to rename or delete them.

If the KV store is not running, Save State says so and switches to the HTTP Event Collector. Known case: Splunk 10.4's bundled MongoDB does not start on Linux kernel 6.19 or newer (MongoDB SERVER-121912), so the KV store is unavailable on those hosts until Splunk ships a fix.

**From Dashboard Studio without HEC:** use Menu > *Export Graph JSON* and paste the JSON into *Import graph* on the Manage Saved Graphs page.

**HTTP Event Collector (optional in classic, the only option in Dashboard Studio).** Dashboard Studio runs custom visualizations in a sandboxed frame that cannot call Splunk with your login, so from Studio dashboards Save State sends the graph to the HTTP Event Collector (`index=cyto`, `sourcetype=cyto:graph`). This needs:
- An index called `cyto` and an HTTP Event Collector token that can write to it
- A valid certificate for your HTTP Event Collector
- CORS on the HTTP Event Collector (`crossOriginSharingPolicy` in the `[http]` stanza of inputs.conf). The sandboxed frame's origin is `null`, so from Studio dashboards the policy must be `*`.

The token is typed into a password field and is not stored. The Historical View lists graphs from both the KV store and `index=cyto`.

### Bugs / Missing Docos
Please report any bugs to github, Splunk Answers or alternatively hit me up on twitter @MickeyPerre

### Feature Requests
Post any feature requests as issues and I will look around to them.  My only feedback prior to making feature requests is ensuring that the feature does not reduce the flexibility of the app :).

### Tested on
- Splunk Enterprise 10.4 (Docker `splunk/splunk:10.4`) - Studio and Classic visualizations, Studio dashboards, Save State, Manage Saved Graphs
- Splunk Enterprise 10.6.2 (Docker `splunk/splunk:10.6.2`) - Studio and Classic visualizations, Studio dashboards, Save State, Manage Saved Graphs
- Splunk Enterprise 9.4 (Docker `splunk/splunk:9.4`) - Classic visualization, Save State, Manage Saved Graphs (no Studio extension framework)
- Splunk Enterprise 10.2 - Classic visualization only (no Studio extension framework)
- Splunk AppInspect (cloud tags) - no failures

### Classic visualization and Splunk's legacy framework
AppInspect warns that legacy custom visualizations (`framework_type = legacy_visualization`, used by the Classic visualization) are deprecated in Splunk 10.6. Plan:
- Splunk 10.6.2 still supports them (its `visualizations.conf.spec` lists `legacy_visualization` as the default) and the Classic visualization passes all smoke tests there; CI keeps testing the newest Splunk release so removal is caught early.
- The search page *Visualization* tab and Classic (Simple XML) dashboards can only use legacy visualizations, so the Classic visualization stays for as long as Splunk supports it. Both visualizations are built from the same code, so nothing is duplicated.
- When Splunk removes legacy support, the app becomes Studio-only: the Explorer and Historical View already are; Manage Saved Graphs would move to a Studio-compatible approach.

### Development
Repository layout (only the app files are packaged; `frontend/`, `tests/` and `.github/` are excluded):
- `frontend/src/core` - shared visualization logic (`link_analysis_core.js`), modal dialogs and styles
- `frontend/src/classic` - classic (legacy framework) entry point, built as an AMD module
- `frontend/src/studio` - Dashboard Studio entry point and `config.json`
- `frontend/src/manage` - Manage Saved Graphs dashboard script
- `frontend/test` - unit tests for the pure helpers in `frontend/src/core/util.js` (`npm test`)
- `tests/smoke.mjs` - browser smoke tests against a running Splunk

Build both visualizations (writes `appserver/static/visualizations/*/visualization.js`) and package:
```
cd frontend
npm ci
npm test               # unit tests
npm run build          # or: npm run build:dev  (unminified, with source maps)
cd ..
./package.sh           # -> dist/licoryx_link_analysis_app-<version>.tgz
```

Smoke tests (start Splunk with the app installed first, e.g. `docker run ... -e SPLUNK_APPS_URL=/tmp/app.tgz splunk/splunk:10.4`):
```
cd tests
npm install && npx playwright install chromium
SPLUNK_PASSWORD=... node smoke.mjs                # Splunk 10.4+
SKIP_STUDIO=1 SPLUNK_PASSWORD=... node smoke.mjs  # Splunk before 10.4 (classic only)
SKIP_KVSTORE=1 ...                                # KV store not running (KV checks reported as SKIP)
```

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: unit tests, builds the bundles and checks they match the committed files, packages the app, runs AppInspect (Splunk Cloud checks; fails on any failure or error) and runs the smoke tests on Splunk 10.4 and 9.4 in Docker. On GitHub's runners Splunk 10.4's KV store cannot start (kernel 6.19+, see Save State), so the 10.4 job reports the KV-store checks as SKIP.

### Releasing
1. Update `version` in `default/app.conf` (both stanzas) and `app.manifest`, and add a `#### <version>` section to the release notes below.
2. Merge to `master`, then either push a tag (`git tag v<version> && git push origin v<version>`) or run *Actions > Release > Run workflow* on `master` with the version (the tag is created for you).
3. `.github/workflows/release.yml` checks the tag matches `app.conf`, runs the unit tests, build check and AppInspect, and publishes a GitHub Release with `licoryx_link_analysis_app-<version>.tgz` and the AppInspect report attached, using the release notes section as the description.

### Release Notes
#### 2.3.0
- **Manage Saved Graphs** dashboard: open, rename, delete and import KV-store graphs; graphs now record who saved them (`saved_by`), shown there and in the Historical View.
- **Export Graph JSON** (Menu): copy a graph as JSON and import it on the Manage page - a way to save from Dashboard Studio without HEC.
- **KV store check:** Save State detects an unavailable KV store (e.g. Splunk 10.4 on Linux kernel 6.19+) and switches to HEC with an explanation instead of failing.
- **Styling:** optional `src_group`/`dest_group` (colour nodes by group, with a legend) and `src_color`/`dest_color` fields; *Node size* option (fixed, by connections, by total count). The `count` field is now found by name (previously the third column was always used, even when it was `line_label`).
- **Large graphs:** *Laying out graph...* indicator; slow layouts switch to grid above the *Large graph threshold* (default 2,000 nodes); edge labels hidden above 1,000 edges; notices explain both.
- **Right-click menu** readable on dark backgrounds (Dashboard Studio).
- **Fixes:** double-click drilldown stopped working after Menu > Refresh (or any re-layout); the *cose* layout ran twice; the Focus *Reset* button is now placed in the visualization.
- **Libraries:** Cytoscape 3.11 -> 3.35 and current layout extensions; removed d3 (fixes 2 high-severity `d3-color` advisories) and cytoscape-popper; esbuild 0.28. Bundles shrink from 1.48 MB to about 1.33 MB.
- **Code and tests:** pure helpers moved to `frontend/src/core/util.js` with unit tests; smoke tests cover the new features and the KV-store-down path.
- **CI/release:** GitHub actions updated to current major versions (Node 24); new tag-triggered release workflow publishes GitHub Releases with the package attached.

#### 2.2.0
- **One source for both visualizations:** the classic visualization is now built from the same code as the Studio one (esbuild), replacing the old webpack bundle. It drops the bundled jQuery 3.4.1 (now 3.7.1), unused libraries (backbone, tippy.js, underscore, cytoscape-spread) and shrinks from 3.1 MB to 1.5 MB.
- **Save State without a token (classic):** saves to the app's KV store collection `cyto_graphs` with the user's own Splunk session; HEC remains available (and is used by Studio). The HEC token field is now a password field. The Historical View reads both sources.
- **Several panels per dashboard:** each visualization instance now has its own state and element ids (previously two classic panels on one dashboard interfered).
- **Drilldown:** double-click now reports the real node/edge values (classic: `$click.name$`, `$row.<field>$`; Studio: `custom.click` with `name`/`value`). Previously the classic viz sent `_raw=test`.
- **Search Nodes:** fixed suggestions disappearing after the first search and becoming stale when data changed; adds case-insensitive and partial matching.
- **Row limit:** new *Maximum rows* option (default 10,000, up to 50,000) with an on-graph notice when results are truncated.
- **Studio:** the editor's *Background color* is honoured, with readable label colours.
- **Testing:** browser smoke tests (`tests/smoke.mjs`) and a GitHub Actions workflow (build check, AppInspect, smoke tests on Splunk 10.4 and 9.4).

#### 2.1.1
- New app icon (source SVGs in `frontend/icon/`).

#### 2.1.0
- New **Dashboard Studio** visualization (`link_analysis_studio`, `framework_type = studio_visualization`) built on the Dashboard Studio extension framework, with dropdown option editors, theme support, drilldown and saved-state rendering.
- **Link Analysis Historical View** converted to a Dashboard Studio dashboard (no custom dashboard JavaScript); new **Link Analysis Explorer** Studio dashboard.
- The classic visualization is kept (renamed *Licoryx Link Analysis (Classic)*) for the search page and Classic dashboards.
- Save State now sends `index=cyto` explicitly; default HEC URL uses port 8088.
- Fixed a `ReferenceError` in the classic viz when re-running a layout.

#### 2.0.0
- App renamed to **Licoryx Link Analysis App** (app id `licoryx_link_analysis_app`). Visualization settings are now under `display.visualizations.custom.licoryx_link_analysis_app.link_analysis.*`. Searches/dashboards that referenced `link_analysis_app.link_analysis` must be updated to `licoryx_link_analysis_app.link_analysis`.
- Splunk Cloud compliance: removed deprecated HTML dashboards and sample views, Simple XML dashboards set to `version="1.1"`, `[id]` stanza and `app.manifest` added, `sc_admin` granted write access, removed debug statements.

### License
- This app uses D3 with the following license conditions
[Here](https://github.com/d3/d3/blob/master/LICENSE)
- This app uses Cytoscape js with the following license conditions
[Here](https://raw.githubusercontent.com/cytoscape/cytoscape.js/master/LICENSE)
- This app uses the FCose Layout that was created after research with the following paper
[Here](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4708103/)