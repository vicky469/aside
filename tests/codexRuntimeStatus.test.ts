import { strict as assert } from "node:assert";
import test from "node:test";
import {
    createCheckingCodexRuntimeDiagnostics,
    getAgentRuntimeStatusPresentation,
    getCodexRuntimeStatusPresentation,
    getCodexRuntimeStatusPresentationForSelection,
    getLocalRuntimeOptionStatusPresentation,
} from "../src/ui/settings/codexRuntimeStatus";

test("codex runtime status presentation reports available clearly", () => {
    assert.deepEqual(
        getCodexRuntimeStatusPresentation({
            status: "available",
            message: "Codex is available.",
        }),
        {
            title: "Codex runtime: Available",
            description: "Built-in @codex can run in this Obsidian environment.",
        },
    );
});

test("agent runtime status presentation reports claude availability clearly", () => {
    assert.deepEqual(
        getAgentRuntimeStatusPresentation("claude", {
            status: "available",
            message: "Claude CLI is available.",
        }),
        {
            title: "Claude runtime: Available",
            description: "Built-in @claude can run in this Obsidian environment.",
        },
    );
});

test("codex runtime status presentation collapses device-local failures into unavailable", () => {
    assert.deepEqual(
        getCodexRuntimeStatusPresentation({
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian with a filesystem-backed vault.",
        }),
        {
            title: "Codex runtime: Unavailable on this device",
            description: "Built-in @codex requires desktop Obsidian with a filesystem-backed vault.",
        },
    );
});

test("codex runtime status presentation exposes checking copy", () => {
    assert.deepEqual(createCheckingCodexRuntimeDiagnostics(), {
        status: "checking",
        message: "Checking whether @codex is available...",
    });
    assert.deepEqual(
        getCodexRuntimeStatusPresentation(createCheckingCodexRuntimeDiagnostics()),
        {
            title: "Codex runtime: Checking...",
            description: "Checking whether @codex is available...",
        },
    );
});

test("codex runtime status presentation reflects resolved local runtime selection", () => {
    assert.deepEqual(
        getCodexRuntimeStatusPresentationForSelection({
            kind: "resolved",
            runtime: "direct-cli",
            modePreference: "auto",
            ownershipMessage: "Using your local Codex setup",
        }),
        {
            title: "Codex runtime: Available",
            description: "Using your local Codex setup",
        },
    );
});

test("codex runtime status presentation reflects blocked runtime selection", () => {
    assert.deepEqual(
        getCodexRuntimeStatusPresentationForSelection({
            kind: "blocked",
            modePreference: "auto",
            notice: "Built-in @codex requires desktop Obsidian.",
        }),
        {
            title: "Codex runtime: Unavailable",
            description: "Built-in @codex requires desktop Obsidian.",
        },
    );
});

test("runtime option status presentation reports local availability for the settings picker", () => {
    assert.deepEqual(
        getLocalRuntimeOptionStatusPresentation({
            status: "available",
            message: "Codex is available.",
        }),
        {
            label: "Local ✅",
            description: "At least one local Aside agent can run in this Obsidian environment.",
            available: true,
        },
    );
});
