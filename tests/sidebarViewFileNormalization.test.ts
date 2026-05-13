import * as assert from "node:assert/strict";
import test from "node:test";
import { normalizeSidebarViewFile } from "../src/ui/views/sidebarViewFileState";

type MockFile = {
    path: string;
    extension: string;
};

test("normalizeSidebarViewFile keeps markdown and index files but drops unsupported files", () => {
    const markdownFile: MockFile = { path: "Folder/Note.md", extension: "md" };
    const pdfFile: MockFile = { path: "Folder/Scan.pdf", extension: "pdf" };
    const indexFile: MockFile = { path: "Aside index.md", extension: "md" };
    const isSidebarSupportedFile = (file: MockFile | null): file is MockFile =>
        !!file && (file.extension === "md" || file.path === "Aside index.md");

    assert.equal(normalizeSidebarViewFile(markdownFile, isSidebarSupportedFile), markdownFile);
    assert.equal(normalizeSidebarViewFile(indexFile, isSidebarSupportedFile), indexFile);
    assert.equal(normalizeSidebarViewFile(pdfFile, isSidebarSupportedFile), null);
    assert.equal(normalizeSidebarViewFile(null, isSidebarSupportedFile), null);
});
