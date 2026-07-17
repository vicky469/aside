import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkObsidianCompliance } from "../scripts/check-obsidian-compliance.mjs";

const REQUIRED_DISCLOSURES = [
    "## Network access",
    "## Local vault indexing",
    "## Clipboard access",
    "## External services",
];

function createFixture(overrides = {}) {
    const rootDir = mkdtempSync(path.join(tmpdir(), "aside-compliance-"));
    const files = {
        "package.json": JSON.stringify({ version: "2.0.91" }),
        "manifest.json": JSON.stringify({
            id: "aside",
            name: "Aside",
            version: "2.0.91",
            minAppVersion: "1.12.7",
            description: "Side comments for humans and agents.",
            author: "vicky",
            isDesktopOnly: false,
        }),
        "versions.json": JSON.stringify({ "2.0.91": "1.12.7" }),
        "README.md": `${REQUIRED_DISCLOSURES.join("\n\n")}\n\nDeclared plugin hosts: none\n`,
        "main.js": "console.log('fixture');\n",
        "styles.css": ".aside {}\n",
        "LICENSE": "MIT\n",
        "src/main.ts": "export {};\n",
        ".github/workflows/ci.yml": [
            "on: [push, pull_request]",
            "strategy:",
            "  matrix:",
            "    node-version: [20, 22, 24]",
            "steps:",
            "  - run: npm ci",
            "  - run: npm run build",
        ].join("\n"),
        ".github/workflows/release.yml": [
            "run: npm run release:check",
            "run: gh release view $GITHUB_REF_NAME && exit 1 || true",
            "run: gh release create $GITHUB_REF_NAME main.js manifest.json styles.css",
        ].join("\n"),
        ...overrides,
    };

    for (const [relativePath, contents] of Object.entries(files)) {
        const filePath = path.join(rootDir, relativePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, contents);
    }

    return rootDir;
}

function withFixture(overrides, callback) {
    const rootDir = createFixture(overrides);
    try {
        callback(rootDir);
    } finally {
        rmSync(rootDir, { recursive: true, force: true });
    }
}

test("compliance checker accepts the maintained repository contract", () => {
    withFixture({}, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), []);
    });
});

test("compliance checker reports version and minimum-version drift", () => {
    withFixture({
        "package.json": JSON.stringify({ version: "2.0.92" }),
        "versions.json": JSON.stringify({ "2.0.91": "1.13.0" }),
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), [
            "manifest.json version 2.0.91 does not match package.json version 2.0.92",
            "versions.json entry for 2.0.91 must equal minAppVersion 1.12.7",
        ]);
    });
});

test("compliance checker requires every maintained capability disclosure", () => {
    withFixture({
        "README.md": REQUIRED_DISCLOSURES.slice(0, 3).join("\n\n"),
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), [
            "README.md is missing capability disclosure: ## External services",
        ]);
    });
});

test("compliance checker reports undeclared executable plugin hosts", () => {
    withFixture({
        "src/main.ts": "fetch('https://api.example.com/v1/status');\n",
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), [
            "src/main.ts uses undeclared plugin network host: api.example.com",
        ]);
    });
});

test("compliance checker ignores static examples and namespace identifiers", () => {
    withFixture({
        "src/main.ts": [
            "const example = 'https://publish.example.com';",
            "const svgNamespace = 'http://www.w3.org/2000/svg';",
        ].join("\n"),
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), []);
    });
});

test("compliance checker rejects background clipboard reads", () => {
    withFixture({
        "src/main.ts": "void navigator.clipboard.readText();\n",
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), [
            "src/main.ts contains forbidden background clipboard read: navigator.clipboard.readText()",
        ]);
    });
});

test("compliance checker requires the official Node build matrix", () => {
    withFixture({
        ".github/workflows/ci.yml": "node-version: [20, 22]\nrun: npm ci\nrun: npm run build\n",
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), [
            ".github/workflows/ci.yml must test Node.js 20, 22, and 24",
        ]);
    });
});

test("compliance checker rejects mutable release commands", () => {
    withFixture({
        ".github/workflows/release.yml": "run: npm run release:check\nrun: gh release upload --clobber main.js\n",
    }, (rootDir) => {
        assert.deepEqual(checkObsidianCompliance(rootDir), [
            ".github/workflows/release.yml must not overwrite existing release assets",
            ".github/workflows/release.yml must create exactly main.js, manifest.json, and styles.css",
        ]);
    });
});
