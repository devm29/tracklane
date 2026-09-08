#!/usr/bin/env bash
# Runs MongoDB (single-node replica set, needed for transactions and change
# streams) and Redis locally without Docker. Data lives in .data/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data"
MONGO_PORT="${MONGO_PORT:-27110}"
REDIS_PORT="${REDIS_PORT:-6410}"

mongo_eval() {
  mongosh --port "$MONGO_PORT" --quiet --eval "$1"
}

wait_for() {
  local description="$1" check="$2"
  for _ in $(seq 1 60); do
    if eval "$check" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "Timed out waiting for $description" >&2
  exit 1
}

start() {
  mkdir -p "$DATA/mongo" "$DATA/redis" "$DATA/logs"

  if ! mongo_eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1; then
    mongod --replSet rs0 --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
      --dbpath "$DATA/mongo" --logpath "$DATA/logs/mongod.log" \
      --pidfilepath "$DATA/mongod.pid" --fork >/dev/null
  fi
  wait_for "mongod" "mongo_eval 'db.runCommand({ ping: 1 }).ok'"
  mongo_eval "try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:$MONGO_PORT' }] }).ok }" >/dev/null
  wait_for "replica set primary" "mongo_eval 'if (!db.hello().isWritablePrimary) quit(1)'"
  echo "mongo  ready on 127.0.0.1:$MONGO_PORT (replica set rs0)"

  if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$DATA/redis" \
      --logfile "$DATA/logs/redis.log" --pidfile "$DATA/redis.pid" \
      --save "" --appendonly no --daemonize yes
  fi
  wait_for "redis" "redis-cli -p $REDIS_PORT ping"
  echo "redis  ready on 127.0.0.1:$REDIS_PORT"
}

stop() {
  mongo_eval 'db.getSiblingDB("admin").shutdownServer()' >/dev/null 2>&1 || true
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
  echo "stopped mongo and redis"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop" >&2; exit 1 ;;
esac
