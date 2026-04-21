# bridge.vickyli.xyz via Caddy

This host currently reports public IP `92.119.177.24`.
For `bridge.vickyli.xyz` to reach this DGX, update DNS so that hostname points here instead of the current Vercel-side records.

## Repo-side bridge config

The local bridge env is configured for reverse proxy mode:

- `SIDENOTE2_DGX_BIND_HOST=127.0.0.1`
- `SIDENOTE2_DGX_PORT=4215`
- `SIDENOTE2_DGX_PUBLIC_BASE_URL=https://bridge.vickyli.xyz`

That keeps the Node bridge private on localhost and lets Caddy own HTTPS.

## Required host steps

1. Point `bridge.vickyli.xyz` DNS at this host's reachable public IP.
2. Install Caddy on the DGX host.
3. Place `ops/caddy/bridge.vickyli.xyz.Caddyfile` into the active Caddy config.
4. Place `ops/systemd/sidenote2-dgx-bridge.service` into `/etc/systemd/system/`.
5. Start and enable both services.
6. Make sure inbound TCP `80` and `443` are allowed.

## Suggested commands

```bash
sudo apt-get update
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy

sudo cp ops/caddy/bridge.vickyli.xyz.Caddyfile /etc/caddy/Caddyfile
sudo cp ops/systemd/sidenote2-dgx-bridge.service /etc/systemd/system/sidenote2-dgx-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now sidenote2-dgx-bridge.service
sudo systemctl reload caddy
```

## Validation

After DNS is updated and Caddy is live:

```bash
curl -I https://bridge.vickyli.xyz/healthz
curl -H "Authorization: Bearer <token>" https://bridge.vickyli.xyz/healthz
```

The first request is a quick TLS and reachability probe and should return `200`.
The second is optional and returns the JSON health payload.
