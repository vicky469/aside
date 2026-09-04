export const ASIDE_SETTINGS_HERO_INSTRUCTION = "add comment, @agent reply";

const ASIDE_SETTINGS_HERO_ARIA_LABEL =
    "Aside: Add a comment, receive an @agent reply, and grow a thought trail.";

interface GraphPlaneSpec {
    modifierClass: string;
    topTrackClass: string;
    armTrackClass: string;
}

const GRAPH_PLANE_SPECS: readonly GraphPlaneSpec[] = [
    {
        modifierClass: "is-plane-a",
        topTrackClass: "is-track-1",
        armTrackClass: "is-track-2",
    },
    {
        modifierClass: "is-plane-b",
        topTrackClass: "is-track-3",
        armTrackClass: "is-track-4",
    },
    {
        modifierClass: "is-plane-c",
        topTrackClass: "is-track-5",
        armTrackClass: "is-track-6",
    },
];

function appendNode(parentEl: HTMLElement): void {
    parentEl.createSpan({
        cls: "aside-settings-hero-graph-node",
        text: "·",
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
    actionLineEl.createSpan({
        cls: "aside-settings-hero-action-chunk",
        text: `╰─ ${ASIDE_SETTINGS_HERO_INSTRUCTION}`,
    });
}

function appendGraphPlane(parentEl: HTMLElement, spec: GraphPlaneSpec): void {
    const planeEl = parentEl.createEl("pre", {
        cls: `aside-settings-hero-graph-plane ${spec.modifierClass}`,
    });
    planeEl.append("    ");
    appendNode(planeEl);
    appendEdgeTrack(planeEl, 4, spec.topTrackClass);
    appendNode(planeEl);
    planeEl.append("\n    │    │\n");
    appendNode(planeEl);
    appendEdgeTrack(planeEl, 3, spec.armTrackClass);
    planeEl.append("─────");
    appendNode(planeEl);
    planeEl.append("\n    │\n    ");
    appendNode(planeEl);
}

function renderGraph(parentEl: HTMLElement): void {
    const rowEl = parentEl.createDiv({ cls: "aside-settings-hero-graph-row" });
    const stageEl = rowEl.createDiv({ cls: "aside-settings-hero-graph-stage" });
    const sceneEl = stageEl.createDiv({ cls: "aside-settings-hero-graph-scene" });

    for (const spec of GRAPH_PLANE_SPECS) {
        appendGraphPlane(sceneEl, spec);
    }
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
