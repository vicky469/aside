import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveSidebarCardActionState } from "../src/ui/views/sidebarCardActionState";

test("index card tabs expose only valid top-level mutations", () => {
    for (const mode of ["list", "todo", "agent"] as const) {
        assert.deepEqual(resolveSidebarCardActionState("index", mode), {
            showPin: true,
            canEditParent: true,
            canDeleteParent: true,
            enableTopLevelReorder: true,
            enableChildEntryMove: false,
        });
    }

    assert.deepEqual(resolveSidebarCardActionState("index", "thought-trail"), {
        showPin: false,
        canEditParent: false,
        canDeleteParent: false,
        enableTopLevelReorder: false,
        enableChildEntryMove: false,
    });
});

test("note cards retain their current mutation capabilities", () => {
    assert.deepEqual(resolveSidebarCardActionState("note", "list"), {
        showPin: true,
        canEditParent: true,
        canDeleteParent: true,
        enableTopLevelReorder: true,
        enableChildEntryMove: true,
    });
});
