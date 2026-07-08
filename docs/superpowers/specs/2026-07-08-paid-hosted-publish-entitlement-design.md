# Paid Hosted Publish Entitlement Design

## Status

Future option. This spec records a possible paid hosted `@publish` product direction. It is not approved for implementation, release, or pricing launch.

## Implementation Tracking

Use this section as the working checklist. Mark an item done only after the code is merged or the documented change is complete and the listed verification passes.

### Already Done

- [x] Existing local `@publish` design uses user-owned Cloudflare/Wrangler credentials instead of storing Cloudflare secrets in Aside.
- [x] Obsidian community plugins can make network requests, but Obsidian does not expose a public signed-in Obsidian account identity to community plugins.
- [x] Obsidian provides `requestUrl` for plugin HTTP requests and `SecretStorage` for storing sensitive tokens without placing the raw value in plugin `data.json`.
- [x] InstantDB supports app auth, Google OAuth, permissions, and a server-side Admin SDK for sensitive backend writes.

### To Implement

- [ ] Create a hosted Aside account and entitlement service with Google login and WeChat login.
- [ ] Add PayPal subscription checkout and webhook handling for automatic paid entitlement activation.
- [ ] Add WeChat payment support as a manual approval flow unless WeChat Pay merchant API access is ready.
- [ ] Add InstantDB schema, permissions, and admin-only mutation paths for accounts, subscriptions, licenses, device activations, and payment events.
- [ ] Add a payment/account dashboard that shows subscription status, license key, linked devices, and payment actions.
- [ ] Add an Aside settings section for pasting, storing, and validating a hosted publish license key through Obsidian `SecretStorage`.
- [ ] Generate and persist a random plugin install/device ID, then activate it against the hosted entitlement service.
- [ ] Add hosted publish runtime behavior that only runs when an active entitlement exists and never silently spends operator resources for unpaid users.
- [ ] Add privacy, security, README, and marketplace disclosure for external network services and data sent.

### Verification

- [ ] Unit tests cover license-key normalization, install ID generation, entitlement cache handling, and disabled/unlicensed notices.
- [ ] Integration tests cover license activation, device-limit enforcement, deactivation, expiry, revoked license handling, and offline stale-cache behavior.
- [ ] Backend tests cover PayPal webhook signature validation, idempotent subscription updates, WeChat manual approval, and admin-only InstantDB writes.
- [ ] Permission tests prove InstantDB client-side rules do not expose other users' accounts, payments, licenses, or devices.
- [ ] Security review confirms no InstantDB admin token, PayPal secret, WeChat secret, or hosted publish credential ships in the Obsidian plugin.
- [ ] Manual desktop and mobile Obsidian tests confirm paid hosted `@publish` works without local Wrangler.
- [ ] Release artifact inspection confirms `main.js`, `manifest.json`, and `styles.css` do not include secrets, source maps, raw TypeScript, or source-map references.

## Context

Aside already has a local `@publish` direction where users configure their own Cloudflare Pages project and local Wrangler login. That model is good for technical users and keeps Cloudflare credentials out of the plugin.

The possible future product is a paid hosted publish path for users who do not have Cloudflare credentials or do not want to configure publishing infrastructure. The intended price point is:

- China-facing monthly plan: 20 RMB/month.
- International monthly plan: 4 USD/month.

Payment should support PayPal and WeChat. The first practical shape is:

- PayPal subscription payments activate automatically through webhooks.
- WeChat payments start as a manual confirmation flow unless full WeChat Pay merchant API access is ready.
- Users log into the payment page with Google or WeChat so payment, subscription, and license records belong to a durable Aside account.

Obsidian does not provide community plugins with a reliable Obsidian account identity, so Aside must create its own account, license, and device-linking model.

## Goals

- Preserve free or user-owned local `@publish` for users who bring their own Cloudflare settings and credentials.
- Offer a paid hosted publish path for users who do not have valid local publish settings.
- Require explicit user payment or active license before using operator-owned publish resources.
- Support multiple Obsidian devices per subscription.
- Keep account/payment logic on a hosted service, not inside the Obsidian plugin.
- Use InstantDB as the account, license, and entitlement database if this product is built.
- Keep the Obsidian plugin's network surface narrow and easy to disclose.
- Avoid sending vault contents, filenames, note paths, or side-note bodies to the entitlement service during license checks.

## Non-Goals

