#!/usr/bin/env bash
# Server-side deploy job for mao.xihale.top on jp2 — dispatched by the shared
# webhook receiver (adnanh/webhook → sudo whitelist → /usr/local/lib/webhook-deploy;
# see scripts/server/README.md), or manually: ssh jp2, then
# `sudo -u mao-ci bash ~/mao/scripts/server/deploy.sh`.
#
#   1. shallow-fetch master into the persistent clone
#   2. CI gate (astro check + tsc + eslint) — a failing check keeps the old
#      site live
#   3. bun install + astro build + pagefind index
#   4. pre-gzip text, rsync to /srv/mao (Caddy serves it); hashed _astro/
#      retires into ~/mao-attic for ~32d (outlives the 30d shell TTL)
set -Eeuo pipefail
umask 022

# The receiver hops through sudo, which resets the environment (secure_path
# has no ~/.bun/bin) — pin the toolchain path here instead of relying on it.
export PATH="$HOME/.bun/bin:$PATH"

REF="${1:-refs/heads/master}"
BRANCH="${REF#refs/heads/}"
REPO=/home/mao-ci/mao
DEST=/srv/mao
LOCK=/home/mao-ci/.deploy.lock
RERUN=/home/mao-ci/.deploy-rerun

say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { say "FATAL: $*"; exit 1; }

cd "$REPO"

# One deploy at a time; a push that lands mid-deploy queues exactly one rerun
# (latest commit wins — the queued rerun fetches the newest sha anyway).
exec 9>"$LOCK"
if ! flock -n 9; then
  touch "$RERUN"
  say "deploy already running — queued one rerun"
  exit 0
fi

say "=== deploy start (${BRANCH}, sha=${MAO_PUSH_SHA:-unknown}) ==="

# Snapshot the running script BEFORE the fetch: bash keeps executing the old
# inode across the checkout, but $0 is just a path and resolves to the new
# file afterwards — path-to-path comparison can never detect the change.
SELF_SNAP=$(mktemp)
cat "$0" > "$SELF_SNAP"

git fetch --depth=1 origin "$BRANCH"
git checkout -q -B "$BRANCH" FETCH_HEAD
# untracked caches (node_modules, dist, .astro) survive on purpose

# We were spawned from the pre-fetch checkout; if deploy.sh itself changed,
# re-exec so the new revision's logic publishes this push. After the re-exec
# the snapshot equals the file, so this fires at most once.
if ! cmp -s "$SELF_SNAP" "$REPO/scripts/server/deploy.sh"; then
  rm -f "$SELF_SNAP"
  say "deploy.sh changed in ${BRANCH} — re-execing from new checkout"
  exec /bin/bash "$REPO/scripts/server/deploy.sh" "$@"
fi
rm -f "$SELF_SNAP"

# --- CI gate (same checks as `bun run check` locally) ------------------------
bun install --frozen-lockfile
bun run check

# --- build + publish ---------------------------------------------------------
# build:epub is a local-only artifact (bun run src/scripts/epub.ts) and is
# deliberately not part of the web deploy.
bun run build
find dist -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.xml' -o -name '*.json' -o -name '*.svg' -o -name '*.txt' \) -exec gzip -k9 {} +

printf '{"sha":"%s","branch":"%s","deployedAt":"%s"}\n' \
  "$(git rev-parse HEAD)" "$BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > dist/deploy-meta.json

# HTML/feeds replace wholesale. Hashed _astro/ retires into a timestamped
# attic instead of being deleted: a shell cached for 30d may still reference
# it (max-age lives in the Caddy block — keep TTL < retention when changing
# either side). Attic dirs are pruned by their own age, i.e. measured from
# retirement, independent of deploy cadence. $HOME (not /srv) — the web-served
# tree stays lean and /srv/mao is the only writable web path.
ATTIC="$HOME/mao-attic"
mkdir -p "$ATTIC"
rsync -a --delete --delay-updates --exclude=/_astro \
  --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  dist/ "$DEST/"
# --checksum: dist mtimes are always fresh, so quick-check would rewrite (and
# thus --backup) every file each deploy; content comparison makes the attic
# hold only genuinely retired assets.
rsync -a --delete --checksum --backup --backup-dir="$ATTIC/$(date -u +%Y%m%dT%H%M%S)" \
  --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  dist/_astro/ "$DEST/_astro/"
# GNU find rounds age up: +31 = 32 full days = 30d shell TTL + 2d margin.
find "$ATTIC" -mindepth 1 -maxdepth 1 -type d -mtime +31 -exec rm -rf {} +
say "published $(git rev-parse --short HEAD) → $DEST (attic: $(du -sh "$ATTIC" 2>/dev/null | cut -f1))"

say "=== deploy done ==="
if [ -e "$RERUN" ]; then
  rm -f "$RERUN"
  say "a newer push arrived during this deploy — running again"
  exec /bin/bash "$0" "$REF"
fi
