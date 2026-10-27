#!/bin/bash
set -euo pipefail
umask 077
mkdir -p /data/configdb
if [ ! -s /data/configdb/nuphos-keyfile ]; then
  head -c 48 /dev/urandom | base64 > /data/configdb/nuphos-keyfile
fi
chown mongodb:mongodb /data/configdb/nuphos-keyfile
chmod 400 /data/configdb/nuphos-keyfile
/usr/local/bin/docker-entrypoint.sh mongod --ipv6 --replSet rs0 --keyFile /data/configdb/nuphos-keyfile --bind_ip_all &
pid=$!
trap 'kill -TERM "$pid"; wait "$pid"' TERM INT
for attempt in $(seq 1 120); do
  kill -0 "$pid" || exit 1
  if mongosh 'mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000' --quiet --eval '
    const admin = db.getSiblingDB("admin");
    if (!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) quit(1);
    try { rs.status(); } catch (e) {
      if (e.code !== 94) throw e;
      rs.initiate({_id:"rs0",members:[{_id:0,host:process.env.NUPHOS_MONGO_HOST+":27017"}]});
    }
    quit(db.hello().isWritablePrimary ? 0 : 1);
  ' >/dev/null 2>&1; then
    wait "$pid"
    exit $?
  fi
  sleep 2
done
echo 'Mongo replica set initialization timed out' >&2
kill -TERM "$pid"
wait "$pid"
exit 1