- Do not implement this as part of the current local `@publish` rollout.
- Do not remove or paywall the bring-your-own Cloudflare/Wrangler path.
- Do not use Obsidian account identity; it is not available through the public community plugin API.
- Do not put InstantDB admin tokens, PayPal secrets, WeChat secrets, Cloudflare API tokens, or hosted publish credentials in the plugin bundle or plugin data.
- Do not use hardware fingerprinting. Device identity is a random plugin-generated install ID.
- Do not upload vault content during license activation or entitlement refresh.
- Do not build full automatic WeChat Pay in the first version unless merchant API access, webhook verification, and compliance are ready.
- Do not allow direct client writes to payment, license, subscription, or entitlement records.

## Product Model

There are two publish modes:

1. Bring-your-own local publish.
   - User configures Cloudflare Pages project, base URL, allowed publish folder, and local Wrangler auth.
   - Aside publishes through the user's local machine and user's Cloudflare account.
   - This mode remains free and explicit.

2. Aside hosted publish.
   - User pays for a hosted entitlement.
   - Aside validates the pasted license key and activates the current plugin install ID.
   - Aside uses a hosted publish service owned by the operator.
   - This mode may work on both desktop and mobile because it does not depend on local Wrangler.

The plugin must never silently fall back from failed local publish to hosted publish unless the user has an active hosted entitlement and the UI/message makes the runtime ownership clear.

## User Identity

The payment site owns user identity. Supported login providers for this product direction:

- Google login.
- WeChat login.

The canonical account is an Aside account ID created by the hosted service. Provider identities link into that account:

```text
Google subject or WeChat openid/unionid -> Aside account -> subscriptions -> licenses -> device activations
```

If both Google and WeChat login are supported, the dashboard should let the user link both providers to the same Aside account after proving control of each provider account. The service must avoid accidentally creating two paid accounts for one user who first pays through Google and later logs in through WeChat.

## License And Device Model

The payment dashboard issues a reusable license key such as:

```text
ASIDE-PUB-XXXX-XXXX-XXXX
```

The key represents subscription access for one Aside account. It is not a device ID.

The Obsidian plugin creates one random install ID per plugin installation:

```text
asideInstallId = crypto-random UUID or equivalent random ID
```

Rules:

- Store `asideInstallId` in plugin data because it is not a secret.
- Store the pasted license key and returned entitlement token in Obsidian `SecretStorage`, not plugin `data.json`.
- Allow multiple active devices per subscription. The initial policy should be 3 active devices per paid subscription unless pricing later requires a different limit.
- Let the user deactivate old devices from the payment dashboard.
- Let the plugin show a concise status: active, expired, revoked, over device limit, or unable to refresh.

Activation flow:

1. User logs into the payment dashboard with Google or WeChat.
2. User pays with PayPal or WeChat.
3. Dashboard displays the license key after successful or approved payment.
4. User pastes the license key into Aside settings.
5. Aside calls the entitlement service with license key, install ID, plugin version, and a user-visible device label if provided.
6. Entitlement service records or refreshes the device activation.
7. Service returns a signed entitlement response with plan, expiry, device status, and allowed capabilities.
8. Aside caches the entitlement response and enables hosted publish only while it is active.

## Payment Flows

### PayPal

PayPal is the automatic first payment path.

Flow:

1. User logs into the dashboard.
2. User selects the USD monthly plan.
3. Dashboard redirects or embeds PayPal subscription checkout.
4. PayPal returns the user to the dashboard.
5. PayPal webhook confirms subscription status.
6. Backend idempotently creates or renews the subscription and license.
7. Dashboard shows the active license key.

Webhook handling must validate PayPal signatures, deduplicate event IDs, and treat webhooks as the source of truth for paid status.

### WeChat

WeChat v1 should be manual unless full WeChat Pay merchant integration is ready.

Manual v1 flow:

1. User logs into the dashboard with Google or WeChat.
2. User selects the RMB monthly plan.
3. Dashboard shows a WeChat payment QR code or payment instructions.
4. User submits the required proof or order note inside the dashboard.
5. Admin reviews the payment and approves the subscription.
6. Backend creates or renews the license.
7. Dashboard shows the active license key.

Future automatic WeChat Pay can replace manual approval when merchant API credentials, webhook signature validation, refunds, and reconciliation are ready.

## InstantDB Usage

InstantDB may be used for account, entitlement, and operational storage. Use it behind a strict boundary:

