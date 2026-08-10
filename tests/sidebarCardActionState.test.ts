import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveSidebarCardActionState } from "../src/ui/views/sidebarCardActionState";

test("file-scoped index card tabs expose entry mutation parity", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveSidebarCardActionState("index", mode, "file"), {
            showPin: true,
            canEditEntries: true,
            canDeleteEntries: true,
            enableTopLevelReorder: true,
            enableChildEntryMove: true,
        });
    }
});

test("global Todo keeps entry mutations but disables mixed-file ordering", () => {
    assert.deepEqual(resolveSidebarCardActionState("index", "todo", "global-todo"), {
        showPin: true,
        canEditEntries: true,
        canDeleteEntries: true,
        enableTopLevelReorder: false,
        enableChildEntryMove: false,
    });
});

test("gated and non-card index modes expose no mutations", () => {
    assert.deepEqual(resolveSidebarCardActionState("index", "list", "unavailable"), {
        showPin: false,
        canEditEntries: false,
        canDeleteEntries: false,
        enableTopLevelReorder: false,
        enableChildEntryMove: false,
    });
    assert.deepEqual(resolveSidebarCardActionState("index", "thought-trail", "file"), {
        showPin: false,
        canEditEntries: false,
        canDeleteEntries: false,
        enableTopLevelReorder: false,
        enableChildEntryMove: false,
    });
});

test("note cards retain their current mutation capabilities", () => {
    assert.deepEqual(resolveSidebarCardActionState("note", "list", null), {
        showPin: true,
        canEditEntries: true,
        canDeleteEntries: true,
        enableTopLevelReorder: true,
        enableChildEntryMove: true,
    });
});
