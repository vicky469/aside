# Experimental Features

Experimental features are intended for testers. They may change or be removed without notice and can require additional local tools or service configuration.

## At a Glance

| Feature | Availability | What it does |
| --- | --- | --- |
| [Cloudflare Pages Publishing](#cloudflare-pages-publishing) | Desktop Obsidian | Publishes Markdown, HTML, and PDF content from the vault's `public/` folder. |

----
## Cloudflare Pages Publishing

On desktop Obsidian, Aside can publish Markdown, HTML, and PDF files from the vault-relative `public/` folder to an existing Cloudflare Pages project.

### Network and Data Access

Publishing runs the user's local Wrangler CLI against the Cloudflare Pages project selected by the user. Publishing traverses only the configured `public/` folder.

If the user enables a remote HTTPS cache-purge broker, Aside sends the configured public URL, vault-relative source path, and purge event to that endpoint after unpublish or republish. Aside does not operate this service.

### Setup

1. Install Wrangler so `wrangler --version` works in Terminal.
2. Run `wrangler login` with the Cloudflare account that owns the Pages project.
3. Create or choose a Cloudflare Pages project.
4. Open Obsidian Developer Tools and run this in the Console to reveal the hidden publishing settings and reload Aside:

   ```js
   localStorage.setItem(`aside.feature.publish.${app.vault.getName()}`, "true");
   await app.plugins.disablePlugin("aside");
   await app.plugins.enablePlugin("aside");
   ```

5. To hide the publishing settings again, run:

   ```js
   localStorage.setItem(`aside.feature.publish.${app.vault.getName()}`, "false");
   await app.plugins.disablePlugin("aside");
   await app.plugins.enablePlugin("aside");
   ```

   You can also edit the `aside.feature.publish.<vault name>` entry directly under Developer Tools → Application → Local Storage, then reload Aside. Aside persists an exact `true` or `false` value to that vault's plugin data when it loads.

6. If you use a custom domain, attach it to the Pages project in Cloudflare first.
7. In Aside settings, turn on Publishing and set the Publishing URL to your public Pages URL, for example `https://publish.example.com`.
8. Put publishable Markdown, HTML, and PDF files under `public/`. Aside creates `public/` when Publishing is enabled if it does not already exist.

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
