import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
    inspectBundleSize,
    MAX_MAIN_BUNDLE_BYTES,
} from "../scripts/check-bundle-size.mjs";

function withTempDir(callback) {
    const tempDir = mkdtempSync(path.join(tmpdir(), "aside-bundle-size-"));
    try {
        callback(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

test("bundle size policy accepts the production byte ceiling", () => {
    withTempDir((tempDir) => {
        const bundlePath = path.join(tempDir, "main.js");
        writeFileSync(bundlePath, Buffer.alloc(MAX_MAIN_BUNDLE_BYTES));

        assert.deepEqual(inspectBundleSize(bundlePath), []);
    });
});

test("bundle size policy reports the exact byte overage", () => {
    withTempDir((tempDir) => {
        const bundlePath = path.join(tempDir, "main.js");
        writeFileSync(bundlePath, Buffer.alloc(MAX_MAIN_BUNDLE_BYTES + 1));

        assert.deepEqual(inspectBundleSize(bundlePath), [
            "main.js is 750001 bytes; maximum is 750000 bytes (1 byte over)",
        ]);
    });
});

test("bundle size policy rejects missing and non-file artifacts", () => {
    withTempDir((tempDir) => {
        const missingPath = path.join(tempDir, "missing.js");
        const directoryPath = path.join(tempDir, "main.js");
        mkdirSync(directoryPath);

        assert.deepEqual(inspectBundleSize(missingPath), [
            "Missing production bundle: missing.js",
        ]);
        assert.deepEqual(inspectBundleSize(directoryPath), [
            "Production bundle is not a file: main.js",
        ]);
    });
});
