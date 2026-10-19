# Server-side deploy (mao.xihale.top on jp2)

Deploy without a GitHub Actions runner: GitHub sends a **push webhook** to
`https://mao.xihale.top/hooks/mao-deploy`; Caddy proxies that path to the
**shared** systemd socket-activated receiver (`adnanh/webhook`) that verifies
the GitHub HMAC-SHA256 signature and runs `deploy.sh` through a pinned sudo
whitelist. Nothing runs while idle — the receiver process exists only between
the request and the deploy.

A deploy is fetch → CI gate (`bun run check`) → `bun run build` (astro +
pagefind) → rsync. The epub (`bun run build:epub`) is a local-only artifact and
is not part of the web deploy.

This is the gx shared-receiver pattern (`skill://vps-webhook-deploy`), with the
site-specific bits for jp2. The old per-site `webhook.mjs` receiver is gone.

## Request path

```
push → GitHub hook → Caddy @deployhook (path /hooks/mao-deploy)
     → unix /run/webhook.sock → webhook.socket (systemd socket activation)
     → webhook 2.8.3 as user `webhook`, /etc/webhook/hooks.json:
         HMAC verify + pin refs/heads/master
     → sudo -H -u mao-ci /usr/local/lib/webhook-deploy <deploy.sh> <ref> mao <sha>
         (sudoers whitelist, arguments pinned)
     → deploy.sh: fetch → check → build → rsync → ~/deploy.log
```

## Pieces (all on jp2)

| what | where |
| --- | --- |
| persistent clone | `/home/mao-ci/mao` |
| deploy user | `mao-ci` (no shell, no su; only reached via the sudo whitelist) |
| webhook secret | `/home/mao-ci/.webhook-secret` (0600 mao-ci; same value as the GitHub hook) |
| hook registry | `/etc/webhook/hooks.json` (0640 root:webhook, id `mao-deploy`) |
| sudo whitelist | `/etc/sudoers.d/webhook-deploy` |
| runner | `/usr/local/lib/webhook-deploy` (root:root 0755) |
| receiver units | `/etc/systemd/system/webhook.{socket,service}` |
| socket | `/run/webhook.sock` (webhook:caddy 0660) |
| deploy log | `/home/mao-ci/deploy.log` |
| published site | `/srv/mao` (Caddy serves it) |
| retired assets | `/home/mao-ci/mao-attic` (hashed `_astro/`, ~32d) |

Repo copies of the server assets (`scripts/server/`) are the source of truth:
`webhook-deploy`, `webhook.socket`, `webhook.service`, `hooks.json` (secret
placeholder — substitute the real one at install time), `deploy.sh`.

## Caddy

jp2 has no public `:443`: Xray REALITY owns it and steers unauthenticated TLS
to Caddy on `127.0.0.1:10443` (self-steal). So every site block binds
`127.0.0.1` and proves itself with an ACME HTTP-01 cert. Nothing else is
needed — verified 2026-10-19: `mao.xihale.top` served a valid cert while
`serverNames` still listed only `jp2.xihale.top`/`vl.jp2.xihale.top`, i.e.
REALITY forwards any non-REALITY SNI to `dest` regardless. Do **not** add the
site to `serverNames` (it changes REALITY's own accept list and needs an xray
restart that drops live sessions).

```caddyfile
(deployhook) {
	@deployhook path /hooks/mao-deploy
	reverse_proxy @deployhook unix//run/webhook.sock
}

http://mao.xihale.top, http://mao.jp2.xihale.top {
	redir https://{host}{uri} permanent
}

https://mao.xihale.top, https://mao.jp2.xihale.top {
	bind 127.0.0.1
	import deployhook
	encode zstd gzip
	root * /srv/mao
	# hashed build output: immutable; everything else revalidates so a push is
	# visible immediately (the deploy also keeps retired _astro/ for 32d).
	# NOTE: the last `header` wins per path, so each bucket needs its own
	# mutually exclusive matcher.
	@immutable path /_astro/*
	header @immutable Cache-Control "public, max-age=31536000, immutable"
	@volatile path /pagefind/* /deploy-meta.json
	header @volatile Cache-Control "no-cache"
	@rest not path /_astro/* /pagefind/* /deploy-meta.json
	header @rest Cache-Control "public, max-age=0, must-revalidate"
	# Pagefind ships its wasm without a usable extension; without this MIME
	# WebAssembly.instantiateStreaming throws and search falls back to the slow
	# non-streaming path (still works, just slower + a console warning).
	@pagefindwasm path /pagefind/wasm.*.pagefind
	header @pagefindwasm Content-Type application/wasm
	try_files {path} {path}.html {path}/index.html
	file_server {
		precompressed gzip
	}
	tls {
		issuer acme {
			disable_tlsalpn_challenge
		}
	}
}
```

