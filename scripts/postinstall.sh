#!/bin/bash

# Postinstall script to build GitHub dependencies from monorepos

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Building @deepentropy/oakscriptjs..."
OAKSCRIPTJS_DIR="$ROOT_DIR/node_modules/@deepentropy/oakscriptjs"
if [ -d "$OAKSCRIPTJS_DIR/oakscriptjs" ]; then
  cd "$OAKSCRIPTJS_DIR/oakscriptjs"
  npm install
  npm run build
  cp -r dist ../
  cp package.json ../
  echo "oakscriptjs build complete."
else
  echo "Warning: oakscriptjs directory not found at $OAKSCRIPTJS_DIR/oakscriptjs"
fi

echo "Building @deepentropy/oakview..."
OAKVIEW_DIR="$ROOT_DIR/node_modules/@deepentropy/oakview"
# Remove the incomplete oakview package installed by npm (if it exists)
if [ -d "$OAKVIEW_DIR" ]; then
  rm -rf "$OAKVIEW_DIR"
fi

# Clone the full oakview repo
git clone --depth 1 https://github.com/deepentropy/oakview.git "$OAKVIEW_DIR"
cd "$OAKVIEW_DIR"
npm install
npm run build
echo "oakview build complete."

echo "Postinstall complete!"
