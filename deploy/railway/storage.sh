#!/bin/sh
set -eu
rm -f /tmp/buckets-ready
/entrypoint.sh rustfs &
pid=$!
trap 'kill -TERM $pid' TERM INT
until curl -fsS http://127.0.0.1:9000/health >/dev/null 2>&1; do
  kill -0 $pid 2>/dev/null || { echo "rustfs exited before becoming healthy" >&2; exit 1; }
  sleep 1
done
# /health answers before the S3 API does, so 5xx and refused connections are retried.
for bucket in $BUCKETS; do
  waited=0
  while :; do
    status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
      --aws-sigv4 'aws:amz:us-east-1:s3' --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" \
      "$S3_ENDPOINT/$bucket" || true)
    case "$status" in
      200|409) echo "bucket $bucket ready"; break ;;
      000|5??)
        kill -0 $pid 2>/dev/null || { echo "rustfs exited while creating buckets" >&2; exit 1; }
        if [ "$waited" -ge 60 ]; then
          echo "bucket $bucket: HTTP $status after ${waited}s" >&2; kill -TERM $pid; exit 1
        fi
        delay=$((waited < 8 ? 1 : 4))
        sleep "$delay"
        waited=$((waited + delay)) ;;
      *) echo "bucket $bucket: HTTP $status" >&2; kill -TERM $pid; exit 1 ;;
    esac
  done
done
touch /tmp/buckets-ready
wait $pid
