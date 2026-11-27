#!/usr/bin/env bash
# Build the Dashboard Studio-only edition: dist/<app>-<version>-studio-only.tgz
#  - only the Studio-framework visualization (no legacy/classic visualization)
#  - no Save State, Expand, Export Graph JSON / Image (built with --studio-only)
#  - no Manage Saved Graphs page (Classic dashboard with custom JavaScript)
#  - Explorer without Expand inputs; Historical View kept read-only for graphs saved earlier
# Uses the committed tree plus uncommitted changes to tracked files.
set -euo pipefail
cd "$(dirname "$0")"
APP=licoryx_link_analysis_app
VER=$(sed -n 's/^version *= *//p' default/app.conf | head -1)
(cd frontend && node build.mjs --studio-only >/dev/null)
TMP=$(mktemp -d)
REV=$(git stash create || true)
git archive --worktree-attributes --prefix="$APP/" "${REV:-HEAD}" | tar -x -C "$TMP"
A="$TMP/$APP"
rm -rf "$A/appserver/static/visualizations/link_analysis" "$A/appserver/static/manage_graphs.js" \
       "$A/default/data/ui/views/manage_saved_graphs.xml" "$A/default/savedsearches.conf" "$A/README/savedsearches.conf.spec"
rmdir "$A/README" 2>/dev/null || true
cp frontend/dist-studio-only/visualization.js "$A/appserver/static/visualizations/link_analysis_studio/visualization.js"
python3 - "$A" <<'PY'
import json, re, sys
a = sys.argv[1]
def edit(path, fn):
    p = f"{a}/{path}"
    s = open(p, encoding="utf-8").read()
    open(p, "w", encoding="utf-8").write(fn(s))
# visualizations.conf: only the Studio visualization (already kept out of the search page picker).
edit("default/visualizations.conf", lambda s: "\n".join([
    "#", "# Studio-only edition: Dashboard Studio custom visualization (extension framework) only", "#", "",
    s[s.index("[link_analysis_studio]"):].rstrip()
    .replace(", and load graphs saved with Save State.", ".") , ""]))
# metadata: drop the classic visualization export
edit("metadata/default.meta", lambda s: re.sub(r"\[visualizations/link_analysis\]\nexport = system\n?", "", s))
# navigation: no Manage page
edit("default/data/ui/nav/default.xml", lambda s: s.replace('  <view name="manage_saved_graphs" />\n', ""))
# app label/description
edit("default/app.conf", lambda s: s.replace("label = Licoryx Link Analysis App", "label = Licoryx Link Analysis App (Studio)")
     .replace("description = ", "description = Dashboard Studio-only edition. ", 1))
# Explorer: no Expand inputs / data source / token
def explorer(s):
    i = s.index("<![CDATA[", s.index("<definition>")) + len("<![CDATA["); j = s.index("]]>", i)
    d = json.loads(s[i:j])
    d["description"] = "Enter a search that returns a source, a target and optionally a count."
    for k in ["input_expand_base", "input_expand_stats"]: d["inputs"].pop(k, None)
    d["dataSources"].pop("ds_expand", None)
    v = d["visualizations"]["viz_graph"]
    v["dataSources"].pop("expand", None)
    v.pop("eventHandlers", None)
    d["layout"]["globalInputs"] = [g for g in d["layout"]["globalInputs"] if not g.startswith("input_expand")]
    return s[:i] + "\n" + json.dumps(d, indent=4) + "\n    " + s[j:]
edit("default/data/ui/views/link_analysis_explorer.xml", explorer)
# Historical View: read-only (graphs saved earlier)
RO = "Open a graph saved earlier (read-only; this edition has no Save State)."
edit("default/data/ui/views/link_analysis_historical_view.xml", lambda s: re.sub(
    r'"description": "Load a graph previously saved with the Save State menu[^"]*"', '"description": "' + RO + '"',
    s.replace("Load a graph previously saved with the Save State menu.", RO)))
# Studio config: no "expand" data source
cfg = f"{a}/appserver/static/visualizations/link_analysis_studio/config.json"
c = json.load(open(cfg)); c["config"]["dataContract"]["optionalDataSources"] = []
json.dump(c, open(cfg, "w"), indent=2)
PY
find "$TMP" -type d -exec chmod 755 {} + && find "$TMP" -type f -exec chmod 644 {} +
mkdir -p dist
OUT="dist/$APP-$VER-studio-only.tgz"
COPYFILE_DISABLE=1 tar --owner=0 --group=0 -C "$TMP" -czf "$OUT" "$APP"
rm -rf "$TMP"
echo "$OUT"
