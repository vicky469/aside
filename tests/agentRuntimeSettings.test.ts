import * as assert from "node:assert/strict";
import test from "node:test";
import {
    formatAgentRuntimeStatusLines,
    shouldRenderAgentRuntimeStatus,
} from "../src/ui/settings/agentRuntimeSettings";

test("agent runtime status is rendered only while the agent sidebar tab is shown", () => {
    assert.equal(shouldRenderAgentRuntimeStatus({ showAgentSidebarTab: true }), true);
    assert.equal(shouldRenderAgentRuntimeStatus({ showAgentSidebarTab: false }), false);
});

test("agent runtime statuses are formatted as one setting description line below the label", () => {
    assert.deepEqual(
        formatAgentRuntimeStatusLines([
            { directive: "@codex", statusBadge: "..." },
            { directive: "@claude", statusBadge: "✅" },
        ]),
        [
            "@codex ...    @claude ✅",
        ],
    );
});
