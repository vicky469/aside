import * as assert from "node:assert/strict";
import test from "node:test";
import { mergeRunStates } from "../src/core/runStateMerge";

test("run state merge preserves pending local progress only with explicit ownership", () => {
    const persisted = [{ id: "run-1", status: "queued" }];
    const local = [{ id: "run-1", status: "running" }, { id: "run-2", status: "queued" }];
    assert.deepEqual(mergeRunStates(persisted, local, ["run-1", "run-2"]), local);
    assert.deepEqual(mergeRunStates(persisted, local, []), persisted);
});

test("run state merge keeps a terminal result on either side after ownership expires", () => {
    const pending = [{ id: "run-1", status: "running" }];
    const completed = [{ id: "run-1", status: "succeeded" }];
    for (const ownership of [[], ["run-1"]]) {
        assert.deepEqual(mergeRunStates(pending, completed, ownership), completed);
        assert.deepEqual(mergeRunStates(completed, pending, ownership), completed);
    }
});
