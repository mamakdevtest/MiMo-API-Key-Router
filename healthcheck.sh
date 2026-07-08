#!/bin/sh
set -e
curl -fsS http://localhost:4000/health || exit 1