- Payment page may use InstantDB client auth for signed-in account views.
- Backend may use InstantDB Admin SDK for sensitive writes.
- Obsidian plugin should not use the InstantDB client directly in the first version.
- Obsidian plugin should call a narrow hosted entitlement API.

Reason: the plugin only needs to validate a license and refresh entitlement status. Direct database access from the plugin adds bundle size, review surface, privacy questions, and permission risk without much benefit.

Required InstantDB namespaces:

- `accounts`: canonical Aside account records.
- `identityProviders`: Google and WeChat identities linked to an account.
- `subscriptions`: active, past_due, canceled, expired, or manual-review subscriptions.
- `paymentEvents`: PayPal webhook events and WeChat manual approval records.
- `licenses`: license keys linked to accounts and current entitlement state.
- `deviceActivations`: install IDs, device labels, activation timestamps, last seen timestamps, and revocation state.
- `entitlementAuditEvents`: admin and webhook actions that changed access.

Sensitive writes must be admin-only:

- creating or changing subscriptions
- creating licenses
- revoking licenses
- approving WeChat payments
- changing device limits
- overriding entitlement state

Client-side reads must be scoped to the authenticated user's account. Permission rules must default closed for payment, license, and device data.

WeChat login should be treated as a hosted-service identity provider. Do not assume InstantDB has a built-in WeChat provider. If InstantDB cannot handle it directly, the entitlement backend should complete WeChat OAuth and link the resulting provider identity to the canonical Aside account record.

## Hosted Entitlement API

The Obsidian plugin calls an Aside-owned API, not InstantDB directly.

Required endpoints:

```text
POST /v1/licenses/activate
POST /v1/licenses/refresh
POST /v1/licenses/deactivate-device
GET  /v1/status
```

`POST /v1/licenses/activate` request:

```json
{
  "licenseKey": "ASIDE-PUB-XXXX-XXXX-XXXX",
  "installId": "random-plugin-install-id",
  "deviceLabel": "Wenqing's MacBook",
  "pluginVersion": "2.0.86"
}
```

Successful response:

```json
{
  "status": "active",
  "accountId": "acct_...",
  "plan": "hosted_publish_monthly",
  "expiresAt": "2026-08-08T00:00:00.000Z",
  "deviceLimit": 3,
  "activeDeviceCount": 1,
  "capabilities": ["hosted_publish"],
  "entitlementToken": "signed-short-lived-token"
}
```

Failure responses must be explicit:

- invalid license
- expired subscription
- revoked license
- device limit reached
- server unavailable
- plugin version unsupported

The API must not require or accept vault contents, note paths, filenames, or side-note text for license activation.

## Plugin UX

Add a hosted publish section in Aside settings:

- License key input backed by Obsidian `SecretStorage`.
- `Activate` button.
- `Refresh status` button.
- Current status line.
- Linked device label field.
- Link to the payment/account dashboard.
- Link to device management.

When a user tries `@publish` without valid local settings:

- If hosted entitlement is active, offer or use hosted publish according to the selected publish mode.
- If hosted entitlement is inactive, show a concise message:

```text
Publish is not configured. Add your own Cloudflare settings, or activate Aside hosted publish.
```

Publish mode should be explicit:

- `Local only`: use user-owned Cloudflare/Wrangler.
- `Hosted only`: use paid Aside-hosted publishing.
- `Auto`: prefer local when valid; otherwise use hosted only if entitlement is active.

Mobile Obsidian should never attempt local Wrangler publishing. If hosted entitlement is active, mobile may use hosted publish.

## Hosted Publish Runtime

Hosted publish is separate from entitlement validation, but it depends on the entitlement result.

Minimum behavior:

1. Plugin resolves the same allowed publish target semantics as local `@publish`.
2. Plugin verifies the file is allowed and inspectable before upload.
3. Plugin sends the selected artifact to the hosted publish service only after user action and active entitlement.
4. Hosted service performs its own artifact guard before publishing.
5. Hosted service publishes to the configured hosted domain.
6. Plugin writes success or failure back into the same Aside thread.

Artifact security must be at least as strict as local publish:

- no `.obsidian/`
- no plugin data
- no source maps or source-map references
- no `.env*`, `.npmrc`, keys, certificates, or logs
- no folders or recursive upload until separately designed

The hosted service should not trust client-side inspection alone.

