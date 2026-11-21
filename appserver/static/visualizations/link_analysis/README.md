# Licoryx Link Analysis (Classic) - visualization source

`visualization.js` is the built (webpack, AMD) bundle of the classic (legacy framework) visualization, used by the search page and Classic dashboards. The Dashboard Studio version lives in `../link_analysis_studio` (source in the repository's `studio/` directory). Its source is in `src/`
(`visualization_source.js` and `Modal.js`); third-party libraries are listed in `package.json`.

## Building

```
npm install
npm run build
```

This regenerates `visualization.js` in this directory. Do not ship `node_modules` in the app package.

For more information on custom visualizations see
https://docs.splunk.com/Documentation/Splunk/latest/AdvancedDev/CustomVizDevOverview
