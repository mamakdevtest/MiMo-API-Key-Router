#!/bin/sh
set -eu

# Named and bind volumes replace the image's /data directory when the
# container starts. They are commonly root-owned, so fix ownership before
# dropping privileges to the application user. /app/data also keeps a relative
# DATABASE_URL (file:./data/...) writable for an accidental local override.
for data_dir in /data /app/data; do
  mkdir -p "$data_dir"
  chown -R router:nodejs "$data_dir"
done

# New installations use the neutral API Router file name. Existing volumes
# keep their historical database path so a rebrand deployment retains all
# SQLite state, including provider credentials and request history.
if [ "${DATABASE_URL:-}" = "file:/data/api-router.sqlite" ] && [ ! -e /data/api-router.sqlite ] && [ -e /data/mimo-router.sqlite ]; then
  export DATABASE_URL=file:/data/mimo-router.sqlite
  echo "Using the existing persistent database path." >&2
fi

exec su-exec router:nodejs "$@"