## Privacy And Marketplace Disclosure

The plugin must clearly disclose:

- It can contact the Aside hosted entitlement service when the user activates hosted publish.
- It sends license key, random install ID, plugin version, and optional device label for entitlement checks.
- It does not send vault contents, note text, side-note bodies, file lists, or filenames for entitlement checks.
- Hosted publish sends the selected publish artifact only when the user explicitly uses hosted `@publish`.
- InstantDB, PayPal, Google, and WeChat may be used by the external payment/account site.

README and settings copy should distinguish:

- free local/user-owned publish
- paid hosted publish
- what data each path sends
- how to revoke/deactivate devices
- how to request account or license deletion

## Security Requirements

- Keep InstantDB admin token server-side only.
- Keep PayPal and WeChat secrets server-side only.
- Keep hosted publish provider credentials server-side only.
- Validate PayPal webhooks before mutating entitlements.
- Treat WeChat manual approvals as admin actions with audit logs.
- Hash license keys at rest. If support lookup needs a visible identifier, store a short non-secret license prefix separately and never log full license keys.
- Redact license keys and entitlement tokens from support logs.
- Rate-limit license activation and refresh endpoints.
- Use signed, short-lived entitlement tokens so cached plugin state cannot grant indefinite access.
- Support server-side revocation for licenses and devices.
- Do not use remote code loading or eval in the plugin.
- Bundle all plugin dependencies into `main.js` through the existing release process.

## Failure Handling

If entitlement service is unreachable:

- Allow a short stale entitlement window only if the last verified status was active.
- The initial stale window should be no more than 72 hours.
- Show that hosted publish status could not be refreshed.
- Do not activate a new license while offline.

If a payment is canceled or disputed:

- Mark subscription inactive according to webhook or admin action.
- Let existing cached plugin entitlement expire naturally within the short stale window.
- Return revoked or expired on the next refresh.

If device limit is reached:

- Do not activate the new install ID.
- Link the user to the dashboard device-management page.

## Data Retention

Retain only data needed to operate subscriptions, licenses, support, fraud prevention, and tax/payment records.

Initial policy:

- Active account, subscription, license, and device records are retained while the account is active.
- Revoked device activation records may be retained for abuse prevention and support history.
- Raw webhook payloads should be minimized after reconciliation; retain event ID, provider, status, timestamps, and relevant subscription IDs.
- Support account deletion requests by removing or anonymizing non-payment operational data while preserving legally required payment records.

## Phased Rollout

Phase 0: parked spec.

- Keep this document as a product option.
- Do not add code or settings for paid hosted publish.

Phase 1: account and license backend.

- Build the payment/account site.
- Add Google login and WeChat login.
- Add InstantDB schema and permissions.
- Add PayPal automatic subscription handling.
- Add WeChat manual approval.
- Add dashboard license display and device management.

Phase 2: plugin entitlement activation.

- Add license-key paste and activation in Aside settings.
- Add install ID and entitlement cache.
- Add disabled/unlicensed notices.
- Do not publish hosted artifacts yet.

Phase 3: hosted publish.

- Add hosted artifact upload and server-side artifact guard.
- Add hosted publish result replies.
- Test desktop and mobile.

Phase 4: automation and polish.

- Replace manual WeChat approval with WeChat Pay API if ready.
- Add invoices, refunds, device self-service, and account deletion workflows.
- Evaluate custom domains or per-user hosted paths.

## Decision Gates Before Implementation

Before writing implementation code, decide:

- Whether this remains in the public plugin or moves to a private plugin/extension.
- Whether hosted publish is allowed in the Obsidian community marketplace build.
- Which backend runtime will host entitlement and publish APIs.
- Whether WeChat login is approved and available for the chosen domain.
- Whether WeChat Pay merchant API is available or manual approval remains the v1 payment path.
- Exact device limit for the monthly plan.
- Hosted publish domain and URL structure.
- Refund, cancellation, renewal, and support policy.

## References

- Obsidian plugin security: community plugins can connect to the internet and inherit Obsidian's access levels.
- Obsidian API: plugins can use `requestUrl`, `loadData`, `saveData`, and `SecretStorage`; the public API does not expose a signed-in Obsidian account identity.
- InstantDB docs: `appId` is safe to expose, but `adminToken` must remain server-side because admin API calls bypass permission checks.
- InstantDB permissions docs: permission rules should be explicitly defined before shipping user data.
