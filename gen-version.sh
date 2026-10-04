#!/usr/bin/env sh
# Regenerates version.json from git so the home page shows real,
# traceable "last updated / version" values instead of hand-edited ones.
#
# Install as a pre-commit hook so it runs on every commit:
#   ln -s ../../.githooks/pre-commit .git/hooks/pre-commit
set -eu

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

updated="$(git log -1 --format=%cs 2>/dev/null || echo unknown)"
version="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

cat > version.json <<EOF
{
  "updated": "$updated",
  "version": "$version"
}
EOF

echo "version.json -> updated=$updated version=$version"
