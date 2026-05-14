import * as assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { syncInstalledCodexSkill, type CodexSkillSyncModules } from "../src/core/codexSkillSync";

function createModules(homeDirectory: string): CodexSkillSyncModules {
    return {
        fsPromises: {
            access,
            readFile,
            writeFile,
        },
        os: {
            homedir: () => homeDirectory,
        },
        path,
    };
}

test("syncInstalledCodexSkill skips when the skill is not installed", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "aside-codex-home-missing-"));
    const skillFile = path.join(codexHome, "skills", "aside", "SKILL.md");
    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "aside",
        skillContent: "next skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: null,
    });

    assert.equal(result.kind, "not-installed");
    await assert.rejects(access(skillFile));
});

test("syncInstalledCodexSkill updates an installed stale skill without deleting unrelated files", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "aside-codex-home-stale-"));
    const skillDir = path.join(codexHome, "skills", "aside");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, "stale", "utf8");
    await writeFile(path.join(skillDir, "extra.txt"), "old", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "aside",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: "2.0.43",
    });

    assert.equal(result.kind, "updated");
    assert.equal(await readFile(skillFile, "utf8"), "fresh skill body");
    assert.equal(await readFile(path.join(skillDir, "extra.txt"), "utf8"), "old");
});

test("syncInstalledCodexSkill does not install Aside when only the legacy SideNote2 skill exists", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "aside-codex-home-legacy-"));
    const legacySkillDir = path.join(codexHome, "skills", "sidenote2");
    const skillDir = path.join(codexHome, "skills", "aside");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(legacySkillDir, { recursive: true });
    await writeFile(path.join(legacySkillDir, "SKILL.md"), "legacy body", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "aside",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.64",
        previouslySyncedPluginVersion: "2.0.64",
    });

    assert.equal(result.kind, "not-installed");
    await assert.rejects(access(skillFile));
    assert.equal(await readFile(path.join(legacySkillDir, "SKILL.md"), "utf8"), "legacy body");
});

test("syncInstalledCodexSkill recognizes when the installed skill already matches the bundled content", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "aside-codex-home-current-"));
    const skillDir = path.join(codexHome, "skills", "aside");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, "fresh skill body", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "aside",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: "2.0.43",
    });

    assert.equal(result.kind, "current");
    assert.equal(await readFile(skillFile, "utf8"), "fresh skill body");
});

test("syncInstalledCodexSkill skips once the current plugin version has already synced", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "aside-codex-home-synced-"));
    const skillDir = path.join(codexHome, "skills", "aside");
    const skillFile = path.join(skillDir, "SKILL.md");

    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, "user custom body", "utf8");

    const result = await syncInstalledCodexSkill({
        modules: createModules("/Users/ignored"),
        env: { CODEX_HOME: codexHome },
        skillName: "aside",
        skillContent: "fresh skill body",
        pluginVersion: "2.0.44",
        previouslySyncedPluginVersion: "2.0.44",
    });

    assert.equal(result.kind, "already-synced");
    assert.equal(await readFile(skillFile, "utf8"), "user custom body");
});
