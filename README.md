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

Both draw the same graph and offer the same right-click menus (paths, focus, condense, search nodes, style edges, Save State).

The app's dashboards are Dashboard Studio dashboards:
- **Link Analysis Explorer** - type any search that returns a source, a target and optionally a count and explore the graph.
- **Link Analysis Historical View** - pick a graph saved with *Save State* and load it with its saved layout.

**Requirements:** the Studio visualization and dashboards need Splunk Enterprise 10.4 or later, or a Splunk Cloud Platform version that includes the Dashboard Studio custom visualization framework. On older versions use the Classic visualization from the search page, or stay on app version 2.0.0.

To use the Studio visualization in your own dashboard, add it from the visualization picker (*Licoryx Link Analysis*) or in the source:
```json
"viz_graph": {
    "type": "licoryx_link_analysis_app.link_analysis_studio",
    "dataSources": { "primary": "ds_graph" },
    "options": { "layoutStyle": "fcose", "pathAlgo": "dijkstra", "directed": false, "recursiveLookup": true }
}
```
Options (also in the editor's *Visualization Style* section): `layoutStyle` (fcose, grid, circle, klay, dagre, concentric, breadthfirst, cose, cose-bilkent), `pathAlgo` (dijkstra, aStar, floydWarshall, bellmanFord), `directed`, `recursiveLookup`. Double-clicking a node or edge triggers a drilldown (`custom.dblclick`) whose `value` is the clicked element's name.

If a search returns a saved graph (a `_raw` holding Cytoscape JSON with `graph_info`, as written by *Save State*), the Studio visualization renders it with its saved positions.

### Basic Search Examples
- index=firewall action=allowed | stats count by src_ip, dest_ip | table src_ip, dest_ip, count
- sourcetype=access_combined | stats count by src_ip,uri_path

### Extended Search Examples

#### Optional Fields
- line_label - To specify the line label of an edge
```index=firewall action=allowed | stats count by src_ip, dest_ip, dest_port | rename dest_port as line_label```
***Will make the destination port the line label***
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
  - Spread
  - Cose

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
- Search Nodes - Allows you to find a node on the graph and zoom into the node.

#### Save State
An option exists in the framework to allow you to save the state of the graph.  This becomes really useful when you want to share your view with another analyst.  Before doing this you need to have the following.
- An index called ```cyto``` and an HTTP Event Collector token that can write to it (Save State sends events with `index=cyto`, `sourcetype=cyto:graph`)
- A valid certificate for your HTTP Event Collector
- CORS configured on the HTTP Event Collector (`crossOriginSharingPolicy` in the `[http]` stanza of inputs.conf). Dashboard Studio runs the visualization in a sandboxed frame whose origin is `null`, so from Studio dashboards the policy must be `*`.
This call is performed via javascript so requires something similar to the following setup.
https://answers.splunk.com/answers/766107/how-do-i-send-data-to-http-event-collector-via-jav.html

### Bugs / Missing Docos
Please report any bugs to github, Splunk Answers or alternatively hit me up on twitter @MickeyPerre

### Feature Requests
Post any feature requests as issues and I will look around to them.  My only feedback prior to making feature requests is ensuring that the feature does not reduce the flexibility of the app :).

### Tested on
- Splunk Enterprise 10.4 (Docker `splunk/splunk:10.4`) - Studio and Classic visualizations, Studio dashboards, Save State
- Splunk Enterprise 10.2 - Classic visualization only (no Studio extension framework)
- Splunk Enterprise 9.4 (Docker `splunk/splunk:9.4`) - Classic visualization only (no Studio extension framework)
- Splunk AppInspect (cloud tags) - no failures

### Building the Studio visualization
The Studio visualization is built from `studio/` (not shipped in the app package):
```
cd studio
npm install
npm run build   # bundles with esbuild and copies to appserver/static/visualizations/link_analysis_studio/
```
Then run `./package.sh` from the repository root to create `dist/licoryx_link_analysis_app-<version>.tgz`.

### Release Notes
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