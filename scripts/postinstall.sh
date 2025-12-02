#!/bin/bash

# Postinstall script to build GitHub dependencies from monorepos

set -e

echo "Building @deepentropy/oakscriptjs..."
cd node_modules/@deepentropy/oakscriptjs/oakscriptjs
npm install
npm run build
cp -r dist ../
cp package.json ../
cd ../../../..

echo "Building @deepentropy/oakview..."
# Remove the incomplete oakview package installed by npm
rm -rf node_modules/@deepentropy/oakview

# Clone the full oakview repo
git clone --depth 1 https://github.com/deepentropy/oakview.git node_modules/@deepentropy/oakview
cd node_modules/@deepentropy/oakview
npm install
npm run build
cd ../..

echo "Postinstall complete!"
