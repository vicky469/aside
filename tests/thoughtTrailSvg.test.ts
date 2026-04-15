import * as assert from "node:assert/strict";
import test from "node:test";
import { parseTrustedMermaidSvgDocument } from "../src/ui/views/thoughtTrailSvg";

test("parseTrustedMermaidSvgDocument keeps a valid svg root", () => {
    const svgRoot = { nodeName: "svg", kind: "svg-root" };
    const importedRoot = { nodeName: "svg", kind: "imported-root" };

    const parsed = parseTrustedMermaidSvgDocument(
        "<svg><style>.node{fill:#fff;}</style></svg>",
        () => ({
            documentElement: svgRoot,
            querySelector: () => null,
        }),
        (root) => {
            assert.equal(root, svgRoot);
            return importedRoot;
        },
    );

    assert.equal(parsed, importedRoot);
});

test("parseTrustedMermaidSvgDocument rejects parser errors", () => {
    const svgRoot = { nodeName: "svg" };
    let imported = false;

    const parsed = parseTrustedMermaidSvgDocument(
        "<svg>",
        () => ({
            documentElement: svgRoot,
            querySelector: (selector: string) => selector === "parsererror" ? {} : null,
        }),
        (root) => {
            imported = true;
            return root;
        },
    );

    assert.equal(parsed, null);
    assert.equal(imported, false);
});

test("parseTrustedMermaidSvgDocument rejects non-svg roots", () => {
    let imported = false;

    const parsed = parseTrustedMermaidSvgDocument(
        "<div></div>",
        () => ({
            documentElement: { nodeName: "div" },
            querySelector: () => null,
        }),
        (root) => {
            imported = true;
            return root;
        },
    );

    assert.equal(parsed, null);
    assert.equal(imported, false);
});
