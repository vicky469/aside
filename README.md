
<p align="center">
  <img src="./assets/logo-readme.svg" alt="Aside logo" width="72">
</p>
<p align="center">
Aside
</p>
<p align="center">
  <a href="https://github.com/vicky469/aside/releases/tag/2.0.100">
    <img src="https://img.shields.io/badge/release-2.0.100-22c55e?style=flat-square" alt="Latest release">
  </a>
  <a href="https://buymeacoffee.com/vickyli">
    <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000000" alt="Buy Me a Coffee">
  </a>
</p>
<p align="center">
  <a href="https://obsidian.md">
    <img src="https://img.shields.io/badge/Obsidian-API-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian API">
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-language-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  </a>
  <a href="https://codemirror.net/">
    <img src="https://img.shields.io/badge/CodeMirror-editor-0ea5e9?style=flat-square" alt="CodeMirror">
  </a>
  <a href="https://lezer.codemirror.net/">
    <img src="https://img.shields.io/badge/Lezer-parser-f59e0b?style=flat-square" alt="Lezer">
  </a>
</p>
<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <strong>Side note index</strong><br>
      <img src="./assets/demo.gif" alt="Aside demo preview in Obsidian dark theme" width="100%">
    </td>
    <td align="center" valign="top" width="50%">
      <strong>Agent reply</strong><br>
      <img src="./assets/demo2.gif" alt="Aside demo preview in Obsidian light theme" width="100%">
    </td>
  </tr>
