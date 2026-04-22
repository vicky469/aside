import * as assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { syncInstalledCodexSkill, type CodexSkillSyncModules } from "../src/core/codexSkillSync";

function createModules(homeDirectory: string): CodexSkillSyncModules {
    return {
        fsPromises: {
            access,
            mkdir,
            readFile,
            rm,
            writeFile,
        },
        os: {
            homedir: () => homeDirectory,
        },
        path,
    };
}

test("syncInstalledCodexSkill skips when the skill is not installed", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "sidenote2-codex-home-missing-"));
    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "sidenote2",
        skillContent: "next skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: null,
    });

    assert.equal(result.kind, "not-installed");
    await assert.rejects(access(path.join(codexHome, "skills", "sidenote2", "SKILL.md")));
});

test("syncInstalledCodexSkill updates an installed stale skill without deleting unrelated files", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "sidenote2-codex-home-stale-"));
    const skillDir = path.join(codexHome, "skills", "sidenote2");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, "stale", "utf8");
    await writeFile(path.join(skillDir, "extra.txt"), "old", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "sidenote2",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: "2.0.43",
    });

    assert.equal(result.kind, "updated");
    assert.equal(await readFile(skillFile, "utf8"), "fresh skill body");
    assert.equal(await readFile(path.join(skillDir, "extra.txt"), "utf8"), "old");
});

test("syncInstalledCodexSkill recognizes when the installed skill already matches the bundled content", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "sidenote2-codex-home-current-"));
    const skillDir = path.join(codexHome, "skills", "sidenote2");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, "fresh skill body", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "sidenote2",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: "2.0.43",
    });

    assert.equal(result.kind, "current");
    assert.equal(await readFile(skillFile, "utf8"), "fresh skill body");
});

test("syncInstalledCodexSkill skips once the current plugin version has already synced", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "sidenote2-codex-home-synced-"));
    const skillDir = path.join(codexHome, "skills", "sidenote2");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, "user custom body", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "sidenote2",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: "2.0.44",
    });

    assert.equal(result.kind, "already-synced");
    assert.equal(await readFile(skillFile, "utf8"), "user custom body");
});
