# Server-side deploy (mao.xihale.top)

Deploy without a GitHub Actions runner: GitHub sends a **push webhook** to
`https://mao.xihale.top/hooks/mao-deploy`; Caddy proxies that path to a systemd
**socket-activated** receiver (`webhook.mjs`) that verifies the GitHub
HMAC-SHA256 signature and runs `deploy.sh`. Nothing runs while idle — a
receiver process exists only for the seconds a request (or deploy) takes.

A deploy is fetch → CI gate (`bun run check`) → `bun run build` (astro +
pagefind) → rsync. The epub (`bun run build:epub`) is a local-only artifact
and is not part of the web deploy.

## Pieces (all on zzy_hk)

| what | where |
| --- | --- |
| persistent clone | `/home/mao-ci/mao` |
| webhook secret | `/home/mao-ci/.webhook-secret` (0600, mao-ci; same value as the GitHub hook) |
| deploy log | `/home/mao-ci/deploy.log` |
| receiver | `scripts/server/webhook.mjs` (from the clone) |
| deploy job | `scripts/server/deploy.sh` (from the clone) |
| socket | `/run/mao-deploy.sock` (mao-ci:caddy 0660) |
| published site | `/srv/mao` (Caddy serves it) |
| retired assets | `/home/mao-ci/mao-attic` (hashed `_astro/`, ~32d) |

The account (`mao-ci`, uid 1502) is password-locked, has no sudo, and can
write only its home and `/srv/mao`.

## Units

`/etc/systemd/system/mao-deploy.socket`:

```ini
[Unit]
Description=mao deploy webhook (socket-activated)

[Socket]
# Accept=yes → template service (mao-deploy@.service), one instance per
# connection with the accepted socket as fd 0/1 (inetd-style).
Accept=yes
ListenStream=/run/mao-deploy.sock
SocketUser=mao-ci
SocketGroup=caddy
SocketMode=0660
RemoveOnStop=true

[Install]
WantedBy=sockets.target
```

`/etc/systemd/system/mao-deploy@.service` (template: one instance per
connection, `Accept=yes` passes the connection as fd 0/1):

```ini
[Unit]
Description=mao webhook %i
Requires=mao-deploy.socket

[Service]
User=mao-ci
Group=mao-ci
Type=oneshot
StandardInput=socket
StandardOutput=socket
StandardError=journal
ExecStart=/usr/local/bin/node /home/mao-ci/mao/scripts/server/webhook.mjs
Environment=HOME=/home/mao-ci
TimeoutStartSec=15min
# Be a good neighbor on a shared box
Nice=5
IOSchedulingClass=best-effort
IOSchedulingPriority=6
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/mao-ci /srv/mao
```

Enable once (root): `systemctl daemon-reload && systemctl enable --now mao-deploy.socket`

## Caddy

The `mao.xihale.top` site block (security headers used to live in
`public/_headers`, the Cloudflare Pages legacy — Caddy actually applies them):

```caddyfile
mao.xihale.top {
	encode zstd gzip
	root * /srv/mao
	@deployhook {
		path /hooks/mao-deploy
		method POST
	}
	@nocache {
		path /pagefind/* /rss.xml /deploy-meta.json
	}
	@short {
		path */ *.html
	}
	route {
		reverse_proxy @deployhook unix//run/mao-deploy.sock
		header {
			X-Content-Type-Options "nosniff"
			Referrer-Policy "strict-origin-when-cross-origin"
		}
		header /_astro/* Cache-Control "public, max-age=31536000, immutable"
		header @short Cache-Control "public, max-age=2592000"
		header @nocache Cache-Control "no-cache"
		file_server {
			precompressed gzip
		}
	}
}
```

Cache policy (aggressive; integrity is guaranteed by the attic, see below):

- `_astro/*` are content-hashed (Vite, incl. the subset woff2) → immutable 1y.
- HTML shells → `max-age=30d`: repeat visits cost zero requests. New content
  reaches a given browser only after its cached shell expires (or a hard
  refresh) — the trade this site deliberately makes.
- `/pagefind/*` loads at search time (never pinned by HTML) and `rss.xml`
  should reach readers fast → no-cache.
- `deploy-meta.json` is the live-sha probe → no-cache.

**Invariant**: the shell TTL (30d, Caddy `@short`) must stay below the attic
retention (32d, `-mtime +31` in deploy.sh) — a cached shell may reference
hashed assets for up to TTL after they retire, and the attic keeps them
served. Three values move together: Caddy `@short`, attic `-mtime`, and this
note.

## GitHub webhook (one-time)

The API needs `url` inside a `config` object (`gh api -f url=…` flattens it to
the top level and gets a 422):

```sh
SECRET=$(ssh zzy_hk 'cat /home/mao-ci/.webhook-secret')
printf '{"name":"web","active":true,"events":["push"],"config":{"url":"https://mao.xihale.top/hooks/mao-deploy","content_type":"json","secret":"%s"}}' "$SECRET" \
  | gh api -X POST repos/xihale/mao/hooks --input -
```

## Ops

```sh
ssh zzy_hk
tail -f /home/mao-ci/deploy.log                   # deploy output
journalctl -t mao-deploy@ -e                      # receiver lifecycle (start/exit)
curl -s https://mao.xihale.top/deploy-meta.json   # what sha is live
# manual deploy:
sudo -u mao-ci bash /home/mao-ci/mao/scripts/server/deploy.sh
```

Rollback = `git checkout <old-sha>` in the clone and re-run deploy.sh.
