#!/bin/sh
# Writes .env from .env.example with fresh secrets. Never overwrites an existing .env.
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo ".env already exists; delete it first to regenerate." >&2
  exit 1
fi

hex() { openssl rand -hex 32; }

umask 077
sed \
  -e "s|^NUPHOS_JWT_SECRET=.*|NUPHOS_JWT_SECRET=$(hex)|" \
  -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(hex)|" \
  .env.example >.env
echo "Wrote $(pwd)/.env."
