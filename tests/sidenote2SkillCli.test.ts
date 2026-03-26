import * as assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("install-skill copies the canonical repo skill into the target Codex skills directory", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-skill-install-"));
    const skillsRoot = path.join(tempDir, "skills");
    const cliPath = path.resolve(process.cwd(), "bin/sidenote2.mjs");
    const sourceSkillDir = path.resolve(process.cwd(), "skills/side-note2-note-comments");

    const { stdout } = await execFile("node", [
        cliPath,
        "install-skill",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Installed skill side-note2-note-comments/);
    assert.match(stdout, /Restart Codex to pick up new skills/);

    const installedSkillDir = path.join(skillsRoot, "side-note2-note-comments");
    const installedSkillPath = path.join(installedSkillDir, "SKILL.md");
    const installedSkill = await readFile(installedSkillPath, "utf8");
    const sourceSkill = await readFile(path.join(sourceSkillDir, "SKILL.md"), "utf8");
    assert.equal(installedSkill, sourceSkill);

    const installedDirStat = await lstat(installedSkillDir);
    assert.equal(installedDirStat.isSymbolicLink(), false);
});

test("install-skill replaces an existing installed skill directory", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-skill-install-overwrite-"));
    const skillsRoot = path.join(tempDir, "skills");
    const installedSkillDir = path.join(skillsRoot, "side-note2-note-comments");
    const cliPath = path.resolve(process.cwd(), "bin/sidenote2.mjs");
    const sourceSkillPath = path.resolve(process.cwd(), "skills/side-note2-note-comments/SKILL.md");

    await mkdir(installedSkillDir, { recursive: true });
    await writeFile(path.join(installedSkillDir, "SKILL.md"), "stale", "utf8");

    await execFile("node", [
        cliPath,
        "install-skill",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    const installedSkill = await readFile(path.join(installedSkillDir, "SKILL.md"), "utf8");
    const sourceSkill = await readFile(sourceSkillPath, "utf8");
    assert.equal(installedSkill, sourceSkill);
});
