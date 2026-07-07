#!/bin/sh
set -e
curl -fsS http://localhost:3000/health || exit 1
