import * as assert from "node:assert/strict";
import test from "node:test";
import {
    VaultAgentsFileController,
    buildVaultAgentsFileContent,
    planVaultAgentsFileRemoval,
    planVaultAgentsFileSync,
} from "../src/control/vaultAgentsFileController";

const baseContext = {
    vaultName: "public",
    vaultRootPath: "/home/bun/Documents/public",
    pluginVersion: "2.0.3",
} as const;

test("buildVaultAgentsFileContent includes managed markers plus the active vault name and path", () => {
    const content = buildVaultAgentsFileContent(baseContext);

    assert.match(content, /<!-- SideNote2 managed AGENTS start version="2\.0\.3" -->/);
    assert.match(content, /This Obsidian vault is `public`\./);
    assert.match(content, /Vault root path: `\/home\/bun\/Documents\/public`\./);
    assert.match(content, /If the `sidenote2` skill is already installed in the current assistant, use it for:/);
    assert.match(content, /obsidian:\/\/side-note2-comment\?\.\.\./);
    assert.match(content, /append to the existing thread/);
    assert.match(content, /mark the targeted thread resolved/);
    assert.match(content, /replace the targeted stored comment body/);
    assert.match(content, /<!-- SideNote2 managed AGENTS end -->/);
});

test("planVaultAgentsFileSync creates a managed file when AGENTS.md is missing", () => {
    const plan = planVaultAgentsFileSync(null, baseContext, "startup");

    assert.deepEqual(plan, {
        kind: "write",
        nextContent: buildVaultAgentsFileContent(baseContext),
        reason: "created",
    });
});

