#!/bin/sh
set -e
curl -fsS http://localhost:${PORT:-4000}/health || exit 1
