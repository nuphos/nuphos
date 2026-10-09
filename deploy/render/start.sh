#!/bin/sh
set -eu
: "${MONGO_HOST:?}" "${MONGO_PASSWORD:?}" "${STORAGE_HOST:?}" "${RENDER_EXTERNAL_URL:?}"
# Blueprints cannot interpolate values; assemble the URI at startup, URL-encoding the password.
export MONGODB_URI="$(bun -e 'console.log(`mongodb://nuphos:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:27017/nuphos?authSource=admin&replicaSet=rs0&directConnection=true`)')"
export NUPHOS_AUTH_BASE_URL="$RENDER_EXTERNAL_URL"
export NUPHOS_BACKEND_URL="$RENDER_EXTERNAL_URL"
export NUPHOS_PUBLIC_BACKEND_URL="$RENDER_EXTERNAL_URL"
export NUPHOS_FILE_TRANSFER_S3_ENDPOINT="https://$STORAGE_HOST"
export ATLAS_SKILLS_S3_ENDPOINT="https://$STORAGE_HOST"
exec bun run src/index.ts
