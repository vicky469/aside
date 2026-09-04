export const ASIDE_SETTINGS_HERO_INSTRUCTION = "Save highlight, add comment, ask @agent";
export const ASIDE_SETTINGS_HERO_GRAPH_LABEL = "Thought trail";

const ASIDE_SETTINGS_HERO_ARIA_LABEL =
    "Aside: Save a highlight, add a comment, ask an agent, and connect ideas in a thought trail.";

function appendNode(parentEl: HTMLElement, core = false): void {
    parentEl.createSpan({
        cls: core
            ? "aside-settings-hero-graph-core"
            : "aside-settings-hero-graph-node",
        text: core ? "●" : "·",
    });
}

function appendEdgeTrack(
    parentEl: HTMLElement,
    width: number,
    modifierClass: string,
): void {
    const trackEl = parentEl.createSpan({
        cls: `aside-settings-hero-edge-track ${modifierClass}`,
    });
    trackEl.append("─".repeat(width));
    trackEl.createSpan({
        cls: "aside-settings-hero-edge-runner",
        text: "·",
    });
}

function renderRelay(parentEl: HTMLElement): void {
    const relayEl = parentEl.createDiv({ cls: "aside-settings-hero-relay" });
    const rowEl = relayEl.createDiv({ cls: "aside-settings-hero-relay-row" });

    rowEl.createEl("pre", {
        cls: "aside-settings-hero-rabbit",
        text: " /)/)\n( . .)\n /づ",
    });
    rowEl.createEl("pre", {
        cls: "aside-settings-hero-thought",
        text: ["┌─────────┐\n│ ", "Thought", " │\n└─────────┘"].join(""),
    });

    const signalEl = rowEl.createSpan({ cls: "aside-settings-hero-signal" });
    for (const glyph of ["·", "─", "─", "▶"]) {
        signalEl.createSpan({
            cls: "aside-settings-hero-signal-glyph",
            text: glyph,
        });
    }

    rowEl.createEl("pre", {
        cls: "aside-settings-hero-aside-box",
        text: ["┌─────────┐\n│  ", "ASIDE", "  │\n└────┬────┘"].join(""),
    });

    const actionLineEl = relayEl.createDiv({ cls: "aside-settings-hero-action-line" });
    const actions = ASIDE_SETTINGS_HERO_INSTRUCTION.split(", ");
    for (const [index, action] of actions.entries()) {
        actionLineEl.createSpan({
            cls: "aside-settings-hero-action-chunk",
            text: `${index === 0 ? "╰─ " : ""}${action}${index < actions.length - 1 ? ", " : ""}`,
        });
    }
}

function renderGraph(parentEl: HTMLElement): void {
    const graphEl = parentEl.createEl("pre", { cls: "aside-settings-hero-graph" });

    graphEl.append("          ╭──");
    appendEdgeTrack(graphEl, 5, "is-track-1");
    graphEl.append("──╮\n      ╭──");
    appendNode(graphEl);
    graphEl.append("   ╭──");
    appendEdgeTrack(graphEl, 3, "is-track-2");
    graphEl.append("╮   ");
    appendNode(graphEl);
    graphEl.append("──╮\n   ╭──");
    appendNode(graphEl);
    graphEl.append("   ╰──");
    appendNode(graphEl);
    graphEl.append("    ");
    appendNode(graphEl);
    graphEl.append("──╯   ");
    appendNode(graphEl);
    graphEl.append("──╮\n   ");
    appendNode(graphEl);
    graphEl.append("     ╭──");
    appendEdgeTrack(graphEl, 3, "is-track-3");
    graphEl.append("╮  ╭──");
    appendEdgeTrack(graphEl, 3, "is-track-4");
    graphEl.append("╮     ");
    appendNode(graphEl);
    graphEl.append("\n   ╰──");
    appendNode(graphEl);
    graphEl.append("──╯     ╰──╯     ╰──");
    appendNode(graphEl);
    graphEl.append("──╯\n      ╰──");
    appendEdgeTrack(graphEl, 5, "is-track-5");
    graphEl.append("╮   │   ╭");
    appendEdgeTrack(graphEl, 5, "is-track-6");
    graphEl.append("──╯\n              ╰──");
    appendNode(graphEl, true);
    graphEl.append("──╯");

    parentEl.createDiv({
        cls: "aside-settings-hero-graph-label",
        text: ASIDE_SETTINGS_HERO_GRAPH_LABEL,
    });
}

export function renderAsideSettingsHeaderArt(containerEl: HTMLElement): HTMLElement {
    const heroEl = containerEl.createDiv({
        cls: "aside-settings-hero",
        attr: {
            role: "img",
            "aria-label": ASIDE_SETTINGS_HERO_ARIA_LABEL,
        },
    });
    const artEl = heroEl.createDiv({
        cls: "aside-settings-hero-art",
        attr: {
            "aria-hidden": "true",
        },
    });

    renderRelay(artEl);
    renderGraph(artEl);
    return heroEl;
}
