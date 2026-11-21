#!/usr/bin/env bash
# Build a Splunk app package (dist/<app>-<version>.tgz) from the committed tree.
set -euo pipefail
cd "$(dirname "$0")"
APP=licoryx_link_analysis_app
VER=$(sed -n 's/^version *= *//p' default/app.conf | head -1)
TMP=$(mktemp -d)
git archive --prefix="$APP/" HEAD | tar -x -C "$TMP"
find "$TMP" -type d -exec chmod 755 {} + && find "$TMP" -type f -exec chmod 644 {} +
mkdir -p dist
COPYFILE_DISABLE=1 tar --owner=0 --group=0 -C "$TMP" -czf "dist/$APP-$VER.tgz" "$APP"
rm -rf "$TMP"
echo "dist/$APP-$VER.tgz"
