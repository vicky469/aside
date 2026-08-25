import * as assert from "node:assert/strict";
import test from "node:test";
import { normalizeSidebarViewFile } from "../src/ui/views/sidebarViewFileState";

type MockFile = {
    path: string;
    extension: string;
};

test("normalizeSidebarViewFile keeps every non-null file and clears null", () => {
    const markdownFile: MockFile = { path: "Folder/Note.md", extension: "md" };
    const pdfFile: MockFile = { path: "Folder/Scan.pdf", extension: "pdf" };
    const imageFile: MockFile = { path: "Folder/Diagram.png", extension: "png" };
    const canvasFile: MockFile = { path: "Folder/Board.canvas", extension: "canvas" };
    const indexFile: MockFile = { path: "Aside index.md", extension: "md" };
    const docxFile: MockFile = { path: "Folder/Proposal.docx", extension: "docx" };
    const isSidebarSupportedFile = (file: MockFile | null): file is MockFile =>
        !!file;

    assert.equal(normalizeSidebarViewFile(markdownFile, isSidebarSupportedFile), markdownFile);
    assert.equal(normalizeSidebarViewFile(indexFile, isSidebarSupportedFile), indexFile);
    assert.equal(normalizeSidebarViewFile(pdfFile, isSidebarSupportedFile), pdfFile);
    assert.equal(normalizeSidebarViewFile(imageFile, isSidebarSupportedFile), imageFile);
    assert.equal(normalizeSidebarViewFile(canvasFile, isSidebarSupportedFile), canvasFile);
    assert.equal(normalizeSidebarViewFile(docxFile, isSidebarSupportedFile), docxFile);
    assert.equal(normalizeSidebarViewFile(null, isSidebarSupportedFile), null);
});