HTML/feeds revalidate (`max-age=0, must-revalidate`) so a push is visible on the
next load; hashed `_astro/` is immutable for a year, and `deploy.sh` still keeps
retired `_astro/` for 32d as a safety net for a tab left open across a deploy.

## Install (repeatable)

```sh
# 1. receiver (Debian package installs webhook 2.8.3 to /usr/local/bin)
install -o root -g root -m 0755 scripts/server/webhook-deploy /usr/local/lib/webhook-deploy
install -o root -g root -m 0644 scripts/server/webhook.socket /etc/systemd/system/webhook.socket
install -o root -g root -m 0644 scripts/server/webhook.service /etc/systemd/system/webhook.service
install -d -o root -g webhook -m 0750 /etc/webhook
jq --arg s "$(cat /home/mao-ci/.webhook-secret)" \
  '.[0]["trigger-rule"].and[0].match.secret = $s' scripts/server/hooks.json \
  > /tmp/hooks.json && install -o root -g webhook -m 0640 /tmp/hooks.json /etc/webhook/hooks.json
printf '%s\n' 'webhook ALL=(mao-ci) NOPASSWD: /usr/local/lib/webhook-deploy /home/mao-ci/mao/scripts/server/deploy.sh refs/heads/master mao *' \
  > /etc/sudoers.d/webhook-deploy && chmod 0440 /etc/sudoers.d/webhook-deploy
systemctl daemon-reload && systemctl enable --now webhook.socket

# 2. GitHub hook
SECRET=$(ssh jp2 'cat /home/mao-ci/.webhook-secret')
printf '{"name":"web","active":true,"events":["push"],"config":{"url":"https://mao.xihale.top/hooks/mao-deploy","content_type":"json","secret":"%s"}}' "$SECRET" \
  | gh api -X POST repos/xihale/mao/hooks --input -
```

## Ops

```sh
ssh jp2
tail -f /home/mao-ci/deploy.log          # deploy output
journalctl -t mao-deploy@ -e             # receiver lifecycle
curl -s https://mao.xihale.top/deploy-meta.json   # what sha is live
# manual deploy:
sudo -u mao-ci bash /home/mao-ci/mao/scripts/server/deploy.sh
# back to zero resident processes:
systemctl stop webhook.service           # socket re-activates it on next push
```

Rollback = `git checkout <old-sha>` in the clone and re-run `deploy.sh`.

## Gotchas

- **Never** add `NoNewPrivileges` to `webhook.service`: it kills the sudo hop.
- Editing `/etc/webhook/hooks.json`: `jq > .new && mv` breaks `-hotreload`
  (inotify is pinned to the old inode). Edit in place or restart the service.
- No signature header → 200 "Hook rules were not satisfied" (scanners get a
  quiet no-op); wrong signature → 500; unknown hook → 404; a branch deletion
  reaches `deploy.sh` and fails loudly.
- `sudo` resets `PATH` (`secure_path` has no `~/.bun/bin`), so `deploy.sh`
  pins it itself. `bun` lives in `/home/mao-ci/.bun/bin`.
- jp2 is small (1 GB RAM + swap): the astro build peaks well under it, but
  watch `dmesg` if the site ever builds unusually large.
- `mao.xihale.top` must be **DNS-only** (grey cloud) at Cloudflare: a proxied
  record would have Cloudflare terminate TLS and dial `:443`, which is REALITY,
  not Caddy.
- The runner posts ntfy notifications only when `~/.ntfy-notify` exists (topic
  line 1, `user:pass` line 2); it is absent on jp2, so deploys are silent —
  only `~/deploy.log` records them.
