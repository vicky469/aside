# TODO: Cloudflare Tunnel Bridge Access Model

Related docs:

- [README-dev.md](../../README-dev.md)
- [agent-dgx-spark-bridge-spec.md](../prd/agent-dgx-spark-bridge-spec.md)
- [mobile-to-dgx-codex-bridge-spec.md](../prd/mobile-to-dgx-codex-bridge-spec.md)

## Why This Note Exists

I need a short current-state reference for how the DGX bridge behaves when it is published through Cloudflare Tunnel instead of direct public Caddy hosting.

The practical question is:

1. Can other people use the bridge if they only configure the remote bridge base URL and remote bridge token?
2. Do they need to be on the same VPN?
3. What trust and quota model does the current implementation actually enforce?

## Current Deployment Shape

Current recommended deployment for this environment:

1. SideNote2 DGX bridge listens locally on `127.0.0.1:4215` over HTTP.
2. Cloudflare Tunnel publishes `https://bridge.vickyli.xyz`.
3. SideNote2 clients connect to the public HTTPS hostname.
4. Cloudflare forwards traffic to the local bridge origin.

Important origin detail:

- Cloudflare Tunnel should point to `http://127.0.0.1:4215`
- not `https://127.0.0.1:4215`

The bridge itself is plain HTTP in the current host setup.
Cloudflare provides the public HTTPS edge.

## What Other Users Need

Other users do not need:

- the same Surfshark VPN account
- the same VPN exit IP
- direct network reachability to the DGX host

Other users only need:

1. `Remote bridge base URL`
   `https://bridge.vickyli.xyz`
2. `Remote bridge token`
   the shared bearer token configured on the bridge host

If DNS is propagated and the tunnel is healthy, any SideNote2 client with those two settings should be able to reach the bridge from outside the local network.

## Current Auth Model

Current bridge auth is token-only.

Requests are accepted when:

- the client sends `Authorization: Bearer <token>`
- the token matches `SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN`

There is currently no additional per-user identity layer.

That means:

- anyone who has the token can use the bridge
- the bridge does not distinguish one human user from another
- the token should be treated as a shared secret with real access value

## Current Allowance Model

The free allowance is currently keyed to the bridge token, not to a user account.

Implications:

- all users sharing one token also share one daily allowance bucket
- one heavy user can exhaust the allowance for everyone else using that token
- the bridge currently behaves like a small trusted-group service, not a public multi-user service

## Recommendation Boundary

Current recommendation:

- acceptable for a small trusted set of users
- not appropriate for public or broad distribution with one shared token

Why:

- shared auth secret
- shared allowance bucket
- no per-user revocation
- no per-user audit identity
- bridge runs against the server-side DGX workspace context

## Operational Guidance

If this bridge is shared with trusted users:

1. Distribute the token out-of-band.
2. Rotate the token if it leaks or a user should lose access.
3. Expect the daily quota to be shared across all users on that token.
4. Treat the bridge as private infrastructure, not an anonymous public endpoint.

## Future Work

If this path should support broader multi-user use later, likely requirements are:

1. per-user identity instead of only a shared bridge token
2. per-user or per-device allowance accounting
3. cleaner token rotation and revocation workflow
4. explicit documentation for Cloudflare Tunnel as a supported deployment path