</table>
Aside is a tool for thought. It helps you capture, connect, and go deeper into your knowledge. Optionally, local AI agents can assist you along the journey.
For durable storage and sync across devices, use Aside with [Obsidian Sync](https://obsidian.md/sync).

## Features

- Uses a dedicated sidebar for drafting, editing, and deleting comments.
- Adds page notes to markdown, PDF, and HTML files. Text-anchored notes work in markdown files only.
- Supports Obsidian-style `[[wikilinks]]` inside side comments to link existing notes or create new markdown notes.
- Type `#` in a side note to search existing tags or add a new one.
- Type `@todo` to mark follow-ups that appear in the Todo index tab.
- Browse, filter, and batch-apply local side-note tags from the active note sidebar.
- Generates `🐰 Aside Index.md` as a vault-wide comment index.
- Lets the index sidebar switch between the comment list and a thought-trail graph built from side-note wiki links. The graph follows those links across connected markdown files, so it can show multi-step trails instead of only direct one-hop links.
- Built-in agent help on desktop Obsidian. Type `@codex` or `@claude` in a thread to get a reply, create anchored side notes, or apply explicit edits to the source note.
- Experimental Cloudflare Pages publishing for testers on desktop Obsidian.

## Network access

Aside does not send vault contents, note paths, tags, clipboard contents, or local diagnostic logs to an Aside-operated analytics or support service. Network-capable actions are user initiated: opening an external link, invoking a local agent CLI, publishing through the user's local Wrangler installation, or requesting cache invalidation through an optional remote HTTPS broker configured by the user. Cache-purge requests send that broker the configured public URL, vault-relative source path, and purge event. The generated Aside index uses the default remote image at `ichef.bbci.co.uk` unless the user replaces or clears that image URL; Obsidian may request that image when it renders the note.

## Local vault indexing

Aside indexes markdown note paths and cached tags locally so link suggestions, tag suggestions, move targets, Thought Trail, and the generated comment index stay current. The index is seeded once when the plugin loads and then updated from Obsidian vault and metadata events. Publishing traverses only the configured publishing folder. Aside does not transmit the local note or tag index.

## Clipboard access

Aside reads clipboard data only from a paste event initiated by the user. It writes clipboard text only after an explicit copy action and uses a temporary, detached textarea when the async clipboard API is unavailable. Aside does not poll, read, persist, or log clipboard contents in the background.

## External services

- Local `Codex` and `Claude` agent commands run only after the user saves a side note that explicitly mentions that agent. Those tools may use their own configured services and policies.
- Experimental publishing runs the user's local Wrangler CLI against the Cloudflare Pages project selected by the user. If the user enables a remote HTTPS cache-purge broker, Aside sends the configured public URL, vault-relative source path, and purge event to that endpoint after unpublish or republish.
- Aside has no hidden telemetry or self-update service.

## How to Get Started

1. Install Aside from Obsidian's Community plugins browser.
2. Optional: install and sign in to the local agent CLI you want to use on the same machine.
3. Optional: install the Aside skill for better agent workflows.
   ```
   $skill-installer install https://github.com/vicky469/aside/tree/main/skills/aside
   ```
4. Experimental, for testers only: configure Cloudflare Pages publishing.
   - Install Wrangler so `wrangler --version` works in Terminal.
   - Run `wrangler login` with the Cloudflare account that owns the Pages project.
   - Create or choose a Cloudflare Pages project.
   - Open Obsidian Developer Tools and run this in the Console to reveal the hidden publishing settings and reload Aside:
     ```js
     localStorage.setItem(`aside.feature.publish.${app.vault.getName()}`, "true");
     await app.plugins.disablePlugin("aside");
     await app.plugins.enablePlugin("aside");
     ```
   - To hide the publishing settings again, run:
     ```js
     localStorage.setItem(`aside.feature.publish.${app.vault.getName()}`, "false");
     await app.plugins.disablePlugin("aside");
     await app.plugins.enablePlugin("aside");
     ```
   - You can also edit the `aside.feature.publish.<vault name>` entry directly under Developer Tools → Application → Local Storage, then reload Aside. Aside persists an exact `true` or `false` value to that vault's plugin data when it loads.
   - If you use a custom domain, attach it to the Pages project in Cloudflare first.
	- Optional for immediate unpublish cache invalidation on a custom domain:
	  - Deploy a compatible remote cache-purge broker outside the public plugin repository after setting `ALLOWED_HOSTS` to your publishing hostname. Aside's reference broker source is maintained separately from this marketplace plugin source archive.
	  - Store `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `BROKER_AUTH_SECRET` as Worker secrets. The API token needs Cloudflare's Cache Purge permission for that zone.
	  - In Aside settings, enter the deployed broker's `/purge` URL and select an Obsidian SecretStorage entry containing the same broker auth secret.
	  - Remote purge does not support `*.pages.dev`; use a custom domain in a Cloudflare zone you control.
   - In Aside settings, turn on Publishing and set the Publishing URL to your public Pages URL, for example `https://publish.example.com`.
   - Put publishable Markdown, HTML, and PDF files under `public/`. Aside creates `public/` when Publishing is enabled if it does not already exist.
   - For private published wikis with sign-in and comments:
     - Create `public/auth.md` with rows like `| google | alice@example.com | / | full |`. The columns are `provider`, `identity`, `path`, and `permission`; permissions are `view`, `comment`, or `full`.
     - Configure a D1 database binding on the Pages project named `ASIDE_COMMENTS_DB`.
     - Initialize that D1 database with the generated comment event schema:
       ```sql
       CREATE TABLE IF NOT EXISTS aside_comment_events (
         event_id TEXT PRIMARY KEY,
         path TEXT NOT NULL,
         op TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         author_provider TEXT NOT NULL,
         author_identity TEXT NOT NULL,
         author_display_name TEXT,
         created_at TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_aside_comment_events_path_created
         ON aside_comment_events (path, created_at, event_id);
       ```
     - Create a Google OAuth web client whose redirect URI is `https://your-publish-host/_aside/api/auth/google/callback`.
     - Store these Pages environment variables/secrets in Cloudflare: `ASIDE_GOOGLE_CLIENT_ID`, `ASIDE_GOOGLE_CLIENT_SECRET`, and a long random `ASIDE_SESSION_SECRET`.
     - Aside deploys through the local Wrangler direct-upload path. It stages static assets plus `functions/` and private runtime modules, then runs `wrangler pages deploy` for the configured Pages project; Aside does not store Cloudflare API tokens or OAuth secrets in the vault.
     - If sign-in returns a configuration error, check the three `ASIDE_GOOGLE_*`/session variables. If comments return a D1 error, check the `ASIDE_COMMENTS_DB` binding and schema. The generated owner export endpoint `/_aside/api/comment-events` requires a signed-in `full` permission at `/` and supports `afterCreatedAt` plus `afterEventId` cursor query parameters for local import tooling.

## Workflow

1. Open a markdown, PDF, or HTML file.
2. Add a side note.
   In markdown, select text and right-click `Add comment to selection`, or use the sidebar for a page note. In HTML and PDF files, use the sidebar to add a page note for the whole file.
3. Write your comment in the sidebar.
   Type `@todo` for follow-ups, `@codex` if you want Codex to take the task, or `@claude` if you want Claude to take it.

## Glossary

- **`thread`**  
  One Aside discussion attached to one target. A thread can have one first entry and later replies.

- **`entry`**  
  One message inside a thread. The first saved entry creates the thread. Later child entries are replies in the same thread.

- **`page note`**  
  A thread attached to the whole file, not to a text selection. Page notes work on markdown files, PDFs, and HTML files.

- **`anchored note`**  
  A thread attached to a specific text selection in a markdown note. HTML files and PDFs support page notes only.

- **`orphaned note`**  
  An anchored thread whose original text can no longer be matched in the file. The thread still exists; its anchor is just currently missing.

- **`🐰 Aside Index.md`**
  The generated vault-wide index note. It is derived output, not the source of truth.

- **`thought trail`**  
  The graph view built from `[[wikilinks]]` inside side-note threads.

## Writing in Side Notes

| Action | How it works |
| --- | --- |
| Save draft | Click `Save`. |
| Insert a newline | Press `Enter`. |
| Mark a todo | Type `@todo` in the note. |
| Publish public Markdown | Put the `.md` file under `public/`, open it, then click `Publish Markdown` in the pane header. |
| Publish public HTML | Put the `.html` file under `public/`, open it, then click `Publish HTML` in the pane header. If it is generated from Markdown, keep the source `.md` under `public/` too. |
| Publish a public PDF | Put the `.pdf` file under `public/`, open it, then click `Publish PDF` in the pane header. |
| Republish public content | Open the published file under `public/`, then click the matching `Republish Markdown`, `Republish HTML`, or `Republish PDF` action. |
| Unpublish public content | Open the published file under `public/`, then click the matching `Unpublish Markdown`, `Unpublish HTML`, or `Unpublish PDF` action. |
| Open published content | Open the published file under `public/`, then click the matching `Open published Markdown`, `Open published HTML`, or `Open published PDF` action. |
| Ask a local agent from a side note | Type `@codex` or `@claude` in the note, then save it. |
| Link a note | Type `[[` to open note suggestions and insert an Obsidian wikilink. |
| Add a tag | Type `#` to open tag suggestions and insert a tag. |
| Reopen link or tag suggestions | Press `Tab` while the cursor is inside an unfinished `[[...` or `#...` token. |
| Bold or highlight text | Use the sidebar `B` and `H` buttons to wrap the current selection with `**bold**` or `==highlight==`. |
| Cancel a draft or edit | Press `Esc`. |

## Commands

- `Aside: Add comment to selection`

## Reporting Bugs

Open a GitHub issue using the bug report template:

https://github.com/vicky469/aside/issues/new?template=bug_report.yml

For suspected vulnerabilities or other sensitive security issues, do not file a public issue. Email vickyli819@proton.me instead.

## License

MIT

<p align="center">
  <a href="https://buymeacoffee.com/vickyli">
    <img src="./assets/logo-readme.svg" alt="Aside logo" width="84">
  </a>
</p>
<p align="center">
  <strong>Keep Aside brewing.</strong>
</p>
<p align="center">
  <a href="https://buymeacoffee.com/vickyli">
    <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000" alt="Buy Me a Coffee">
  </a>
</p>
