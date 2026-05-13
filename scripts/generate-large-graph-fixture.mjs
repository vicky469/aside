#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    loadThreadsWithFallback,
    readSidecar,
    stripLegacyBlockIfNeeded,
    writeSidecar,
} from "./lib/asideRepoScripts.mjs";

function getRepoRoot(metaUrl) {
    return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
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
        "Synthetic Aside graph fixture.",
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

function parseArgs(argv) {
    const options = {
        vaultRoot: null,
        limit: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--vault-root") {
            const value = argv[index + 1];
            if (!value) {
                throw new Error("Missing value for --vault-root");
            }
            options.vaultRoot = path.resolve(value);
            index += 1;
            continue;
        }

        if (arg === "--limit") {
            const value = argv[index + 1];
            const parsedValue = value ? Number.parseInt(value, 10) : Number.NaN;
            if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
                throw new Error("Expected a positive integer for --limit");
            }
            options.limit = parsedValue;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function buildSyntheticThread({
    vaultRelativePath,
    nodeName,
    pattern,
    componentKey,
    size,
    outgoingLinks,
    timestamp,
}) {
    const selectedText = makePageCommentLabel(vaultRelativePath);
    const body = buildCommentBody({
        pattern,
        componentKey,
        size,
        outgoingLinks,
    });

    return {
        id: `lg-${nodeName}`,
        filePath: vaultRelativePath,
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText,
        selectedTextHash: makeHash(selectedText),
        anchorKind: "page",
        orphaned: false,
        resolved: false,
        entries: [{
            id: `lg-${nodeName}`,
            body,
            timestamp,
        }],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function mergeSyntheticThread(existingThreads, syntheticThread) {
    const existingThread = existingThreads.find((thread) => thread.id === syntheticThread.id);
    if (!existingThread) {
        return existingThreads.concat({
            ...syntheticThread,
            entries: syntheticThread.entries.map((entry) => ({ ...entry })),
        });
    }

    const [syntheticEntry] = syntheticThread.entries;
    const [existingFirstEntry, ...existingReplyEntries] = existingThread.entries;

    return existingThreads.map((thread) => {
        if (thread.id !== syntheticThread.id) {
            return {
                ...thread,
                entries: thread.entries.map((entry) => ({ ...entry })),
            };
        }

        const mergedEntries = [{
            id: existingFirstEntry?.id ?? syntheticEntry.id,
            body: syntheticEntry.body,
            timestamp: existingFirstEntry?.timestamp ?? syntheticEntry.timestamp,
        }].concat(existingReplyEntries.map((entry) => ({ ...entry })));

        return {
            ...existingThread,
            filePath: syntheticThread.filePath,
            startLine: syntheticThread.startLine,
            startChar: syntheticThread.startChar,
            endLine: syntheticThread.endLine,
            endChar: syntheticThread.endChar,
            selectedText: syntheticThread.selectedText,
            selectedTextHash: syntheticThread.selectedTextHash,
            anchorKind: syntheticThread.anchorKind,
            orphaned: false,
            entries: mergedEntries,
            createdAt: existingThread.createdAt || mergedEntries[0].timestamp,
            updatedAt: Math.max(
                existingThread.updatedAt || 0,
                ...mergedEntries.map((entry) => entry.timestamp),
            ),
        };
    });
}

async function main() {
    const repoRoot = getRepoRoot(import.meta.url);
    const options = parseArgs(process.argv.slice(2));
    const vaultRoot = options.vaultRoot ?? path.resolve(repoRoot, "..");
    const outputRoot = path.join(vaultRoot, "Aside Graph Fixtures", "graph-1000");
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
            if (options.limit !== null && generatedNoteCount >= options.limit) {
                break;
            }

            const fileName = `${nodeName}.md`;
            const absoluteFilePath = path.join(componentDir, fileName);
            const vaultRelativePath = normalizeVaultPath(path.relative(vaultRoot, absoluteFilePath));
            const outgoingLinks = edges.get(nodeName) ?? [];
            const noteBody = buildNoteBody({
                nodeName,
                pattern,
                size,
                componentKey,
                nodeIndex: index + 1,
                outgoingLinks,
            });
            const syntheticThread = buildSyntheticThread({
                vaultRelativePath,
                nodeName,
                pattern,
                componentKey,
                size,
                outgoingLinks,
                timestamp,
            });

            let existingThreads = [];
            let noteContent = null;
            let hadLegacyBlock = false;
            try {
                const fallback = await loadThreadsWithFallback(vaultRoot, absoluteFilePath, vaultRelativePath);
                existingThreads = fallback.threads;
                noteContent = fallback.noteContent;
                hadLegacyBlock = fallback.hadLegacyBlock;
            } catch (error) {
                if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
                    existingThreads = [];
                } else {
                    throw error;
                }
            }

            const mergedThreads = mergeSyntheticThread(existingThreads, syntheticThread);
            await writeFile(absoluteFilePath, noteBody, "utf8");
            await writeSidecar(vaultRoot, vaultRelativePath, mergedThreads);

            if (hadLegacyBlock && noteContent) {
                await stripLegacyBlockIfNeeded(vaultRoot, absoluteFilePath, vaultRelativePath, noteContent, hadLegacyBlock, 0);
            }

            generatedNoteCount += 1;
            timestamp += 1000;
        }

        if (options.limit !== null && generatedNoteCount >= options.limit) {
            break;
        }
    }

    if (options.limit === null && generatedNoteCount !== 1000) {
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
