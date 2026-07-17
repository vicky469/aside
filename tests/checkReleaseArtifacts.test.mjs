import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

import { inspectReleaseArtifacts, RELEASE_ARTIFACTS } from "../scripts/check-release-artifacts.mjs";

test("release artifact allowlist is exactly the three public plugin assets", () => {
    assert.deepEqual(RELEASE_ARTIFACTS, ["main.js", "manifest.json", "styles.css"]);
});

test("release artifact guard rejects embedded source content", () => {
    withTempDir((tempDir) => {
        writeReleaseFiles(tempDir, {
            "main.js": "const map = { sourcesContent: ['private source'] };",
        });
        assert.match(inspectReleaseArtifacts(tempDir).join("\n"), /embedded sourcesContent/u);
    });
});

function withTempDir(callback) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "aside-release-artifacts-"));
    try {
        return callback(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function writeReleaseFiles(tempDir, overrides = {}) {
    const files = {
        "main.js": "console.log('ok');",
        "manifest.json": "{\"id\":\"aside\",\"version\":\"2.0.12\"}",
        "styles.css": ".root { color: red; }",
        ...overrides,
    };

    for (const [name, content] of Object.entries(files)) {
        writeFileSync(path.join(tempDir, name), content, "utf8");
    }
}

test("inspectReleaseArtifacts passes for expected shipped assets", () => {
    withTempDir((tempDir) => {
        writeReleaseFiles(tempDir);
        assert.deepEqual(inspectReleaseArtifacts(tempDir), []);
    });
});

test("inspectReleaseArtifacts fails when main.js.map exists", () => {
    withTempDir((tempDir) => {
        writeReleaseFiles(tempDir, {
            "main.js.map": "{\"version\":3}",
        });
        assert.match(
            inspectReleaseArtifacts(tempDir).join("\n"),
            /main\.js\.map must not be shipped/,
        );
    });
});

test("inspectReleaseArtifacts fails on source map markers and local paths", () => {
    withTempDir((tempDir) => {
        writeReleaseFiles(tempDir, {
            "main.js": "//# sourceMappingURL=main.js.map\nconsole.log('/Users/example/secret');",
        });
        const output = inspectReleaseArtifacts(tempDir).join("\n");
        assert.match(output, /sourceMappingURL marker/);
        assert.match(output, /local macOS path/);
    });
});

test("inspectReleaseArtifacts fails on obvious secret material", () => {
    withTempDir((tempDir) => {
        writeReleaseFiles(tempDir, {
            "styles.css": "-----BEGIN PRIVATE KEY-----",
        });
        assert.match(
            inspectReleaseArtifacts(tempDir).join("\n"),
            /private key material/,
        );
    });
});
