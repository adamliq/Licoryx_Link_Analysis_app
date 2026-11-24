/*
 * Licoryx Link Analysis - core visualization logic, shared by both builds:
 *   - src/classic/visualization.js  -> classic (legacy framework) viz, search page + Classic dashboards
 *   - src/studio/visualization.js   -> Dashboard Studio extension-framework viz
 * Written against the classic SplunkVisualizationBase API; the Studio entry point
 * supplies small stand-ins for SplunkVisualizationBase / SplunkVisualizationUtils.
 */
import $ from 'jquery';
import cytoscape from 'cytoscape';
import cxtmenu from 'cytoscape-cxtmenu';
import fcose from 'cytoscape-fcose';
import dagre from 'cytoscape-dagre';
import klay from 'cytoscape-klay';
import Modal from './Modal.js';
import {
  DEFAULT_LARGE_GRAPH_NODES, MAX_ROWS_LIMIT, countByKey, detectColumns, drilldownData, isDarkColor,
  matchNodeName, menuColors, nodeAttributes, nodeSizes, ordinalColor, parseMaxRows, parsePositiveInt, planLayout,
} from './util.js';
import coseBilkent from 'cytoscape-cose-bilkent';
import dblclick from 'cytoscape-dblclick';

// Register Cytoscape extensions once per page.
cxtmenu(cytoscape);
fcose(cytoscape);
dagre(cytoscape);
klay(cytoscape);
coseBilkent(cytoscape);
dblclick(cytoscape);

let instanceCounter = 0;

/**
 * Builds the visualization class. Each call creates a fresh closure, so the
 * module-level state below is private to one visualization instance. Use
 * createLinkAnalysisClass() (bottom of this file) which does this per instance.
 *
 * @param {object} SplunkVisualizationBase  classic api/SplunkVisualizationBase or a stand-in
 * @param {object} SplunkVisualizationUtils classic api/SplunkVisualizationUtils or a stand-in
 * @param {object} [features]
 * @param {boolean} [features.kvstore]   offer "Save to Splunk (KV store)" in Save State
 * @param {function} [features.saveToKvStore] (record) => Promise; required when kvstore is true
 */
