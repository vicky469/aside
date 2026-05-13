import * as assert from "node:assert/strict";
import test from "node:test";
import { sanitizeErrorForLog, sanitizeLogPayload } from "../src/logs/logSanitizer";

const context = {
    vaultRootPath: "/Users/tester/Vault",
    pluginDirPath: "/Users/tester/Vault/.obsidian/plugins/aside",
    pluginDirRelativePath: ".obsidian/plugins/aside",
};

test("sanitizeLogPayload scrubs absolute paths and omits disallowed raw-text fields", () => {
    const payload = sanitizeLogPayload({
        filePath: "/Users/tester/Vault/Folder/Note.md",
        logPath: "/Users/tester/Vault/.obsidian/plugins/aside/logs/2026-04-13.jsonl",
        noteContent: "# Hidden",
        comment: "Do not store this body",
        selectedText: "secret selection",
        nested: {
            path: "/Users/tester/Vault/Folder/Child.md",
            body: "remove me",
        },
        message: "Failed near /Users/tester/Vault/Folder/Note.md",
    }, context);

    assert.deepEqual(payload, {
        filePath: "Folder/Note.md",
        logPath: ".obsidian/plugins/aside/logs/2026-04-13.jsonl",
        nested: {
            path: "Folder/Child.md",
        },
        message: "Failed near Folder/Note.md",
    });
});

test("sanitizeErrorForLog keeps concise error metadata and removes absolute paths", () => {
    const payload = sanitizeErrorForLog(
        new Error("Unable to read /Users/tester/Vault/Folder/Note.md"),
        context,
    );

    assert.deepEqual(payload, {
        name: "Error",
        message: "Unable to read Folder/Note.md",
    });
});

test("sanitizeLogPayload redacts remote runtime credentials and strips url secrets", () => {
    const payload = sanitizeLogPayload({
        remoteRuntimeBearerToken: "secret-token",
        authorization: "Bearer secret-token",
        remoteRuntimeBaseUrl: "https://user:pass@remote.example.com/api?token=secret#frag",
        endpoint: "https://remote.example.com/v1/aside/runs?after=evt-9",
    }, context);

    assert.deepEqual(payload, {
        remoteRuntimeBaseUrl: "https://remote.example.com/api",
        endpoint: "https://remote.example.com/v1/aside/runs",
    });
});
