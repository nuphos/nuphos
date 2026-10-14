#!/bin/bash
# One-time prep on macOS: playwright-core, exported SF Symbols, and hero background frames.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build/sym
# No package.json here, so npm installs into apps/ios/node_modules, which Node still resolves.
npm install --no-save --no-package-lock playwright-core@1.64.0
swift symbols.swift build/sym
node hero.mjs
node hero.mjs ipad
