#!/bin/sh
# Daily logical backup of the LibreChat database: mongodump at DUMP_AT (UTC, default 01:30) to
# /data/dump/librechat-<weekday>.archive.gz on the app volume, so 7 dumps are kept. Velero copies
# the volume off-site at 03:00, so the off-site copy holds a consistent dump (the raw mongod files
# are copied too, but a hot copy of them is not guaranteed to be consistent).
# Restore: mongorestore --uri "$MONGO_URI" --gzip --archive=<file> --drop
set -eu
: "${MONGO_URI:?MONGO_URI is not set}"
DUMP_AT="${DUMP_AT:-01:30}"
mkdir -p /data/dump
echo "dump-loop: daily mongodump at ${DUMP_AT} UTC into /data/dump"
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today ${DUMP_AT}" +%s)
  [ "$next" -gt "$now" ] || next=$(date -u -d "tomorrow ${DUMP_AT}" +%s)
  sleep $((next - now))
  out="/data/dump/librechat-$(date -u +%a).archive.gz"
  if mongodump --uri="$MONGO_URI" --gzip --archive="$out.tmp" --quiet; then
    mv "$out.tmp" "$out"
    echo "dump-loop: $(date -u +%FT%TZ) wrote $out ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.tmp"
    echo "dump-loop: $(date -u +%FT%TZ) mongodump FAILED" >&2
  fi
done
