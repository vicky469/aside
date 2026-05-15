import * as assert from "node:assert/strict";
import test from "node:test";
import {
    resolveWorkspaceLeafFile,
    resolveWorkspaceLeafTargetInput,
} from "../src/app/workspaceContextPlanner";

interface MockFile {
    path: string;
    basename: string;
    extension: string;
}

function createFile(path: string): MockFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    };
}

test("workspace leaf file resolution keeps unsupported file-like views visible to target planning", () => {
    const pdfFile = createFile("docs/paper.pdf");

    const resolved = resolveWorkspaceLeafFile({
        view: {
            file: pdfFile,
            getViewType: () => "pdf",
        },
    }, (value): value is MockFile =>
        !!value
        && typeof value === "object"
        && typeof (value as MockFile).path === "string"
        && typeof (value as MockFile).extension === "string",
    );

    assert.equal(resolved, pdfFile);
});

test("workspace leaf target does not fall back to the last markdown file for unsupported file views", () => {
    const markdownFile = createFile("docs/note.md");
    const pdfFile = createFile("docs/paper.pdf");

    const resolved = resolveWorkspaceLeafTargetInput(
        {
            view: {
                file: pdfFile,
                getViewType: () => "pdf",
            },
        },
        markdownFile,
        (value): value is MockFile => value === markdownFile,
    );

    assert.equal(resolved, null);
});

test("workspace leaf target resolves a pending file from the leaf view state", () => {
    const previousFile = createFile("docs/previous.md");
    const currentFile = createFile("docs/current.md");

    const resolved = resolveWorkspaceLeafTargetInput(
        {
            view: {
                getViewType: () => "markdown",
            },
            getViewState: () => ({
                type: "markdown",
                state: {
                    file: currentFile.path,
                },
            }),
        },
        previousFile,
        (value): value is MockFile => value === currentFile,
        (path) => path === currentFile.path ? currentFile : null,
    );

    assert.equal(resolved, currentFile);
});

test("workspace leaf target prefers view state when the leaf view still has the previous file", () => {
    const previousFile = createFile("docs/previous.md");
    const currentFile = createFile("docs/current.md");

    const resolved = resolveWorkspaceLeafTargetInput(
        {
            view: {
                file: previousFile,
                getViewType: () => "markdown",
            },
            getViewState: () => ({
                type: "markdown",
                state: {
                    file: currentFile.path,
                },
            }),
        },
        previousFile,
        (value): value is MockFile => value === previousFile || value === currentFile,
        (path) => path === currentFile.path ? currentFile : null,
    );

    assert.equal(resolved, currentFile);
});

test("workspace leaf target ignores leaf changes that temporarily have no file value", () => {
    const markdownFile = createFile("docs/note.md");

    const resolved = resolveWorkspaceLeafTargetInput(
        {
            view: {
                getViewType: () => "markdown",
            },
        },
        markdownFile,
        (value): value is MockFile => value === markdownFile,
    );

    assert.equal(resolved, null);
});
