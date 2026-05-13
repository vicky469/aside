import * as assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("install-bundled-skill script copies all bundled repo skills into the target Codex skills directory by default", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-skill-install-"));
    const skillsRoot = path.join(tempDir, "skills");
    const scriptPath = path.resolve(process.cwd(), "scripts/install-bundled-skill.mjs");
    const sourceSidenoteSkillDir = path.resolve(process.cwd(), "skills/aside");
    const sourceCanvasSkillDir = path.resolve(process.cwd(), "skills/canvas-design");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Installed skill aside/);
    assert.match(stdout, /Installed skill canvas-design/);
    assert.match(stdout, /Restart Codex to pick up new skills/);

    const installedSidenoteSkillDir = path.join(skillsRoot, "aside");
    const installedSidenoteSkill = await readFile(path.join(installedSidenoteSkillDir, "SKILL.md"), "utf8");
    const sourceSidenoteSkill = await readFile(path.join(sourceSidenoteSkillDir, "SKILL.md"), "utf8");
    assert.equal(installedSidenoteSkill, sourceSidenoteSkill);

    const installedCanvasSkillDir = path.join(skillsRoot, "canvas-design");
    const installedCanvasSkill = await readFile(path.join(installedCanvasSkillDir, "SKILL.md"), "utf8");
    const sourceCanvasSkill = await readFile(path.join(sourceCanvasSkillDir, "SKILL.md"), "utf8");
    assert.equal(installedCanvasSkill, sourceCanvasSkill);
    await assert.rejects(access(path.join(installedCanvasSkillDir, "canvas-fonts")));

    const installedDirStat = await lstat(installedSidenoteSkillDir);
    assert.equal(installedDirStat.isSymbolicLink(), false);
});

test("install-bundled-skill script replaces an existing installed skill directory", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-skill-install-overwrite-"));
    const skillsRoot = path.join(tempDir, "skills");
    const installedSkillDir = path.join(skillsRoot, "aside");
    const scriptPath = path.resolve(process.cwd(), "scripts/install-bundled-skill.mjs");
    const sourceSkillPath = path.resolve(process.cwd(), "skills/aside/SKILL.md");

    await mkdir(installedSkillDir, { recursive: true });
    await writeFile(path.join(installedSkillDir, "SKILL.md"), "stale", "utf8");

    await execFile("node", [
        scriptPath,
        "--name",
        "aside",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    const installedSkill = await readFile(path.join(installedSkillDir, "SKILL.md"), "utf8");
    const sourceSkill = await readFile(sourceSkillPath, "utf8");
    assert.equal(installedSkill, sourceSkill);
});

test("install-bundled-skill script can install a named bundled skill", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "aside-skill-install-named-"));
    const skillsRoot = path.join(tempDir, "skills");
    const scriptPath = path.resolve(process.cwd(), "scripts/install-bundled-skill.mjs");

    const { stdout } = await execFile("node", [
        scriptPath,
        "--name",
        "aside",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Installed skill aside/);

    const installedSidenoteSkill = await readFile(path.join(skillsRoot, "aside", "SKILL.md"), "utf8");
    const sourceSidenoteSkill = await readFile(path.resolve(process.cwd(), "skills/aside/SKILL.md"), "utf8");
    assert.equal(installedSidenoteSkill, sourceSidenoteSkill);

    await assert.rejects(access(path.join(skillsRoot, "canvas-design", "SKILL.md")));
});