test("planVaultAgentsFileSync updates an existing managed block in place", () => {
    const previousContext = {
        ...baseContext,
        pluginVersion: "2.0.2",
    };
    const existingContent = [
        "# User Vault Rules",
        "",
        "Keep answers short.",
        "",
        buildVaultAgentsFileContent(previousContext).trimEnd(),
        "",
        "## Extra",
        "",
        "- Never touch archives.",
        "",
    ].join("\n");

    const plan = planVaultAgentsFileSync(existingContent, baseContext, "startup");

    if (plan.kind !== "write") {
        throw new Error("expected a write plan");
    }
    assert.equal(plan.reason, "updated");
    assert.match(plan.nextContent, /# User Vault Rules/);
    assert.match(plan.nextContent, /version="2\.0\.3"/);
    assert.doesNotMatch(plan.nextContent, /version="2\.0\.2"/);
    assert.match(plan.nextContent, /## Extra/);
});

test("planVaultAgentsFileSync inserts a managed block into an unmanaged AGENTS.md on startup", () => {
    const plan = planVaultAgentsFileSync("# User AGENTS\n\nDo not modify this file.\n", baseContext, "startup");

    if (plan.kind !== "write") {
        throw new Error("expected a write plan");
    }
    assert.equal(plan.reason, "inserted");
    assert.match(plan.nextContent, /^# User AGENTS/m);
    assert.match(plan.nextContent, /Do not modify this file\./);
    assert.match(plan.nextContent, /<!-- SideNote2 managed AGENTS start version="2\.0\.3" -->/);
});

test("planVaultAgentsFileSync inserts a managed block into an unmanaged AGENTS.md for manual install", () => {
    const plan = planVaultAgentsFileSync("# User AGENTS\n\nDo not modify this file.\n", baseContext, "manual");

    if (plan.kind !== "write") {
        throw new Error("expected a write plan");
    }
    assert.equal(plan.reason, "inserted");
    assert.match(plan.nextContent, /^# User AGENTS/m);
    assert.match(plan.nextContent, /Do not modify this file\./);
    assert.match(plan.nextContent, /<!-- SideNote2 managed AGENTS start version="2\.0\.3" -->/);
});

test("planVaultAgentsFileRemoval removes a managed block but preserves unrelated AGENTS content", () => {
    const existingContent = `# User Rules\n\nKeep answers brief.\n\n${buildVaultAgentsFileContent(baseContext)}`;
    const plan = planVaultAgentsFileRemoval(existingContent);

    assert.equal(plan.kind, "write");
    if (plan.kind !== "write") {
        throw new Error("expected a write plan");
    }
    assert.match(plan.nextContent, /# User Rules/);
    assert.match(plan.nextContent, /Keep answers brief\./);
    assert.doesNotMatch(plan.nextContent, /SideNote2 Vault Agent Routing/);
});

test("planVaultAgentsFileRemoval deletes AGENTS.md when only SideNote2-managed content exists", () => {
    const plan = planVaultAgentsFileRemoval(buildVaultAgentsFileContent(baseContext));

    assert.deepEqual(plan, { kind: "delete" });
});

test("vault agents file controller installs AGENTS.md into the vault root and reports the resolved path", async () => {
    let writtenPath = "";
    let writtenContent = "";
    let notice = "";

    const controller = new VaultAgentsFileController({
        getVaultAgentsFileContext: () => baseContext,
        vaultRootFileExists: async () => false,
        readVaultRootFile: async () => {
            throw new Error("should not read missing AGENTS.md");
        },
        writeVaultRootFile: async (relativePath, content) => {
            writtenPath = relativePath;
            writtenContent = content;
        },
        deleteVaultRootFile: async () => {
            throw new Error("should not delete on install");
        },
        showNotice: (message) => {
            notice = message;
        },
        warn: () => {},
    });

    await controller.installVaultAgentsFile();

    assert.equal(writtenPath, "AGENTS.md");
    assert.equal(writtenContent, buildVaultAgentsFileContent(baseContext));
    assert.equal(notice, "Installed AGENTS.md in /home/bun/Documents/public/AGENTS.md");
});

test("vault agents file controller appends a managed block into an existing unmanaged AGENTS.md on manual install", async () => {
    let writtenContent = "";
    let notice = "";

    const controller = new VaultAgentsFileController({
        getVaultAgentsFileContext: () => baseContext,
        vaultRootFileExists: async () => true,
        readVaultRootFile: async () => "# User AGENTS\n\nDo not modify this file.\n",
        writeVaultRootFile: async (_relativePath, content) => {
            writtenContent = content;
        },
        deleteVaultRootFile: async () => {
            throw new Error("should not delete on insert");
        },
        showNotice: (message) => {
            notice = message;
        },
        warn: () => {},
    });

    await controller.installVaultAgentsFile();

    assert.match(writtenContent, /# User AGENTS/);
    assert.match(writtenContent, /<!-- SideNote2 managed AGENTS start version="2\.0\.3" -->/);
    assert.equal(notice, "Inserted SideNote2 AGENTS instructions into existing /home/bun/Documents/public/AGENTS.md");
});

test("vault agents file controller inserts a managed block into an unmanaged AGENTS.md during startup sync", async () => {
    let writtenContent = "";
    let noticeCount = 0;

    const controller = new VaultAgentsFileController({
        getVaultAgentsFileContext: () => baseContext,
        vaultRootFileExists: async () => true,
        readVaultRootFile: async () => "# User AGENTS\n\nDo not modify this file.\n",
        writeVaultRootFile: async (_relativePath, content) => {
            writtenContent = content;
        },
        deleteVaultRootFile: async () => {
            throw new Error("should not delete when content remains");
        },
        showNotice: () => {
            noticeCount += 1;
        },
        warn: () => {},
    });

    await controller.syncVaultAgentsFileOnStartup();

    assert.match(writtenContent, /# User AGENTS/);
    assert.match(writtenContent, /<!-- SideNote2 managed AGENTS start version="2\.0\.3" -->/);
    assert.equal(noticeCount, 0);
});

test("vault agents file controller removes the SideNote2-managed block and keeps unrelated AGENTS content", async () => {
    let writtenContent = "";
    let notice = "";

    const controller = new VaultAgentsFileController({
        getVaultAgentsFileContext: () => baseContext,
        vaultRootFileExists: async () => true,
        readVaultRootFile: async () => `# User Rules\n\nKeep answers brief.\n\n${buildVaultAgentsFileContent(baseContext)}`,
        writeVaultRootFile: async (_relativePath, content) => {
            writtenContent = content;
        },
        deleteVaultRootFile: async () => {
            throw new Error("should not delete when unrelated content remains");
        },
        showNotice: (message) => {
            notice = message;
        },
        warn: () => {},
    });

    await controller.uninstallVaultAgentsFile();

    assert.match(writtenContent, /# User Rules/);
    assert.match(writtenContent, /Keep answers brief\./);
    assert.doesNotMatch(writtenContent, /SideNote2 Vault Agent Routing/);
    assert.equal(notice, "Removed SideNote2 AGENTS instructions from /home/bun/Documents/public/AGENTS.md");
});

test("vault agents file controller deletes AGENTS.md when only SideNote2-managed content exists during uninstall", async () => {
    let deletedPath = "";
    let notice = "";

    const controller = new VaultAgentsFileController({
        getVaultAgentsFileContext: () => baseContext,
        vaultRootFileExists: async () => true,
        readVaultRootFile: async () => buildVaultAgentsFileContent(baseContext),
        writeVaultRootFile: async () => {
            throw new Error("should not write when delete is enough");
        },
        deleteVaultRootFile: async (relativePath) => {
            deletedPath = relativePath;
        },
        showNotice: (message) => {
            notice = message;
        },
        warn: () => {},
    });

    await controller.uninstallVaultAgentsFile();

    assert.equal(deletedPath, "AGENTS.md");
    assert.equal(notice, "Removed SideNote2 AGENTS.md from /home/bun/Documents/public/AGENTS.md");
});
