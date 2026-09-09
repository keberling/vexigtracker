#!/bin/sh
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/media"
# If the volume is root-owned and we somehow drop privs later, keep writable for current user
chmod -R u+rwX "$DATA_DIR" 2>/dev/null || true
exec "$@"
