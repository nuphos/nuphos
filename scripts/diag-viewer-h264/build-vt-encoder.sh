#!/bin/sh
# The host's own Encoder (and the helpers it uses), verbatim, plus a driver.
set -e
HOST=apps/desktop/local-runtime/mac-screen-host.swift
OUT=$1
{
  echo 'import CoreMedia'; echo 'import CoreVideo'; echo 'import VideoToolbox'; echo 'import Foundation'
  grep -E '^func be(16|32)' "$HOST"
  awk '/^nonisolated final class Encoder/,/^}/' "$HOST" | sed 's/^nonisolated //'
  cat "$(dirname "$0")/encode-vt.swift.tail"
} > "$OUT.swift"
swiftc -O -o "$OUT" "$OUT.swift"
