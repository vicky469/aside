---
name: obsidian-excalidraw
description: Work with the Obsidian Excalidraw plugin, including visual PKM drawings, markdown embeds, ExcalidrawAutomate scripts, generated diagrams, templates, export settings, and plugin-security review context. Use when the user mentions Obsidian Excalidraw, .excalidraw files, ExcalidrawAutomate, sketch-your-mind workflows, Excalidraw markdown embeds, or automating drawings inside an Obsidian vault.
---

# Obsidian Excalidraw

## Source context

Primary upstream project: https://github.com/zsviczian/obsidian-excalidraw-plugin

The plugin integrates Excalidraw into Obsidian so drawings can live in the vault, be edited in Obsidian, embedded in notes, and linked to notes or other drawings. Treat this as an Obsidian plugin workflow, not as generic excalidraw.com usage.

## Default approach

1. Identify whether the task is about using the plugin, writing ExcalidrawAutomate code, creating markdown embeds, reviewing plugin code/security, or shaping a visual PKM workflow.
2. Prefer vault-local and offline assumptions unless the user explicitly enables optional integrations.
3. For automation, target Obsidian + Templater-style JavaScript snippets using the global `ExcalidrawAutomate` object.
4. Keep generated drawings maintainable: clear names, predictable folders, reusable templates, and comments around layout constants.
5. When advising on security, distinguish local Obsidian risk from public web-app risk.

## ExcalidrawAutomate quick pattern

Use this starting point for scripts:

```javascript
const ea = ExcalidrawAutomate;
ea.reset();
```

Then:

1. Set style and canvas properties.
2. Add elements.
3. Call `await ea.create()` or another output method.

Common methods and fields:

```javascript
ea.style.strokeColor = "#e03131";
ea.style.backgroundColor = "transparent";
ea.style.fontSize = 20;
ea.canvas.theme = "light";
ea.canvas.viewBackgroundColor = "#ffffff";

const box = ea.addRect(-100, -50, 220, 120);
const label = ea.addText(-80, -10, "Label", { width: 180, textAlign: "center" });
ea.addArrow([[120, 10], [260, 10]], { endArrowHead: "arrow" });
ea.connectObjects(box, "right", label, "left", { endArrowHead: "arrow" });

await ea.create({
  filename: "my drawing",
  foldername: "Excalidraw",
  templatePath: "Excalidraw/template.excalidraw",
  onNewPane: true,
});
```

Useful APIs include `addRect`, `addDiamond`, `addEllipse`, `addText`, `addLine`, `addArrow`, `connectObjects`, `addToGroup`, `toClipboard`, `create`, `createPNG`, `createSVG`, `clear`, and `reset`.

## Markdown and vault workflows

- Use fenced `excalidraw` embeds for notes that should display drawings inline.
- Prefer stable relative vault paths when creating links or embeds.
- For generated drawings, use folder and filename conventions that match the surrounding note workflow.
- When creating visual maps from notes, parse headings or outline indentation into nodes, then connect parent-child nodes with `connectObjects`.

## Security and privacy context

The upstream README says the plugin is local/offline by default, but some features can contact external services when explicitly configured or invoked. Examples include AI integrations, OCR, external image embeds, optional webpage title resolution, script library downloads, and asset downloads such as large fonts.

When reviewing or advising:

- Do not treat every `innerHTML`, `eval`, IPC, `fetch`, or filesystem access finding as automatically equivalent to a public web vulnerability.
- Check whether the feature is opt-in, vault-local, user-script-driven, or required by Obsidian/Electron limitations.
- Still flag realistic risks for untrusted vaults, copied community scripts, external embeds, API keys, and anything that reads outside the vault.

## When to fetch fresh docs

Fetch upstream docs when exact API signatures, settings, or security behavior matter. Start with:

- README: https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/README.md
- Automation guide: https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/AutomateHowTo.md
- Community wiki: https://community.sketch-your-mind.com/Wiki