function createLinkAnalysis(SplunkVisualizationBase, SplunkVisualizationUtils, features) {
  features = features || {};
  instanceCounter += 1;
  var UID = 'lla' + instanceCounter;
  var CY_ID = UID + '-cy';
  var NODE_LIST_ID = UID + '-node_list';
  var MENU_LIST_ID = UID + '-menu_list';
  var RESET_VIEW_ID = UID + '-reset_view';

  // Shared state. The classic build relied on implicit (sloppy-mode) globals for these;
  // they are declared here so the module runs in strict mode.
  var changedConfig,
      columns,
      concentricCount,
      datum,
      edgeSearchColorStyle,
      edgeSearchColorStyleCy,
      edge_id,
      endid_hash,
      focus_Node_Incomers,
      focus_Node_Outgoers,
      formatIterNum,
      format_info,
      full_hec,
      full_message,
      fw_collection,
      group_id,
      group_list,
      highlightCollection,
      initial_node,
      jointNodes,
      key,
      layoutStyle_global,
      line_label_num,
      linkGroup,
      menu_list_items,
      n_predecessors,
      n_successors,
      node,
      node_color,
      node_data,
      node_id,
      node_label,
      nodesArray,
      nodesUnique,
      notInCollection,
      object,
      positionOfNode,
      responseText,
      searchFilter,
      searchString,
      source_out,
      spacingFactorVar,
      startid_hash,
      target_out,
      totalNodes;


      /*
      Initiate Global Variables for use throughout code
      */

      // Prefilter variable for use to prefilter the graph
      var preFilter;
      // Variable to specify whether direction in path finding is honored
      var directedGlobal;
      // What path finding algorithm is used
      var pathAlgoGlobal;
      // If items are to be preRemoved before rendering
      var preRemove;
      // Variable to define whether the graph is being loaded for the first time or note
      var initialRun;
      // A collection of elements that are being removed
      var element_preRemove;
      // A variable to store highlighted nodes
      var boxedNodes;
      // Background color
      var bgColor;
      // Text color
      var textColor;
      // Not in use - A number to use when removing nodes by children / parent count
      var removeNodesByCount;
      // Whether to recursively add nodes in the graph
      var recursiveLookup;
      // The existing layout prior to initiating the focus function
      var graphStateForFocus;
      // A variable to tell the graph that it is zoomed in and to not honor mouse over actions on edges
      var isZoomedIn;
      // The incrementer for a dynamic class that is used in edge styling
      var edgeSearchColorNum = 0;

      return SplunkVisualizationBase.extend({

        initialize: function () {
          SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
          this.$el = $(this.el);
          // If the theme is dark mode set the correct background color and text color.
          if (SplunkVisualizationUtils.getCurrentTheme && SplunkVisualizationUtils.getCurrentTheme() === 'dark') {
            bgColor = "#212527";
            textColor = "#ffffff";
          } else {
            bgColor = undefined;
            textColor = undefined;
          }
          // Optional explicit background (e.g. Dashboard Studio's panel background colour).
          var customBg = SplunkVisualizationUtils.getBackgroundColor && SplunkVisualizationUtils.getBackgroundColor();
          if (customBg) {
            bgColor = customBg;
            textColor = isDarkColor(customBg) ? "#ffffff" : "#000000";
          }

        },
        // Escape properties that are passed as configuration items
        _getEscapedProperty: function (name, config) {
          var propertyValue = config[this.getPropertyNamespaceInfo().propertyNamespace + name];
          return SplunkVisualizationUtils.escapeHtml(propertyValue);
        },
        // Get the configuration parameters
        _getConfigParams: function (config) {
          changedConfig = Object.keys(config)[0];
          // If there is only one configuration change (This happens after the first click of formatter menu)
          if (Object.keys(config).length == 1) {
            switch (changedConfig) {
              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.layoutStyle":
                this.layoutStyle = this._getEscapedProperty('layoutStyle', config);
                break;

              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.pathAlgo":
                this.pathAlgo = this._getEscapedProperty('pathAlgo', config);
                break;

              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.directed":
                this.directed = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('directed', config));
                break;

              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.maxRows":
                this.maxRows = parseMaxRows(this._getEscapedProperty('maxRows', config));
                break;

              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.nodeSize":
                this.nodeSize = this._getEscapedProperty('nodeSize', config) || 'fixed';
                break;

              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.largeGraphNodes":
                this.largeGraphNodes = parsePositiveInt(this._getEscapedProperty('largeGraphNodes', config), DEFAULT_LARGE_GRAPH_NODES);
                break;

              default:
                // Set default options for the console if this is a fresh load or something else happened.
                this.layoutStyle = this._getEscapedProperty('layoutStyle', config) || 'fcose';
                this.directed = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('directed', config), {
                  default: false
                });
                this.pathAlgo = this._getEscapedProperty('pathAlgo', config) || 'dijkstra';
                this.recursiveLookup = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('recursiveLookup', config), {
                  default: false
                });
                recursiveLookup = this.recursiveLookup;
                this.maxRows = parseMaxRows(this._getEscapedProperty('maxRows', config));
                this.nodeSize = this._getEscapedProperty('nodeSize', config) || 'fixed';
                this.largeGraphNodes = parsePositiveInt(this._getEscapedProperty('largeGraphNodes', config), DEFAULT_LARGE_GRAPH_NODES);


                break;
            }
            return;
          } else {
            // Set default options for the console if this is a fresh load or something else happened.
            this.layoutStyle = this._getEscapedProperty('layoutStyle', config) || 'fcose';
            this.directed = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('directed', config), {
              default: false
            });
            this.pathAlgo = this._getEscapedProperty('pathAlgo', config) || 'dijkstra';
            this.recursiveLookup = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('recursiveLookup', config), {
              default: false
            });
            recursiveLookup = this.recursiveLookup;
            this.maxRows = parseMaxRows(this._getEscapedProperty('maxRows', config));
            this.nodeSize = this._getEscapedProperty('nodeSize', config) || 'fixed';
            this.largeGraphNodes = parsePositiveInt(this._getEscapedProperty('largeGraphNodes', config), DEFAULT_LARGE_GRAPH_NODES);


            return;
          }


        },

        onConfigChange: function (configChanges, previousConfig) {
          // Get Configuration Data
          // if the previous config is the same as the configured menu item.  Do Nothing.  Handling first time opening the format menu
          if (Object.keys(previousConfig).length == 1 && previousConfig["display.visualizations.custom.drilldown"] == "all" && Object.keys(configChanges).length > 1) {
            //this._getConfigParams(configChanges);
            return;
          }

          // If Config has been updated then re-run invalidateUpdateView()
          else {
            changedConfig = Object.keys(configChanges)[0];
            switch (changedConfig) {
              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.layoutStyle":
                this.invalidateUpdateView();
                break;

              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.pathAlgo":
                pathAlgoGlobal = configChanges["display.visualizations.custom.licoryx_link_analysis_app.link_analysis.pathAlgo"];
                this._getConfigParams(configChanges);
                break;


              case "display.visualizations.custom.licoryx_link_analysis_app.link_analysis.directed":

                directedGlobal = SplunkVisualizationUtils.normalizeBoolean(configChanges["display.visualizations.custom.licoryx_link_analysis_app.link_analysis.directed"]);
                this._getConfigParams(configChanges);
                break;

              default:
                this.invalidateUpdateView();
                break;
            }
            return;
          }
        },

        // Optionally implement to format data returned from search.
        // The returned object will be passed to updateView as 'data'
        formatData: function (data, config) {
          // Limit the number of rows drawn (option maxRows); remember the original count for a warning.
          var limit = parseMaxRows(this._getEscapedProperty('maxRows', config));
          this.totalRows = data.rows.length;
          if (data.rows.length > limit) {
            data = { fields: data.fields, rows: data.rows.slice(0, limit), meta: data.meta };
          }
          // A dictionary for formatting
          this.format_info = {};
          // Create nodes dictionary for ID creation purposes.
          var nodesByName = {};
          // A dictionary for formatting
          format_info = {};
          // Create an empty group array to allow group assignment
          group_list = [];
          // Take the first data point
          datum = data.rows;
          // Create empty array to place all of the nodes in
          var nodesArray = [];
          // Create empty array to place all edges / links in
          var linksArray = [];
          // Get updated configuration parameters
          this._getConfigParams(config);
          // Remember the source / target field names and which names appear as a source (for drilldown)
          this.srcField = data.fields[0] && data.fields[0].name;
          this.destField = data.fields[1] && data.fields[1].name;
          this.srcNames = new Set(data.rows.map(function (r) { return r[0]; }));
          // Optional columns (count, src_group/dest_group, src_color/dest_color) and per-node attributes.
          var columns = detectColumns(data.fields);
          this.columns = columns;
          this.nodeAttrs = nodeAttributes(data.rows, columns);

          // Update group items
          // For each field in the output if the regex matches the pattern variable push it to the columns array

          // Set x to 0 so the line numbers match up.
          formatIterNum = 0;
          data.fields.forEach(function (column) {
            var str = String(column.name);

            switch (str) {
              case "line_label":
                format_info['line_label'] = formatIterNum;
                break;

              case "line_color":
                format_info['line_color'] = formatIterNum;
                break;

              case "line_colour":
                format_info['line_color'] = formatIterNum;
                break;

              case "filter_start":
                format_info['filter_start'] = formatIterNum;
                preFilter = data.rows[0][formatIterNum].toString();
                break;
              case "filter_end":
                format_info['filter_end'] = formatIterNum;
                break;
              case "remove":
                format_info['remove'] = formatIterNum;
                preRemove = data.rows[0][formatIterNum].toString();
                break;
              default:
                break;
            }

            formatIterNum++;
          });

          //For each row in the data push the value of the first and second column into the group_list array.
          // Create an incrementer variable for node id
          var n = 0;
          datum.forEach(function (link) {
            // Create a list of nodes and add to array
            nodesArray.push(link[0]);
            nodesArray.push(link[1]);
            // Add each node to an array so that we can later use it to create dynamic groups for colouring
            group_list.push({
              name: link[0]
            });
            group_list.push({
              name: link[1]
            });
            group_id = 0;
            // Create a link object to push the target and source to the linksArray array.
            object = {};
            object.target = nodeByName(link[0], group_id);
            object.source = nodeByName(link[1], group_id);
            object.count = columns.count >= 0 ? link[columns.count] : undefined;
            // Push the nodes to the nodesByName array including a group id of 0.
            // Push the object dictionary item from lines above to the linksArray array
            linksArray.push(object);
          });
          // For performance reasons if there is more than 1000 edges don't apply dynamic colours.
          if (datum.length < 1000) {
            // Perform a group by count by each source address
            this.groupCount = countByKey(group_list, 'name');

          }
          this.format_info = format_info;
          this.group_list = group_list;
          this.nodesArray = nodesArray;
          this.nodesByName = nodesByName;
          this.linksArray = linksArray;

          // Function to check if a node is in the list and push the name and the group
          function nodeByName(name, groupId) {
            return nodesByName[name] || (nodesByName[name] = {
              name: name,
              group: groupId
            });
          }
          return data;
          // End Format Data Function

        },

        // Implement updateView to render a visualization.
        // 'data' will be the data object returned from formatData or from the search
        // 'config' will be the configuration property object
        updateView: function (data, config) {

          // Guard for empty data
          if (data.rows.length < 1) {
            return false;
          }

          if (data.fields.length < 2) {
            throw new SplunkVisualizationBase.VisualizationError(
              'Need at least two columns formatted <src> <dest>'
            );
          }

          // Throw warning if there is more than 10,000 rows
          /*
          if (data.rows.length >10000) {
            var message = 'Warning: This visualization renders up to 10,000 data points. Results might be truncated.';
            this.el.innerHTML = message;
          }
          */

          // Get configuration
          this._getConfigParams(config);
          var vizEl = this.el;
          this._notices = [];

          // Take the first data point
          datum = data.rows;

          // Create nodes dictionary for ID creation purposes.
          var nodesByName = this.nodesByName;

          // Create an array that is used to highlight neighbouring links
          var linkedByIndex = {};

          // Create an empty dictionary for placing the results of the headers in
          var headers = {};

          // Create empty array to place all of the links in
          var linksArray = this.linksArray;

          // Create a variable of x that is 0 to enable iteration
          // var x = 0;

          var groupCount = this.groupCount;
          // Create variable for line style
          var format_info = {};

          // Create empty array for storing header rows / fields
          columns = [];

          // Create pattern for matching header rows / fields to match nodeXX
          var pattern = /node\d{2}$/i;

          // Create a color gradient for highlighting groups
          var color = ordinalColor();
          var groupColor = ordinalColor();

          // Nodes Array
          nodesArray = this.nodesArray;
          // Path Finding Algo
          var start;
          var end;

          // Set Layout Style Global var
          layoutStyle_global = this.layoutStyle;

          // Set Directed Global
          directedGlobal = this.directed;

          // Path Algo Global
          pathAlgoGlobal = this.pathAlgo;

          // Grab the width and height of the current element
          var width = this.$el.width()
          var height = this.$el.height()
          // Check to see if cy element exists
          var getCy = document.getElementById(CY_ID)
          // If the cy element is null then
          if (getCy == null) {
            // Specify a width and height that matches the Splunk console
            // Append an SVG Element
            var cyDiv = document.createElement('div');
            cyDiv.id = CY_ID;
            cyDiv.className = 'lla-cy';
            this.el.appendChild(cyDiv);
          }

          // Add Cytoscape Element
          if (this._cy) {
            this._cy.destroy();
            this._cy = null;
          }
          var cy = cytoscape({
            container: document.getElementById(CY_ID),
            style: [{
              selector: 'node',
              style: {
                label: 'data(label)'
              }
            }]
          });
          // Keep a reference for resize and for destroying it on the next render.
          this._cy = cy;
          // If a group count exists
          if (groupCount) {
            // Return group counts which have a rollup value of greater than 1
            var groups = groupCount.filter(function (group) {
              return group.value > 1;
            });
            // Start from the first group and iterate through
            var z = 1;
            groups.forEach(function (groupArrayMember) {
              groupArrayMember.group = z;
              z++;
            });

            // For each item in the groups array
            groups.forEach(function (groupArrayMember) {
              // Return a subset of the linksArray where a group number hasn't been allocated i.e 0
              linkGroup = linksArray.filter(function (x) {
                return nodesByName[x.source.name].group === 0 || nodesByName[x.target.name].group === 0;
              });
              // For each item in the linkGroup array
              linkGroup.forEach(function (linkGroupArray) {
                // If the reduced array group is either the source or target.
                if (groupArrayMember.key === linkGroupArray.source.name || groupArrayMember.key === linkGroupArray.target.name) {
                  // If the group value of the source is 0
                  if (nodesByName[linkGroupArray.source.name].group === 0) {
                    // Set the group value of both the source to group.group
                    nodesByName[linkGroupArray.source.name].group = groupArrayMember.group;
                  }
                  // If the group value of the target is 0
                  if (nodesByName[linkGroupArray.target.name].group === 0) {
                    // Set the group value of both the target to group.value
                    nodesByName[linkGroupArray.target.name].group = groupArrayMember.group;
                  }
                }
              });
            });
          }
          // Create a unique list of nodes
          const unique = (value, index, self) => {
            return self.indexOf(value) === index;
          }
          // Create a unique list of items from the nodesArray variable
          nodesUnique = nodesArray.filter(unique);

          // Create an incrementer variable for node id
          var n = 0;

          // Node colours: explicit src_color/dest_color, else src_group/dest_group (with a legend),
          // else the automatic connectivity groups. Optional size by degree or by summed count.
          var nodeAttrs = this.nodeAttrs || new Map();
          var sizes = nodeSizes(nodeAttrs, this.nodeSize);
          var legend = new Map();
          nodesUnique.forEach(function (node) {
            // Create an incrementer for the node id
            node_id = "n" + n;
            // Add node and node ID
            nodeById(node, node_id)
            var attrs = nodeAttrs.get(node) || {};
            if (attrs.color) {
              node_color = attrs.color;
            } else if (attrs.group !== null && attrs.group !== undefined) {
              node_color = groupColor(attrs.group);
              legend.set(attrs.group, node_color);
            } else {
              node_color = color(nodesByName[node].group);
            }
            var nodeData = {
              id: node_id,
              weight: 1,
              label: node,
              color: node_color
            };
            if (sizes && sizes.has(node)) nodeData.size = sizes.get(node);
            cy.add({ data: nodeData });
            n++;
          });
          this._renderLegend(legend);

          datum.forEach(function (link) {
            // Add nodes to list
            source_out = nodesByName[link[0]].id
            target_out = nodesByName[link[1]].id
            node_data = {
              data: {
                source: source_out,
                target: target_out,
              }
            }
            if (this.format_info['line_label']) {
              line_label_num = this.format_info['line_label']
              node_data.data.label = link[line_label_num]
            }
            node_data.data.color = this.format_info['line_color'] ? node_data.data.color = link[this.format_info['line_color']] : "#808080"

            cy.add(node_data)

          }, this);

          /* 
          Cytoscape Styling of graph
          */

          // Style the edges
          cy.style()
            .selector('edge')
            .style({
              'width': 5,
              'edge-text-rotation': 'autorotate',
              'target-arrow-shape': 'triangle',
              'arrow-scale': 2,
              'curve-style': 'bezier',
              'text-background-color': 'white',
              'text-opacity': 0.1,
              'opacity': 0.3,
              'text-background-opacity': 0.8,
              'text-background-shape': 'roundrectangle',
              'min-zoomed-font-size': '15',
              'text-valign"': 'top',
              'text-halign': 'center',
              'control-point-weight': '0.5', // '0': curve towards source node, '1': towards target node.

            })
            // If the background color is set then apply the appropriate background color
          if (bgColor) {
            cy.style()
              .selector('core')
              .style({
                'background': bgColor
              })

              //Apply the edge color as required including the background color
            cy.style()
              .selector('edge')
              .style({
                'color': textColor,
                'text-background-color': bgColor
              })

              // Apply the node color as defined in the textColor format option
            cy.style()
              .selector('node')
              .style({
                'color': textColor
              })


          }
          // Layout and label decisions for large graphs.
          var plan = planLayout(this.layoutStyle, nodesUnique.length, datum.length, this.largeGraphNodes);
          layoutStyle_global = plan.layout;
          this._notices = plan.notices;
          // If there is a line_label field in the Splunk search define it as a data field
          if (this.format_info.line_label && plan.showEdgeLabels) {
            cy.style()
              .selector('edge')
              .style({
                'label': 'data(label)'
              })
          }
                    
          // If there is a line_color field in the Splunk search define it as a data field

          if (this.format_info.line_color) {
            cy.style()
              .selector('edge')
              .style({
                'line-color': 'data(color)',
              })
          }

          // Cytoscape Styling
          cy.style()
            .selector('node')
            .style({
              'background-color': 'data(color)',
              'min-zoomed-font-size': '15',
            })
          if (sizes) {
            cy.style()
              .selector('node[size]')
              .style({
                'width': 'data(size)',
                'height': 'data(size)'
              })
          }

          // Node Highlighting class
          cy.style()
            .selector('.nodehighlighted')
            .style({
              'border-width': 5,
              'border-color': 'red',
              'width': '60px',
              'height': '60px',
              'transition-duration': '1s'
            });

            // Node highlighted children class (Used when remove field is present)
          cy.style()
            .selector('.nodehighlightedchildren')
            .style({
              'border-width': 5,
              'border-color': 'red',
              'transition-duration': '1s'
            });


          // Highlighted Class for path highlighted nodes and finally update the style sheet
          cy.style()
            .selector('.highlighted')
            .style({
              'background-color': '#61bffc',
              'line-color': '#cc0000',
              'target-arrow-color': '#cc0000',
              'transition-property': 'background-color, line-color, target-arrow-color',
              'transition-duration': '0.5s'
            }).update();

          // End Styling

          // "Laying out..." indicator: shown now, hidden in launchPostProcess() when the layout
          // stops. The layout starts on the next tick so the browser can paint the indicator.
          var self = this;
          var busyEl = this._busyElement();
          busyEl.style.display = 'block';
          setTimeout(function () {
            if (self._cy !== cy) return; // a newer render replaced this graph
            runLayout(plan.layout);
          }, 30);
          this._renderNotices(data.rows.length, this._notices);

          // Run Layout function
          function runLayout(layoutStyle, initialRun = true) {

            // If Prefilter has been configured
            if (preFilter) {
              // If it is the first time the layout has been run for this javascript session
              if (initialRun == true) {
                if (preFilter.length > 0) {
                  // If the node exists
                  if (nodesByName[preFilter].id) {
                    node_id = "#" + nodesByName[preFilter].id;
                    // Do a path finding process and add to a collection to highlight all nodes outbound and inbound respecting direction for removal
                    highlightCollection = cy.collection(cy.elements().bfs(node_id, 1, directedGlobal).path);
                    var element_del = cy.elements().not(cy.$(highlightCollection));
                    // Remove elements
                    cy.remove(element_del);
                  }
                }
              }
            }
            // If the remove is specified and it is also the initial run of the graph
            if (preRemove && initialRun == true) {
              // Check to ensure that the preRemove var is not empty
              if (preRemove.length > 0) {
                // Check to ensure that the node exists.
                if (nodesByName[preRemove].id) {
                  var initialRun = false;

                  node_id = "#" + nodesByName[preRemove].id;
                  initial_node = cy.$(node_id);
                  // If we are adding children recursively on clicks 
                  if (recursiveLookup == false) {
                    successor_preRemove = initial_node.outgoers()
                    predecessor_preRemove = initial_node.incomers()
                    // If we are only adding immediate children on clicks 
                  } else {
                    successor_preRemove = initial_node.successors()
                    predecessor_preRemove = initial_node.predecessors()
                  }
                  // Create a new colletion from aboce
                  jointNodes_preRemove = successor_preRemove.union(predecessor_preRemove);
                  // Add the children as keys in the nodesByName dictionary
                  nodesByName[preRemove].children = jointNodes_preRemove;

                  // Delete the rest and push the element_preRemove to a variable that can be used later for adding back in a compute efficient way.
                  element_preRemove = cy.$().not(cy.$(node_id));

                  // Iterate through nodes and add predecessors and successors to the nodeByName array
                  for (var x = 0; x < element_preRemove.length; x++) {
                    if (element_preRemove[x].outgoers().length > 1 || element_preRemove[x].incomers().length > 1) {
                      if (recursiveLookup == false) {
                        var successor_preRemove = element_preRemove[x].outgoers()
                        var predecessor_preRemove = element_preRemove[x].incomers()
                      } else {
                        var successor_preRemove = element_preRemove[x].successors()
                        var predecessor_preRemove = element_preRemove[x].predecessors()
                      }
                      var jointNodes_preRemove = successor_preRemove.union(predecessor_preRemove);
                      node_id = "#" + element_preRemove[x].id();
                      node_label = cy.$(node_id).data('label');
                      if (nodesByName[node_label]) {
                        nodesByName[node_label].children = jointNodes_preRemove
                      }

                    }
                  }

                  // Remove all of the elements from the view except the first node.
                  cy.remove(element_preRemove);
                }
              }
            }
            // Fcose Layout Options
            // Fcose Layout Options
            var fcoseOptions = {
              stop: function () {
                cy.removeAllListeners();
                launchPostProcess();
              },
              name: layoutStyle,
              quality: "default",
              // Type of layout animation. The option set is {'during', 'end', false}
              animate: false,
              fit: false,
              // For enabling tiling
              tile: true,
              spacingFactor: 1.2,
              hideEdgesOnViewport: true,
              hideLabelsOnViewport: true,
              nodeDimensionsIncludeLabels: true,
              // interpolate on high density displays instead of increasing resolution
              pixelRatio: 1,
              // a motion blur effect that increases perceived performance for little or no cost
              motionBlur: true,
              nodeDimensionsIncludeLabels: true,
              nodeRepulsion: 20000,
              nodeOverlap: 300,
              // separation amount between nodes
              nodeSeparation: 500,
              // Nesting factor (multiplier) to compute ideal edge length for nested edges
              nestingFactor: 0.1,
              // Gravity force (constant)
              gravity: 0.1,

            };

            // Cose Bilkent Layout options
            var coseBilkentOptions = {
              stop: function () {
                cy.removeAllListeners();
                launchPostProcess();
              },
              name: layoutStyle,
              // Type of layout animation. The option set is {'during', 'end', false}
              animate: false,
              fit: false,

              hideEdgesOnViewport: true,
              hideLabelsOnViewport: true,
              // interpolate on high density displays instead of increasing resolution
              pixelRatio: 1,
              // a motion blur effect that increases perceived performance for little or no cost
              motionBlur: true,
              nodeRepulsion: 20000,
              nodeOverlap: 300
            };
            // Standard Cose Animation Options
            var layoutCoseOptions = {
              stop: function () {
                cy.removeAllListeners();
                launchPostProcess();
              },
              name: 'cose',
              animate: false,
              padding: 100,
              fit: false,
              nodeOverlap: 30,
              idealEdgeLength: function (edge) {
                switch (edge.data().type) {
                  case 1:
                    return 30;
                  case 2:
                  case 3:
                    return 120;
                  case 0:
                  default:
                    return 120;
                }
              },
              edgeElasticity: function (edge) {
                switch (edge.data().type) {
                  case 1:
                    return 50;
                  case 2:
                  case 3:
                    return 200;
                  case 0:
                  default:
                    return 200;
                }
              },
              nestingFactor: 1.2,
              initialTemp: 1000,
              coolingFactor: 0.99,
              minTemp: 1.0,
              gravity: 1.4
            };
            // Switch statement to run different operations depending on the layout selected.
            switch (layoutStyle) {
              case "fcose":
                cy.layout(fcoseOptions).run();
                break;
              case "cose-bilkent":
                cy.layout(coseBilkentOptions).run();
                break;

              case "cose":
                cy.layout(layoutCoseOptions).run();
                break;

              default:
                cy.layout({
                  stop: function () {
                    cy.removeAllListeners();
                    launchPostProcess();
                  },
                  name: layoutStyle,
                  nodeDimensionsIncludeLabels: true,
                  // Performance Options
                  hideEdgesOnViewport: true,
                  hideLabelsOnViewport: true,
                  // interpolate on high density displays instead of increasing resolution
                  pixelRatio: 1,
                  // a motion blur effect that increases perceived performance for little or no cost
                  motionBlur: true,
                  animate: false,
                  nodeRepulsion: 4096,
                  nodeOverlap: 4,
                  fit: false
                }).run();
                break;
            }
          }

          function launchPostProcess() {
            busyEl.style.display = 'none';
            // Layout stop callbacks call cy.removeAllListeners(), so (re)register the
            // double-click drilldown after every layout (initial render, Refresh, ...).
            cy.dblclick(300);
            cy.on('dblclick', function (e) {
              var target = e.target;
              if (!target || target === cy || typeof target.isNode !== 'function') return;
              var data = drilldownData(self, target.isNode()
                ? { kind: 'node', label: target.data('label') }
                : { kind: 'edge', source: target.source().data('label'), target: target.target().data('label') });
              self.drilldownTo(data, e.originalEvent);
            });
            let boxedNodes = cy.collection();
            let elemsWChildren = cy.collection();
            if (preRemove) {
              cy.$(cy.elements()).removeClass('nodehighlightedchildren');
              cy.on('tap', 'node', function (evt) {
                node_id = "#" + evt.target.id();
                node_label = cy.$(node_id).data('label');
                if (nodesByName[node_label].children && nodesByName[node_label].children.length > 0 && nodesByName[node_label].children.difference(cy.elements()).length > 0) {
                  var diff_nodes = nodesByName[node_label].children.difference(cy.elements());
                  cy.add(diff_nodes);
                  runLayout(layoutStyle_global, false);
                }

              });
              for (var x = 0; x < cy.elements().length; x++) {
                if (nodesByName[cy.elements()[x].data('label')] && nodesByName[cy.elements()[x].data('label')].children.length > 0 && nodesByName[cy.elements()[x].data('label')].children.difference(cy.elements())) {
                  if (nodesByName[cy.elements()[x].data('label')].children.difference(cy.elements()).length > 0) {
                    elemsWChildren = elemsWChildren.union(cy.elements()[x]);
                  }
                }
              }
              cy.$(elemsWChildren).addClass('nodehighlightedchildren')
            }

            // (Re)build this instance's node and menu suggestion lists on every render,
            // so they always match the current data.
            [NODE_LIST_ID, MENU_LIST_ID].forEach(function (listId) {
              var existing = document.getElementById(listId);
              if (existing) existing.remove();
            });
            var nodeListDataList = document.createElement("datalist");
            nodeListDataList.setAttribute("id", NODE_LIST_ID);
            nodesUnique.forEach(function (node) {
              var option = document.createElement('option');
              option.value = node;
              nodeListDataList.appendChild(option);
            });
            document.body.appendChild(nodeListDataList);

            var menuDataList = document.createElement("datalist");
            menuDataList.setAttribute("id", MENU_LIST_ID);
            menu_list_items = ['Delete Highlighted Items', 'Delete Non-Highlighted Items', 'Refresh', 'Clear Formatting', 'Save State', 'Style Edges', 'Export Graph JSON'];
            menu_list_items = menu_list_items.sort()
            menu_list_items.forEach(function (item) {
              var option = document.createElement('option');
              option.value = item;
              menuDataList.appendChild(option);
            });
            document.body.appendChild(menuDataList);

            // Add box highlight function
            cy.on('box', function (e) {
              let node = e.target;
              boxedNodes = boxedNodes.union(node);
              boxedNodes.addClass('highlighted');
            });

            // Begin - Add Menu for nodes and background
            var cxtColors = menuColors(!!bgColor && isDarkColor(bgColor));
            cy.cxtmenu(Object.assign({}, cxtColors, {
              selector: 'node',
              commands: [{
                  content: "Single Path Select",
                  select: function (ele) {
                    if (start) {
                      end = ele.id();
                      highlightNextEle(start, end);
                    } else {
                      start = ele.id();
                      cy.getElementById(start).addClass('highlighted')
                    };
                  }
                },
                {
                  content: "Hlt All Paths",
                  select: function (ele) {
                    start = ele.id();
                    n_predecessors = ele.predecessors()
                    n_successors = ele.successors()
                    jointNodes = n_predecessors.union(n_successors);
                    jointNodes.addClass('highlighted')
                    highlightAllPathsFrom(start)

                  }
                },
                {
                  content: 'Focus',
                  select: function (ele) {
                    var collection;
                    // Save the current state of the graph
                    graphStateForFocus = cy.json();
                    // Find the node if of the currently selected node
                    node_id = "#" + ele.id();
                    node = cy.$(node_id)
                    positionOfNode = ele.position()
                    isZoomedIn = true;
                    focus_Node_Outgoers = ele.outgoers()
                    focus_Node_Incomers = ele.incomers()
                    collection = focus_Node_Outgoers.union(focus_Node_Incomers);
                    collection = collection.union(node);
                    notInCollection = cy.elements().not(cy.$(collection));

                    var layout = collection.layout({
                      name: 'concentric',
                      fit: false,
                      animate: true,
                      spacingFactor: 4,
                      minNodeSpacing: 20,
                      avoidOverlap: true,
                      boundingBox: {
                        x1: positionOfNode.x - 1,
                        x2: positionOfNode.x + 1,
                        y1: positionOfNode.y - 1,
                        y2: positionOfNode.y + 1
                      },
                      concentric: function (ele) {
                        if (ele.same(node)) {
                          return 4;
                        } else {
                          return 1;
                        }
                      },
                      levelWidth: function () {
                        return 1;
                      },


                    });

                    // Run the layout
                    layout.run();
                    // Update the style to make all nodes opacity 1
                    cy.style()
                      .selector(notInCollection)
                      .style({
                        'opacity': 0.1,
                      })

                    cy.style()
                      .selector(collection)
                      .style({
                        'text-opacity': 1.0,
                        'z-index': 999,
                        'opacity': 1.0
                      })
                      .update()


                    cy.animate({
                      zoom: 1,
                      center: {
                        eles: node
                      }
                    }, {
                      duration: 1000

                    });

                    // Reset button (top-left of the visualization) to undo the focus
                    var existingReset = document.getElementById(RESET_VIEW_ID);
                    if (existingReset) existingReset.remove();
                    var resetButton = document.createElement("button");
                    resetButton.setAttribute("name", "reset_view");
                    resetButton.setAttribute("id", RESET_VIEW_ID);
                    resetButton.setAttribute("type", "button");
                    resetButton.className = "lla-reset btn btn-primary";
                    resetButton.textContent = "Reset";
                    resetButton.addEventListener("click", function () {
                      // Add the saved graph as the current json
                      cy.json(graphStateForFocus)
                      var layoutStatic = cy.layout({
                        name: 'preset',
                        animation: true,
                        animationEasing: 'linear',
                        animationDuration: 1000
                      });
                      // Prevent mouse over highlight from occuring
                      isZoomedIn = undefined;
                      layoutStatic.run();
                      resetButton.remove();
                    }, false);
                    vizEl.appendChild(resetButton);

                  },
                },
                {
                  content: 'Condense',
                  select: function (ele) {
                    var collection;
                    // Find the node if of the currently selected node
                    node_id = "#" + ele.id();
                    node = cy.$(node_id)
                    positionOfNode = ele.position()
                    focus_Node_Outgoers = ele.outgoers()
                    focus_Node_Incomers = ele.incomers()
                    collection = focus_Node_Outgoers.union(focus_Node_Incomers);
                    collection = collection.union(node);
                    notInCollection = cy.elements().not(cy.$(collection));
                    concentricCount = 0;
                    
                    // Total nodes to calculate the amount of 
                    totalNodes = collection.length
                    if (totalNodes < 50){
                      spacingFactorVar = 4
                    }
                    else if(totalNodes >= 50 && totalNodes <= 80){
                      spacingFactorVar = 2

                    }
                    else if(totalNodes >= 81 && totalNodes <= 150){
                      spacingFactorVar = 1

                    }
                    else{
                      spacingFactorVar = 0.25
                    }
                    var layout = collection.layout({
                      name: 'concentric',
                      fit: false,
                      animate: true,
                      spacingFactor: spacingFactorVar,
                      minNodeSpacing: 5,
                      avoidOverlap: true,
                      boundingBox: {
                        x1: positionOfNode.x - 1,
                        x2: positionOfNode.x + 1,
                        y1: positionOfNode.y - 1,
                        y2: positionOfNode.y + 1
                      },
                      concentric: function (ele) {
                        if (ele.same(node)) {
                          return 4;
                        } else {
                          return 1;
                        }
                      },
                      levelWidth: function () {
                        return 1;
                      },



                    });

                    // Run the layout
                    layout.run();

                    cy.animate({
                      zoom: 0.2,
                      center: {
                        eles: node
                      }
                    }, {
                      duration: 1000

                    });

                  },
                },

              ]
            }));

            cy.cxtmenu(Object.assign({}, cxtColors, {
              selector: 'core',
              commands: [{
                  content: 'Search Nodes',
                  select: function () {
                    // Now we initialize the Modal itself
                    var myModal = new Modal("modal1", {
                      title: "Search Nodes",
                      backdrop: 'static',
                      keyboard: false,
                      destroyOnHide: true,
                      type: 'normal'
                    });
                    myModal.body
                      .append($('<p>Use the search menu to find and zoom into a node.</p>'));

                    myModal.body
                      .append($('<input>').attr({
                        'name': 'node_search',
                        'id': 'node_search',
                        'type': 'text',
                        'list': NODE_LIST_ID,
                        'style': 'z-index:9999'
                      }));

                    myModal.footer.append($('<button>').attr({
                      type: 'button',
                      'data-dismiss': 'modal'
                    }).addClass('btn btn-primary').text('Search').on('click', function () {
                      // Do Nothing Function
                      searchNodes();

                    }))
                    myModal.show(); // Launch it!
                  },
                },

                {
                  content: 'Menu',
                  select: function (ele) {
                    // Now we initialize the Modal itself
                    var myModal = new Modal("modal1", {
                      title: "Menu",
                      backdrop: 'static',
                      keyboard: false,
                      destroyOnHide: true,
                      type: 'normal'
                    });
                    myModal.body
                      .append($('<p>Select from the list of available functions.</p>'));

                    myModal.body
                      .append($('<input>').attr({
                        'name': 'menu_select',
                        'id': 'menu_select',
                        'type': 'text',
                        'list': MENU_LIST_ID,
                        'style': 'z-index:9999'
                      }).addClass('table table-striped table-hover'));

                    myModal.footer.append($('<button>').attr({
                      type: 'button',
                      'data-dismiss': 'modal'
                    }).addClass('btn btn-primary').text('Select').on('click', function () {
                      // Do Nothing Function
                      x = document.getElementById('menu_select')
                      returnMenu(ele, x);

                    }))
                    myModal.show(); // Launch it!
                  },
                },

              ]
            }));

            // Set Min Zoom / Max Zoom
            cy.minZoom(0.05);
            cy.maxZoom(1.5);
            var zIndex;
            // Set a mouse over and mouse out listener for edges to make them easier to view
            cy.on('mouseover', 'edge', function (evt) {
              if (isZoomedIn == undefined) {
                edge_id = "#" + evt.target.id()
                zIndex = cy.$(edge_id).style().zIndex
                cy.style()
                  .selector(edge_id)
                  .style({
                    'text-opacity': 1.0,
                    'opacity': 1.0,
                    'z-index': 999
                  }).update()
              }
            });

            cy.on('mouseout', 'edge', function (evt) {
              if (isZoomedIn == undefined) {
                edge_id = "#" + evt.target.id()
                cy.style()
                  .selector(edge_id)
                  .style({
                    'text-opacity': 0.1,
                    'opacity': 0.3,
                    'z-index': zIndex
                  }).update()
                var zIndez
              }
            });


            if (preFilter) {
              node_id = "#" + nodesByName[preFilter].id;
              cy.fit(node_id);
            } else if (preRemove && initialRun == true) {
              node_id = "#" + nodesByName[preRemove].id;
              cy.fit(node_id);
            } else if (initialRun == false) {
              // Do nothing routine
              // nothing to do
            } else {
              cy.fit()
            }


          }


          // End - Add Menu for nodes and background


          function searchNodes() {
            var input = document.getElementById("node_search");
            var node_value = input ? String(input.value).trim() : '';
            var found = matchNodeName(Object.keys(nodesByName), node_value);
            var match = found !== null ? nodesByName[found] : null;
            if (match && cy.getElementById(String(match.id)).length) {
              node_id = "#" + match.id;
              // Zoom in to the node naturally
              cy.animate({
                zoom: 1,
                center: {
                  eles: node_id
                }
              }, {
                duration: 1000
              });
              cy.$(node_id).flashClass('nodehighlighted', 2500);
            }
          }

          // Begin - Path Highlighting Function

          function highlightNextEle(start_id, end_id) {
            console.log(directedGlobal);
            // Highlight Elements
            startid_hash = "#" + start_id
            endid_hash = "#" + end_id
            switch (pathAlgoGlobal) {

              case "dijkstra":
                // code block
                var dijkstra = cy.elements().dijkstra(startid_hash, function (eles) {
                  return 1
                }, directedGlobal);
                var djs = dijkstra.pathTo(endid_hash);

                for (var x = 0; x < djs.length; x++) {
                  var el = djs[x];
                  el.addClass('highlighted');
                }
                break;

              case "aStar":
                // code block
                var aStar = cy.elements().aStar({
                  root: startid_hash,
                  goal: endid_hash,
                  directed: directedGlobal
                });
                for (var x = 0; x < aStar.path.length; x++) {
                  var el = aStar.path[x];
                  el.addClass('highlighted');
                }
                break;

              case "floydWarshall":
                // code block
                var fw = cy.elements().floydWarshall();
                fw_collection = fw.path(startid_hash, endid_hash)
                for (var x = 0; x < fw_collection.length; x++) {
                  var el = fw_collection[x];
                  el.addClass('highlighted');
                }
                break;
              case "bellmanFord":
                // code block
                var bellmanFord = cy.elements().bellmanFord({
                  root: startid_hash,
                  directed: directedGlobal
                });
                var djs = bellmanFord.pathTo(endid_hash);
                for (var x = 0; x < djs.length; x++) {
                  var el = djs[x];
                  el.addClass('highlighted');
                }
                break;

              default:
                // code block
                var dijkstra = cy.elements().dijkstra(startid_hash, function (eles) {
                  return 1
                }, directedGlobal);
                var djs = dijkstra.pathTo(endid_hash);

                for (var x = 0; x < djs.length; x++) {
                  var el = djs[x];
                  el.addClass('highlighted');
                }
                break;
            }
            start = undefined;
            end = undefined;
          }

          // End - Single Path Highlighting Function

          // Begin - Higlight All Paths From.
          function highlightAllPathsFrom(start_node) {
            start_node = "#" + start_node;
            console.log(directedGlobal);
            var bfs = cy.elements().bfs(start_node, 1, directedGlobal);
            for (var x = 0; x < bfs.path.length; x++) {
              var el = bfs.path[x];
              el.addClass('highlighted');
            }

          }
          // End Higlight All Nodes between path.

          // Debounce Function for improved performance
          function debounce(func, wait, immediate) {
            var timeout;
            return function () {
              var context = this,
                args = arguments;
              var later = function () {
                timeout = null;
                if (!immediate) func.apply(context, args);
              };
              var callNow = immediate && !timeout;
              clearTimeout(timeout);
              timeout = setTimeout(later, wait);
              if (callNow) func.apply(context, args);
            };
          };

          function nodeById(name, node_id) {
            return nodesByName[name].id || (nodesByName[name].id = node_id);
          }

          function returnMenu(ele, x) {

            switch (x.value) {
              case "Delete Highlighted Items":

                deleteElement('menu_select')

                var element_del = cy.elements(cy.$('.highlighted'));
                // Remove elements
                cy.remove(element_del);
                break;

              case "Delete Non-Highlighted Items":
                // deleteElement('menu_list')
                deleteElement('menu_select')
                // Select all elements that are not highligted
                var element_del = cy.elements().not(cy.$('.highlighted'));
                // Remove elements
                cy.remove(element_del);
                cy.elements().removeClass('highlighted');

                break;

              case "Refresh":
                // deleteElement('menu_list')
                deleteElement('menu_select')
                runLayout(layoutStyle_global, false);
                break;

              case "Search":
                // deleteElement('menu_list')
                deleteElement('menu_select')

                break;



              case "Clear Formatting":
                // deleteElement('menu_list')
                deleteElement('menu_select')
                start = undefined;
                end = undefined;
                cy.elements().removeClass('highlighted');
                break;

              case "Save State":
                deleteElement('menu_select')
                openSaveStateDialog();
                break;

              case "Export Graph JSON":
                deleteElement('menu_select')
                openExportDialog();
                break;

              case "Remove Nodes by Count":
                // deleteElement('menu_list')
                deleteElement('menu_select')

                // Create Modal for HTTP Save State
                var myModal = new Modal("modal1", {
                  title: "Remove Nodes By Count",
                  backdrop: 'static',
                  keyboard: false,
                  destroyOnHide: true,
                  type: 'normal'
                });
                /*
                $(myModal.$el).on("hide", function() {
                })*/
                myModal.body
                  .append($('<p>This menu allows you to delete nodes that have less than or greater than a number you specify of children or parent nodes recursively</p>'));

                myModal.body
                  .append($('<select id="lt_gt" name="lt_gt"><option value ="less_than">Less Than</option><option value ="gt_than">Greater Than</option>'));
                myModal.body
                  .append($('<input type="text" autocomplete="on" id="number" name="number" required>'));

                myModal.footer.append($('<button>').attr({
                  type: 'button',
                  'data-dismiss': 'modal'
                }).addClass('btn btn-primary').text('Submit').on('click', function (modalEle) {
                  var lt_gt = document.getElementById("lt_gt").value;
                  var numberInput = document.getElementById("number").value;
                  if (Number(numberInput)) {
                    if (lt_gt == "less_than") {
                      removeNodesByCount = cy.collection()
                      Object.keys(nodesByName).forEach(function (key) {

                        if (nodesByName[key].children && nodesByName[key].children.length < numberInput) {
                          removeNodesByCount.union(nodesByName[key].children)
                        } else {
                          // Delete the node
                          node_id = "#" + nodesByName[key].id
                          removeNodesByCount.union(cy.$(node_id))
                        }
                      })
                    } else if (lt_gt == "gt_than") {
                      if (nodesByName[key].children && nodesByName[key].children.length > numberInput) {
                        removeNodesByCount.union(nodesByName[key].children)
                      }

                    }
                    // Finally
                    cy.remove(removeNodesByCount);
                  } else(
                    console.log("Error not a number")
                  )

                }))
                myModal.show(); // Launch it!

                break;

              case "Style Edges":
                // deleteElement('menu_list')
                deleteElement('menu_select')

                // Create Modal for HTTP Save State
                var myModal = new Modal("modal1", {
                  title: "Style Edges",
                  backdrop: 'static',
                  keyboard: false,
                  destroyOnHide: true,
                  type: 'normal'
                });
                /*
                $(myModal.$el).on("hide", function() {
                })*/
                myModal.body
                  .append($('<p>This menu allows you to style edges that have a string present on the edge and highlight it in a different colour</p>'));
                myModal.body
                  .append($('<h4>String To Search (Single Phrase)</h4>'));
                myModal.body
                  .append($('<input type="text" autocomplete="on" id="edgeTextSearch" name="edgeTextSearch" required>'));
                myModal.body
                  .append($('<h4>Color to Select</h4>'));
                myModal.body
                  .append($(' <input type="color" id="style_color" name="head" value="#e66465">'));

                myModal.footer.append($('<button>').attr({
                  type: 'button',
                  'data-dismiss': 'modal'
                }).addClass('btn btn-primary').text('Submit').on('click', function (modalEle) {
                  var description = document.getElementById("edgeTextSearch").value;
                  var edgeLineColor = document.getElementById("style_color").value;
                  searchString = 'edge[label *= "' + description + '"]';
                  searchFilter = cy.filter(searchString);
                  // Create new edge search color style and apply it.
                  edgeSearchColorNum++

                  // Used to create the style in CSS Format.
                  edgeSearchColorStyle = '.edgeSearchColor' + edgeSearchColorNum.toString()
                  // Used to apply the style in CSS format
                  edgeSearchColorStyleCy = 'edgeSearchColor' + edgeSearchColorNum.toString()
                  // Highlighted Class
                  cy.style()
                    .selector(edgeSearchColorStyle)
                    .style({
                      'line-color': edgeLineColor
                    }).update();
                  cy.$(searchFilter).addClass(edgeSearchColorStyleCy)
                }))
                myModal.show(); // Launch it!

                break;

              default:
                // deleteElement('menu_list')
                deleteElement('menu_select')
                // Do nothing

                break;

            }
          }

          function deleteElement(elementId) {
            // Delete the search box
            var element = document.getElementById(elementId);
            if (element) element.remove();
          }

          function makeid() {
            var result = '';
            var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            var charactersLength = characters.length;
            for (var i = 0; i < 20; i++) {
              result += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
            return result;
          }

          // ---- Save State ---------------------------------------------------
          // KV store (default where available): saved with the viewer's own Splunk
          // session to the app's cyto_graphs collection; no token or CORS needed.
          // HTTP Event Collector (optional): sent to index=cyto, sourcetype=cyto:graph.

          function showStatus(title, text) {
            var statusModal = new Modal("modal1", {
              title: title,
              backdrop: 'static',
              keyboard: false,
              destroyOnHide: true,
              type: 'normal'
            });
            statusModal.body.append($('<p>').text(text));
            statusModal.footer.append($('<button>').attr({
              type: 'button',
              'data-dismiss': 'modal'
            }).addClass('btn btn-primary').text('Close'));
            statusModal.show();
          }

          function openSaveStateDialog() {
            var useKv = !!(features.kvstore && features.saveToKvStore);
            var saveModal = new Modal("modal1", {
              title: "Save State",
              backdrop: 'static',
              keyboard: false,
              destroyOnHide: true,
              type: 'normal'
            });
            saveModal.body.append($('<p>').text('Save the current graph (layout, highlighting and styling) so it can be reopened in the Link Analysis Historical View.'));
            saveModal.body.append($('<h4>').text('Description'));
            saveModal.body.append($('<input type="text" id="http_description" name="http_description" required>').val('This graph shows ....'));

            var hecFields = $('<div class="lla-hec-fields">');
            hecFields.append($('<h4>').text('HTTP Event Collector token'));
            hecFields.append($('<input type="password" autocomplete="off" id="http_event_code" name="http_event_code">'));
            hecFields.append($('<h4>').text('HTTP Event Collector URL'));
            hecFields.append($('<input type="text" id="http_destination" name="http_destination">').val('https://yoursplunkserver.com:8088/services/collector'));

            if (useKv) {
              saveModal.body.append($('<h4>').text('Save to'));
              var method = $('<select id="lla_save_method" name="lla_save_method">')
                .append($('<option value="kvstore">').text('Splunk (app KV store) - recommended'))
                .append($('<option value="hec">').text('HTTP Event Collector (index=cyto)'));
              saveModal.body.append(method);
              var kvNote = $('<p class="lla-note lla-kv-note">').hide();
              saveModal.body.append(kvNote);
              hecFields.hide();
              method.on('change', function () {
                hecFields.toggle(method.val() === 'hec');
              });
              // If the KV store is not running (e.g. Splunk 10.4 on Linux kernel 6.19+), switch to HEC up front.
              if (features.checkKvStore) {
                Promise.resolve(features.checkKvStore()).then(function (status) {
                  if (status && status.ready === false) {
                    method.find('option[value="kvstore"]').prop('disabled', true)
                      .text('Splunk (app KV store) - unavailable');
                    method.val('hec');
                    hecFields.show();
                    kvNote.text('The KV store is not available on this Splunk server (' + (status.status || 'unknown') +
                      '), so the graph will be sent to the HTTP Event Collector instead.').show();
                  }
                }).catch(function () { /* status unknown: keep the KV store default */ });
              }
            } else {
              saveModal.body.append($('<p class="lla-note">').text('Saved via the HTTP Event Collector to index=cyto. The collector must allow cross-origin requests from this dashboard.'));
            }
            saveModal.body.append(hecFields);

            saveModal.footer.append($('<button>').attr({
              type: 'button',
              'data-dismiss': 'modal'
            }).addClass('btn btn-primary').text('Save').on('click', function () {
              var description = document.getElementById("http_description").value;
              var methodEl = document.getElementById("lla_save_method");
              if (useKv && (!methodEl || methodEl.value === 'kvstore')) {
                saveToKvStore(description);
              } else {
                var http_event_code = document.getElementById("http_event_code").value;
                var http_destination = document.getElementById("http_destination").value;
                httpRequest(http_destination, http_event_code, cy.json(), description);
              }
            }));
            saveModal.show();
          }

          function saveToKvStore(description) {
            var record = {
              graph_id: makeid(),
              description: description,
              graph_info: JSON.stringify(cy.json()),
              saved_at: Math.floor(Date.now() / 1000)
            };
            Promise.resolve(features.currentUser ? features.currentUser() : null)
              .catch(function () { return null; })
              .then(function (user) {
                if (user) record.saved_by = user;
                return features.saveToKvStore(record);
              })
              .then(function () {
                showStatus("Save State Status", "Saved to Splunk as \"" + description + "\" (" + record.graph_id + ").");
              })
              .catch(function (err) {
                // eslint-disable-next-line no-console
                console.error(err);
                showStatus("Error Occured in Saving State", "Could not save to the KV store: " + (err && err.message ? err.message : err));
              });
          }

          // Show the graph as Cytoscape JSON so it can be copied (e.g. from Dashboard Studio,
          // which cannot save with the viewer's login) and imported on the Manage Saved Graphs page.
          function openExportDialog() {
            var exportModal = new Modal("modal1", {
              title: "Export Graph JSON",
              backdrop: 'static',
              keyboard: false,
              destroyOnHide: true,
              type: 'normal'
            });
            exportModal.body.append($('<p>').text('Copy this JSON (Ctrl/Cmd+A, Ctrl/Cmd+C) and paste it into "Import graph" on the Manage Saved Graphs page to save it in Splunk.'));
            var area = $('<textarea class="lla-export" id="lla_export_json" readonly rows="12">').val(JSON.stringify(cy.json()));
            area.on('focus click', function () { this.select(); });
            exportModal.body.append(area);
            exportModal.footer.append($('<button>').attr({
              type: 'button',
              'data-dismiss': 'modal'
            }).addClass('btn btn-primary').text('Close'));
            exportModal.show();
            area.trigger('focus');
          }

          function httpRequest(url, hec_code, message, description) {
            var xhttp = new XMLHttpRequest();
            full_hec = "Splunk " + hec_code;
            full_message = {
              "event": {
                "description": description,
                "graph_info": message,
                "graph_id": makeid()
              },
              "index": "cyto",
              "sourcetype": "cyto:graph"
            };
            xhttp.open("POST", url, true);
            xhttp.setRequestHeader("Authorization", full_hec);
            xhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhttp.onload = function () {
              var text;
              try {
                responseText = JSON.parse(xhttp.responseText);
                text = responseText.text;
              } catch (e) {
                text = 'HTTP ' + xhttp.status;
              }
              showStatus("Save State Status", "Response : " + text);
            };
            xhttp.onerror = function () {
              showStatus("Error Occured in Saving State", "Error occured. Check the Javascript console for the details.");
            };
            xhttp.send(JSON.stringify(full_message));
          }

          function getRandomArbitrary(min, max) {
            return Math.ceil(Math.random() * (max - min) + min);
          }
        },


        // Search data params
        getInitialDataParams: function () {
          // Fetch up to the largest allowed limit; the maxRows option decides how many are drawn.
          return ({
            outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
            count: MAX_ROWS_LIMIT
          });
        },

        _renderNotices: function (shownRows, extra) {
          var box = this.el.querySelector('.lla-notices');
          if (!box) {
            box = document.createElement('div');
            box.className = 'lla-notices';
            this.el.appendChild(box);
          }
          box.textContent = '';
          if (this.totalRows > shownRows) {
            var row = document.createElement('div');
            row.className = 'lla-notice lla-row-warning';
            row.textContent = 'Showing the first ' + shownRows + ' of ' + this.totalRows +
              ' rows. Raise "Maximum rows" in the visualization options to draw more.';
            box.appendChild(row);
          }
          (extra || []).forEach(function (text) {
            var n = document.createElement('div');
            n.className = 'lla-notice';
            n.textContent = text;
            box.appendChild(n);
          });
          box.style.display = box.childNodes.length ? 'block' : 'none';
        },

        _renderLegend: function (legend) {
          var box = this.el.querySelector('.lla-legend');
          if (!legend || legend.size === 0) {
            if (box) box.remove();
            return;
          }
          if (!box) {
            box = document.createElement('div');
            box.className = 'lla-legend';
            this.el.appendChild(box);
          }
          box.textContent = '';
          legend.forEach(function (color, group) {
            var item = document.createElement('div');
            item.className = 'lla-legend-item';
            var swatch = document.createElement('span');
            swatch.className = 'lla-legend-swatch';
            swatch.style.background = color;
            item.appendChild(swatch);
            item.appendChild(document.createTextNode(String(group)));
            box.appendChild(item);
          });
        },

        _busyElement: function () {
          var el = this.el.querySelector('.lla-busy');
          if (!el) {
            el = document.createElement('div');
            el.className = 'lla-busy';
            el.textContent = 'Laying out graph...';
            this.el.appendChild(el);
          }
          return el;
        },

        drilldownTo: function (data, browserEvent) {
          this.drilldown({
            action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
            data: data
          }, browserEvent);
        },


        // Override to respond to re-sizing events
        reflow: function () {
          if (this._cy) this._cy.resize();
        }
      });
}

/**
 * Returns a visualization class whose every instance gets its own private
 * closure (state, element ids), so several link analysis panels can share a page.
 */
export default function createLinkAnalysisClass(SplunkVisualizationBase, SplunkVisualizationUtils, features) {
  function LinkAnalysisVisualization() {
    var Impl = createLinkAnalysis(SplunkVisualizationBase, SplunkVisualizationUtils, features);
    var instance = Object.create(Impl.prototype);
    var result = Impl.apply(instance, arguments);
    return (result && typeof result === 'object') ? result : instance;
  }
  // Expose a prototype so callers that inspect it still find the base API.
  LinkAnalysisVisualization.prototype = createLinkAnalysis(SplunkVisualizationBase, SplunkVisualizationUtils, features).prototype;
  return LinkAnalysisVisualization;
}
