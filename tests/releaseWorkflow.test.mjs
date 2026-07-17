import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/release.yml"), "utf8");

test("release workflow builds the tag with Node 24 and shared checks", () => {
    assert.match(workflow, /node-version:\s*"24"/u);
    assert.match(workflow, /npm ci/u);
    assert.match(workflow, /npm run release:check/u);
    assert.ok(workflow.indexOf("Verify tag matches manifest version") < workflow.indexOf("Run release checks"));
});

test("release workflow refuses to mutate an existing release", () => {
    assert.match(workflow, /gh release view "\$GITHUB_REF_NAME"/u);
    assert.match(workflow, /already exists; refusing to overwrite/u);
    assert.doesNotMatch(workflow, /gh release edit|gh release upload|--clobber/u);
});

test("release workflow attests executable outputs and verifies tag-bound identity", () => {
    const attestationBlock = workflow.slice(
        workflow.indexOf("Generate artifact attestations"),
        workflow.indexOf("Verify artifact attestations"),
    );
    assert.match(attestationBlock, /main\.js/u);
    assert.match(attestationBlock, /styles\.css/u);
    assert.doesNotMatch(attestationBlock, /manifest\.json/u);

    assert.match(workflow, /gh attestation verify "\$asset"/u);
    assert.match(workflow, /--repo vicky469\/aside/u);
    assert.match(workflow, /--source-ref "refs\/tags\/\$GITHUB_REF_NAME"/u);
    assert.match(workflow, /--source-digest "\$GITHUB_SHA"/u);
    assert.match(workflow, /--signer-workflow vicky469\/aside\/.github\/workflows\/release\.yml/u);
});

test("release workflow creates one release with the exact public asset set", () => {
    const createCommands = workflow.match(/gh release create/gu) ?? [];
    assert.equal(createCommands.length, 1);
    const createBlock = workflow.slice(workflow.indexOf("gh release create"));
    assert.match(createBlock, /main\.js manifest\.json styles\.css/u);
});
