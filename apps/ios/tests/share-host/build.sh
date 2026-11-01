#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
out="${1:?pass an isolated output directory}"
mkdir -p "$out/ShareTestHost.app"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
xcrun --sdk iphonesimulator swiftc -parse-as-library -sdk "$sdk" -target arm64-apple-ios26.0-simulator main.swift -o "$out/ShareTestHost.app/ShareTestHost"
cat > "$out/ShareTestHost.app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.nuphos.ios.sharetesthost1013</string>
<key>CFBundleExecutable</key><string>ShareTestHost</string>
<key>CFBundleName</key><string>Share test sender</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>26.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
<key>UILaunchScreen</key><dict/>
</dict></plist>
PLIST
codesign --force --sign - "$out/ShareTestHost.app"
