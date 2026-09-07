# Advanced Features

Scripts and Publishing are optional advanced capabilities and are off by default for a clean experience. They can require additional local tools, trusted code, or service configuration.

In Aside settings, the sections appear in this order: **Sidebar tabs → Scripts (advanced) → Publishing (advanced) → Index note**.

## At a Glance

| Feature | Availability | What it does |
| --- | --- | --- |
| [Agents and Scripts](SCRIPTS.md) | Desktop Obsidian; Scripts off by default | Gets replies from supported local agent CLIs and optionally runs trusted vault scripts from side notes. |
| [Cloudflare Pages Publishing](#cloudflare-pages-publishing) | Desktop Obsidian; off by default | Publishes Markdown, HTML, and PDF content from the vault's `public/` folder. |

## Agents and Scripts

Ordinary agent replies do not require Scripts. To create or run trusted local slash and script commands, turn on **Settings → Aside → Scripts (advanced) → Enable scripts**, then choose the default local agent in the same section.

Turning Scripts off blocks new slash and script command execution and script-oriented Generate actions. It does not delete registered scripts, history, or saved replies. Disabled script-like text remains ordinary note or agent text. The toggle is not a sandbox or security boundary.

See [Agents and Scripts](SCRIPTS.md) for agent setup, commands, privacy boundaries, and script registration rules.

Vault scripts are not sandboxed. They run in local Node with your account permissions and inherited environment. Review every script and run only code you wrote or trust.

## Cloudflare Pages Publishing

On desktop Obsidian, Aside can publish Markdown, HTML, and PDF files from the vault-relative `public/` folder to an existing Cloudflare Pages project. To use it, turn on **Settings → Aside → Publishing (advanced) → Enable publishing**.

Turning Publishing off hides Publishing settings details and disables new Publish, Republish, and Unpublish actions. It preserves saved publishing configuration—it does not delete it—and does not unpublish existing remote content.

### Network and Data Access

Publishing runs the user's local Wrangler CLI against the Cloudflare Pages project selected by the user. Publishing traverses only the configured `public/` folder.

If the user enables a remote HTTPS cache-purge broker, Aside sends the configured public URL, vault-relative source path, and purge event to that endpoint after unpublish or republish. Aside does not operate this service.

### Setup

1. Install Wrangler so `wrangler --version` works in Terminal.
2. Run `wrangler login` with the Cloudflare account that owns the Pages project.
3. Create or choose a Cloudflare Pages project.
4. Turn on **Settings → Aside → Publishing (advanced) → Enable publishing**, and set the Publishing URL to your public Pages URL, for example `https://publish.example.com`.
5. If you use a custom domain, attach it to the Pages project in Cloudflare first.
6. Put publishable Markdown, HTML, and PDF files under `public/`. Aside creates `public/` when Publishing is enabled if it does not already exist.

### Optional Cache Invalidation

For immediate unpublish cache invalidation on a custom domain:

1. Deploy a compatible remote cache-purge broker outside the public plugin repository after setting `ALLOWED_HOSTS` to your publishing hostname. Aside's reference broker source is maintained separately from this marketplace plugin source archive.
2. Store `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `BROKER_AUTH_SECRET` as Worker secrets. The API token needs Cloudflare's Cache Purge permission for that zone.
3. In Aside settings, enter the deployed broker's `/purge` URL and select an Obsidian SecretStorage entry containing the same broker auth secret.

Remote purge does not support `*.pages.dev`; use a custom domain in a Cloudflare zone you control.

### Publishing Workflow

| Action | How it works |
| --- | --- |
| Publish Markdown | Put the `.md` file under `public/`, open it, then click `Publish Markdown` in the pane header. |
| Publish HTML | Put the `.html` file under `public/`, open it, then click `Publish HTML` in the pane header. If it is generated from Markdown, keep the source `.md` under `public/` too. |
| Publish PDF | Put the `.pdf` file under `public/`, open it, then click `Publish PDF` in the pane header. |
| Republish content | Open the published file under `public/`, then click the matching `Republish Markdown`, `Republish HTML`, or `Republish PDF` action. |
| Unpublish content | Open the published file under `public/`, then click the matching `Unpublish Markdown`, `Unpublish HTML`, or `Unpublish PDF` action. |
| Open published content | Open the published file under `public/`, then click the matching `Open published Markdown`, `Open published HTML`, or `Open published PDF` action. |
