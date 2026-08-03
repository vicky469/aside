import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function readRepoFile(relativePath) {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("removed resolve workflow stays out of active surfaces", () => {
    const requiredActiveSurfacePaths = [
        "package.json",
        "README.md",
        "shared/sideNotePromptPolicy.js",
        "scripts/lib/asideRepoScripts.mjs",
        "scripts/generate-large-graph-fixture.mjs",
        "src/main.ts",
    ];
    const optionalEnvironmentAuditPaths = ["AGENTS.md"];
    const activeSurfaces = [
        ...requiredActiveSurfacePaths.map((relativePath) => readRepoFile(relativePath)),
        ...optionalEnvironmentAuditPaths
            .filter((relativePath) => existsSync(path.join(repoRoot, relativePath)))
            .map((relativePath) => readRepoFile(relativePath)),
    ].join("\n");
    const forbiddenResidue = [
        ["resolve-note-comment", /resolve-note-comment/u],
        ["comment:resolve", /comment:resolve/u],
        ["resolved: false", /resolved:\s*false/u],
        ["ensureCommentSelectionVisible", /ensureCommentSelectionVisible/u],
        ["loadKnownCommentSelectionTarget", /loadKnownCommentSelectionTarget/u],
    ];
    const presentResidue = forbiddenResidue
        .filter(([, pattern]) => pattern.test(activeSurfaces))
        .map(([label]) => label);

    assert.deepEqual(presentResidue, []);
});

test("support-report submission implementation stays removed", () => {
    const removedPaths = [
        "src/support/supportConfig.ts",
        "src/support/supportReportSender.ts",
        "src/support/supportTypes.ts",
        "src/ui/modals/SupportImagePreviewModal.ts",
        "src/ui/modals/SupportLogPreviewModal.ts",
        "src/ui/modals/SupportReportModal.ts",
    ];
    const existingPaths = removedPaths.filter((relativePath) => (
        existsSync(path.join(repoRoot, relativePath))
    ));

    assert.deepEqual(existingPaths, []);
    assert.doesNotMatch(readRepoFile("README.md"), /sending a support report/iu);
    assert.doesNotMatch(readRepoFile("README.md"), /Support reports are sent/iu);
    assert.doesNotMatch(readRepoFile("styles.css"), /aside-support-report-modal/iu);
    assert.doesNotMatch(readRepoFile("styles.css"), /aside-support-image-preview/iu);
});
