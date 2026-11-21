// Resolve the app's static path relative to the current locale / root_endpoint
// (e.g. /en-US/static/app/... or /<root>/en-US/static/app/...)
var licoryxStaticRoot = window.location.pathname.split('/app/')[0] + '/static/app/licoryx_link_analysis_app';

require(["jquery",
        "splunkjs/ready!",
        "splunkjs/mvc/utils",
        "splunkjs/mvc/searchmanager",
        licoryxStaticRoot + "/scripts/cytoscape.min.js",
        'api/SplunkVisualizationUtils'
    ],
    function (
        $,
        Ready,
        utils,
        SearchManager,
        cytoscape,
        SplunkVisualizationUtils
    ) {
        var desiredSearchName = "cytoState";
        var cyto_viz;
        var sm = splunkjs.mvc.Components.getInstance(desiredSearchName);
        sm.on('search:done', function (properties) {
            var searchName = properties.content.request.label;
            if (properties.content.resultCount == 0) {
                console.log(searchName, "gave no results", properties);
                $("#results").html("<p><span style=\"color: red; font-weight: bolder;\">ERROR!</span> No Results.... do you have any data?</p>");
            } else {
                var results = splunkjs.mvc.Components.getInstance(searchName).data('results', {
                    output_mode: 'json',
                    count: 0
                });
                results.on("data", function (properties) {
                    var searchName = properties.attributes.manager.id;
                    var data = properties.data().results;
                    cyto_viz = JSON.parse(properties.data().results[0]["_raw"]);
                    var cy = cytoscape({
                        container: document.getElementById('cy') // container to render in
                    });

                    cy.json(cyto_viz.graph_info);
                    var layout = cy.layout({
                        name: 'preset'
                    });

                    if (SplunkVisualizationUtils.getCurrentTheme && SplunkVisualizationUtils.getCurrentTheme() === 'dark') {
                        var bgColor = "#212527";
                        var textColor = "#ffffff";
                    } else {
                        var bgColor = "#ffffff";
                        var textColor = "#000";

                    }

                    cy.style()
                        .selector('core')
                        .style({
                            'background': bgColor
                        });

                    cy.style()
                        .selector('edge')
                        .style({
                            'color': textColor,
                            'text-background-color': bgColor
                        });

                    cy.style()
                        .selector('node')
                        .style({
                            'color': textColor
                        }).update();


                    layout.run();
                })
            }
        });

    })
