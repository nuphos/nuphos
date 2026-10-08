#!/bin/sh
set -eu
# Fresh Railway volumes are root-owned. Only initialization runs as root.
mkdir -p /home/node/workspace
chown node:node /home/node /home/node/workspace
exec setpriv --reuid=node --regid=node --init-groups --no-new-privs \
  /usr/local/bin/nuphos-runtime-start "$@"
