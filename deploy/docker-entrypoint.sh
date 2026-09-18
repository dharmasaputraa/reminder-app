#!/bin/sh
# Container starts as root only long enough to fix ownership of a possibly
# root-owned bind-mounted data dir, then drops to the unprivileged app user
# for the server process (same pattern as the official redis/postgres images).
# If the container is started with --user, the chown is skipped entirely.
set -e

if [ "$(id -u)" = "0" ]; then
    mkdir -p "${DATA_DIR:-/data}"
    chown -R app:app "${DATA_DIR:-/data}"
    exec su-exec app:app "$@"
fi

exec "$@"
