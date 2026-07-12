import * as assert from "node:assert/strict";
import test from "node:test";
import { isExternalSidecarStoragePath } from "../src/core/storage/externalSidecarRefresh";

test("external sidecar refresh detects Aside sidecar JSON paths", () => {
    assert.equal(isExternalSidecarStoragePath("sidenotes/by-note/aa/file.json"), true);
    assert.equal(isExternalSidecarStoragePath("sidenotes\\by-source\\aa\\file.json"), true);
    assert.equal(isExternalSidecarStoragePath("/vault/.obsidian/plugins/aside/sidenotes/by-source/aa/file.json"), true);
});

test("external sidecar refresh ignores non-sidecar watch paths", () => {
    assert.equal(isExternalSidecarStoragePath("data.json"), false);
    assert.equal(isExternalSidecarStoragePath("sidenotes/by-note/aa/file.json.tmp-123"), false);
    assert.equal(isExternalSidecarStoragePath("sidenotes/cache/file.json"), false);
    assert.equal(isExternalSidecarStoragePath(null), false);
});
