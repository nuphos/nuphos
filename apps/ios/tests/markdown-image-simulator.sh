#!/bin/bash
set -euo pipefail

# Tapping a Markdown image in a reply must show it in the viewer, not a black
# page, and an image the viewer can't load must offer to try again. Markdown images are https only and preview mode lets only this machine
# through, so this serves the fixture image over HTTPS on 127.0.0.1 with a
# throwaway root certificate added to the simulator, then runs
# MarkdownImageUITests:
#
#   bash tests/markdown-image-simulator.sh [device-udid]
#
# The root stays trusted in that simulator; its key is deleted afterwards.
cd "$(dirname "$0")/.."
device=${1:-$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)}
tmp=$(mktemp -d)
server=
trap '[[ -n $server ]] && kill $server; rm -rf "$tmp"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1" -addext "basicConstraints=critical,CA:true" \
  -addext "extendedKeyUsage=serverAuth" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
cp tests/fixtures/media/wide.png "$tmp/"
cp tests/fixtures/media/wide.png "$tmp/flaky.png"
python3 - "$tmp" <<'PY' &
import functools, http.server, ssl, sys
root = sys.argv[1]
flaky = 0

class Handler(http.server.SimpleHTTPRequestHandler):
    # flaky.png fails its second request, the viewer's, so the viewer must
    # offer to try again. Nothing may be cached, or a request never comes.
    def do_GET(self):
        global flaky
        if self.path == "/flaky.png":
            flaky += 1
            if flaky == 2:
                return self.send_error(404)
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

server = http.server.HTTPServer(("127.0.0.1", 8765), functools.partial(Handler, directory=root))
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(f"{root}/cert.pem", f"{root}/key.pem")
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
PY
server=$!
xcrun simctl keychain "$device" add-root-cert "$tmp/cert.pem"

TEST_RUNNER_MARKDOWN_IMAGE_URL=https://127.0.0.1:8765/wide.png \
  xcodebuild test -project nuphos-ios.xcodeproj -scheme nuphos-ios -destination "id=$device" \
  -only-testing:nuphos-iosUITests/MarkdownImageUITests -parallel-testing-enabled NO -quiet
echo "Markdown image viewer passed"
