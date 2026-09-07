# Agents and Scripts

Aside supports local agents and reusable scripts in desktop Obsidian with a filesystem-backed vault. It can invoke Codex, Claude Code, Cursor, Gemini, and DeepSeek through local CLIs. Aside bundles none of those CLIs and has no agent service of its own. The `@deepseek` mention uses your configured OpenCode CLI and the model selected there, so the label does not guarantee that the active model is DeepSeek.

Scripts are an optional advanced capability and are off by default for a clean experience. Ordinary agent replies do not require Scripts.

## Security

Vault scripts are **not sandboxed**. They run in local Node with your **local account permissions** and inherited environment. Aside launches Node without a shell, uses the vault root as its working directory, and passes the absolute path of the current Markdown note as the script's only automatic argument. Output is bounded, and each run times out after 60 seconds.

These controls do not prevent a script from reading, changing, or sending anything available to your local account. Review every script and run only code you wrote or trust. Do not put credentials in a script or side note.

### Agent Access and Privacy

Agent prompts include the saved side-note request, relevant source-note context, the thread transcript, and paths needed for the task. The local CLI and its model provider may receive them. Agent runs may read or change vault files and use network-capable tools or external model providers within the tools, sandbox, and configuration supplied for that provider.

Aside starts agents headlessly with non-interactive, permission-affecting flags:

- Codex runs one-shot with `-s workspace-write`; Aside adds the vault root with `--add-dir` when needed.
- Claude Code receives `--allowedTools WebSearch,Bash,Read,Write,Edit,Glob,Grep`.
- Cursor receives `--force --trust --sandbox enabled`, using the workspace plus a vault `--add-dir` when needed.
- Gemini receives `--skip-trust --sandbox --approval-mode yolo` and includes the vault directory.
- `@deepseek` uses OpenCode with `run --auto` and OpenCode's selected model.

Do not rely on normal interactive approval prompts. Review the CLI and provider settings, plus any sensitive note context, before invoking an agent.

## Ask an Agent

Install and sign in to the local CLI you want to use first. In a side note, type `@codex`, `@claude`, `@cursor`, `@gemini`, or `@deepseek` with your request, then save the note. The CLI uses its configured account and model when Aside does not override them, but Aside supplies non-interactive execution and permission-affecting flags. Normal interactive approval behavior is not guaranteed.

The Agent tab is optional and hidden by default. Enable **Settings → Aside → Sidebar tabs → Show agent tab** for a focused agent view. This controls visibility only; agent replies remain normal entries in the List view.

## Enable Scripts

To create or run trusted local scripts, turn on **Settings → Aside → Scripts (advanced) → Enable scripts**. Then choose the default local agent in the same section for script creation, updates, and PDF conversion.

Turning Scripts off blocks new slash and script command execution plus script-oriented Generate actions. It does not delete registered scripts, history, or saved replies. Disabled script-like text remains ordinary note or agent text.

The Scripts setting is an experience and execution control, not a sandbox or security boundary. The security and privacy warnings above still apply whenever you run scripts or agents.

## Create or Update a Script

- Choose the default local agent used for script work under **Settings → Aside → Scripts (advanced)**.
- Use `/create-script <request>` in a side note. On the first valid request, Aside automatically creates `🛠️ scripts/` if the folder is missing, then asks the default agent to create the script.
- Use `/update-script /script-name <request>` to ask the default agent to change an existing script.
- Open a PDF and use `/pdf-to-markdown` by itself to ask the default agent to create a sibling Markdown file.

## Run a Script

1. Open the Markdown note the script should process.
2. Add or reply to an Aside comment.
3. Type `/` and choose the script, or enter its command directly, such as `/clean-citations`.
4. Save the comment. Aside runs the script and appends its output to the thread.

Use **Generate** on the script reply to run the latest version against the current note again. Use one vault script per comment, and do not mix a script command with an agent mention.

## Supported Scripts

- Scripts must be direct child files of `🛠️ scripts/`; nested folders are ignored.
- Supported extensions are `.mjs`, `.js`, and `.cjs`.
- Filenames cannot contain spaces. The filename without its extension becomes the command: `clean-citations.mjs` becomes `/clean-citations`.
- Hidden files and filename stems ending in `.test` or `.spec` are ignored.
- Command names are matched case-insensitively. Duplicate names are not runnable.
- Aside's built-in names are reserved and not runnable as scripts, including `todo`, `codex`, `claude`, `cursor`, `gemini`, `deepseek`, `create-script`, `update-script`, and `pdf-to-markdown`.

Aside keeps the live script registry current when eligible files are created, renamed, or deleted.
