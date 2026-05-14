import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveMermaidRuntime } from "../src/ui/views/mermaidRuntime";

function createRuntime() {
    return {
        initialize: () => undefined,
        render: async () => "<svg></svg>",
    };
}

test("resolveMermaidRuntime uses the runtime returned by Obsidian loadMermaid", () => {
    const loadedRuntime = createRuntime();

    assert.equal(resolveMermaidRuntime(loadedRuntime, undefined), loadedRuntime);
});

test("resolveMermaidRuntime falls back to the global Mermaid runtime", () => {
    const globalRuntime = createRuntime();

    assert.equal(resolveMermaidRuntime(undefined, globalRuntime), globalRuntime);
});
