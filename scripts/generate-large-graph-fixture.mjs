#!/usr/bin/env node

import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getRepoRoot(metaUrl) {
    return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

async function loadStorageModule(repoRoot) {
    const entryPoint = path.resolve(repoRoot, "src/core/storage/noteCommentStorage.ts");
    const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        format: "esm",
        platform: "node",
        target: ["node18"],
        write: false,
        logLevel: "silent",
    });

    const output = result.outputFiles?.[0]?.text;
    if (!output) {
        throw new Error("Failed to bundle noteCommentStorage.ts");
    }

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
    return import(moduleUrl);
}

function normalizeVaultPath(targetPath) {
    return targetPath.split(path.sep).join("/");
}

function makePageCommentLabel(filePath) {
    return path.basename(filePath, path.extname(filePath));
}

function makeHash(input) {
    return createHash("sha1").update(input).digest("hex");
}

function makeNodeName(size, pattern, componentNumber, nodeNumber) {
    return `g${String(size).padStart(2, "0")}-${pattern}-c${String(componentNumber).padStart(2, "0")}-n${String(nodeNumber).padStart(2, "0")}`;
}

function buildComponentNodeNames(size, pattern, componentNumber) {
    return Array.from({ length: size }, (_, index) => makeNodeName(size, pattern, componentNumber, index + 1));
}

function buildEdges(nodeNames, pattern) {
    const edges = new Map(nodeNames.map((nodeName) => [nodeName, []]));
    const lastIndex = nodeNames.length - 1;

    const addEdge = (fromIndex, toIndex) => {
        if (fromIndex < 0 || toIndex < 0 || fromIndex > lastIndex || toIndex > lastIndex || fromIndex === toIndex) {
            return;
        }

        const sourceEdges = edges.get(nodeNames[fromIndex]);
        if (!sourceEdges || sourceEdges.includes(nodeNames[toIndex])) {
            return;
        }

        sourceEdges.push(nodeNames[toIndex]);
    };

    switch (pattern) {
        case "chain":
            for (let index = 0; index < lastIndex; index += 1) {
                addEdge(index, index + 1);
            }
            break;
        case "ring":
            for (let index = 0; index < nodeNames.length; index += 1) {
                addEdge(index, (index + 1) % nodeNames.length);
            }
            break;
        case "star-out":
            for (let index = 1; index < nodeNames.length; index += 1) {
                addEdge(0, index);
            }
            break;
        case "star-in":
            for (let index = 1; index < nodeNames.length; index += 1) {
                addEdge(index, 0);
            }
            break;
        case "bridge": {
            const splitIndex = Math.floor(nodeNames.length / 2);
            for (let index = 0; index < splitIndex - 1; index += 1) {
                addEdge(index, index + 1);
            }
            addEdge(splitIndex - 1, 0);

            for (let index = splitIndex; index < lastIndex; index += 1) {
                addEdge(index, index + 1);
            }
            addEdge(lastIndex, splitIndex);
            addEdge(splitIndex - 1, splitIndex);
            break;
        }
        case "isolated":
            break;
        default:
            throw new Error(`Unsupported pattern: ${pattern}`);
    }

    if (nodeNames.length === 10 && pattern !== "isolated") {
        for (const targetIndex of [2, 4, 6, 8]) {
            addEdge(0, targetIndex);
        }

        addEdge(2, 5);
        addEdge(5, 8);
    }

    return edges;
}

function buildComponentDefinitions() {
    const definitions = [];

    const addPatternGroup = (size, pattern, count) => {
        for (let componentNumber = 1; componentNumber <= count; componentNumber += 1) {
            definitions.push({ size, pattern, componentNumber });
        }
    };

    for (const pattern of ["chain", "ring", "star-out", "star-in", "bridge"]) {
        addPatternGroup(30, pattern, 4);
        addPatternGroup(10, pattern, 4);
    }

    for (const pattern of ["chain", "ring", "star-out", "star-in"]) {
        addPatternGroup(3, pattern, 10);
    }

    addPatternGroup(1, "isolated", 80);
    return definitions;
}

function buildNoteBody({ nodeName, pattern, size, componentKey, nodeIndex, outgoingLinks }) {
    return [
        `# ${nodeName}`,
        "",
        "Synthetic SideNote2 graph fixture.",
        "",
        `Pattern: ${pattern}`,
        `Component: ${componentKey}`,
        `Component size: ${size}`,
        `Node: ${nodeIndex}/${size}`,
        `Outgoing links in side note: ${outgoingLinks.length}`,
    ].join("\n");
}

function buildCommentBody({ pattern, componentKey, size, outgoingLinks }) {
    const lines = [
        `Synthetic graph fixture for ${componentKey}.`,
        `Pattern: ${pattern}.`,
        `Connected component size: ${size}.`,
    ];

    if (outgoingLinks.length === 0) {
        lines.push("No outgoing wiki links from this note.");
        return lines.join("\n");
    }

    lines.push("Outgoing wiki links:");
    for (const linkTarget of outgoingLinks) {
        lines.push(`- [[${linkTarget}]]`);
    }

    return lines.join("\n");
}

async function main() {
    const repoRoot = getRepoRoot(import.meta.url);
    const vaultRoot = path.resolve(repoRoot, "..");
    const outputRoot = path.join(vaultRoot, "SideNote2 Graph Fixtures", "graph-1000");
    const { serializeNoteComments } = await loadStorageModule(repoRoot);
    const componentDefinitions = buildComponentDefinitions();
    let generatedNoteCount = 0;
    let timestamp = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (const definition of componentDefinitions) {
        const { size, pattern, componentNumber } = definition;
        const nodeNames = buildComponentNodeNames(size, pattern, componentNumber);
        const edges = buildEdges(nodeNames, pattern);
        const componentKey = `${pattern}-size-${size}-component-${String(componentNumber).padStart(2, "0")}`;
        const componentDir = path.join(outputRoot, `size-${size}`, pattern);

        await mkdir(componentDir, { recursive: true });

        for (const [index, nodeName] of nodeNames.entries()) {
            const fileName = `${nodeName}.md`;
            const absoluteFilePath = path.join(componentDir, fileName);
            const vaultRelativePath = normalizeVaultPath(path.relative(vaultRoot, absoluteFilePath));
            const outgoingLinks = edges.get(nodeName) ?? [];
            const selectedText = makePageCommentLabel(vaultRelativePath);
            const noteBody = buildNoteBody({
                nodeName,
                pattern,
                size,
                componentKey,
                nodeIndex: index + 1,
                outgoingLinks,
            });
            const serialized = serializeNoteComments(noteBody, [{
                id: `lg-${nodeName}`,
                filePath: vaultRelativePath,
                startLine: 0,
                startChar: 0,
                endLine: 0,
                endChar: 0,
                selectedText,
                selectedTextHash: makeHash(selectedText),
                comment: buildCommentBody({
                    pattern,
                    componentKey,
                    size,
                    outgoingLinks,
                }),
                timestamp,
                anchorKind: "page",
                orphaned: false,
                resolved: false,
            }]);

            await writeFile(absoluteFilePath, serialized, "utf8");
            generatedNoteCount += 1;
            timestamp += 1000;
        }
    }

    if (generatedNoteCount !== 1000) {
        throw new Error(`Expected to generate 1000 notes, generated ${generatedNoteCount}`);
    }

    process.stdout.write(
        [
            `Generated ${generatedNoteCount} notes in ${outputRoot}`,
            "Distribution:",
            "- 20 components of size 30",
            "- 20 components of size 10",
            "- 40 components of size 3",
            "- 80 isolated notes",
        ].join("\n") + "\n",
    );
}

void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
