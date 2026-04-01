import * as assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("install-skill copies all bundled repo skills into the target Codex skills directory by default", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-skill-install-"));
    const skillsRoot = path.join(tempDir, "skills");
    const cliPath = path.resolve(process.cwd(), "bin/sidenote2.mjs");
    const sourceCommentSkillDir = path.resolve(process.cwd(), "skills/side-note2-note-comments");
    const sourceCanvasSkillDir = path.resolve(process.cwd(), "skills/canvas-design");

    const { stdout } = await execFile("node", [
        cliPath,
        "install-skill",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Installed skill side-note2-note-comments/);
    assert.match(stdout, /Installed skill canvas-design/);
    assert.match(stdout, /Restart Codex to pick up new skills/);

    const installedCommentSkillDir = path.join(skillsRoot, "side-note2-note-comments");
    const installedCommentSkill = await readFile(path.join(installedCommentSkillDir, "SKILL.md"), "utf8");
    const sourceCommentSkill = await readFile(path.join(sourceCommentSkillDir, "SKILL.md"), "utf8");
    assert.equal(installedCommentSkill, sourceCommentSkill);

    const installedCanvasSkillDir = path.join(skillsRoot, "canvas-design");
    const installedCanvasSkill = await readFile(path.join(installedCanvasSkillDir, "SKILL.md"), "utf8");
    const sourceCanvasSkill = await readFile(path.join(sourceCanvasSkillDir, "SKILL.md"), "utf8");
    assert.equal(installedCanvasSkill, sourceCanvasSkill);
    await assert.rejects(access(path.join(installedCanvasSkillDir, "canvas-fonts")));

    const installedDirStat = await lstat(installedCommentSkillDir);
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
        "--name",
        "side-note2-note-comments",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    const installedSkill = await readFile(path.join(installedSkillDir, "SKILL.md"), "utf8");
    const sourceSkill = await readFile(sourceSkillPath, "utf8");
    assert.equal(installedSkill, sourceSkill);
});

test("install-skill can install a named bundled skill", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "sidenote2-skill-install-named-"));
    const skillsRoot = path.join(tempDir, "skills");
    const cliPath = path.resolve(process.cwd(), "bin/sidenote2.mjs");

    const { stdout } = await execFile("node", [
        cliPath,
        "install-skill",
        "--name",
        "canvas-design",
        "--dest",
        skillsRoot,
    ], {
        cwd: process.cwd(),
    });

    assert.match(stdout, /Installed skill canvas-design/);

    const installedCanvasSkill = await readFile(path.join(skillsRoot, "canvas-design", "SKILL.md"), "utf8");
    const sourceCanvasSkill = await readFile(path.resolve(process.cwd(), "skills/canvas-design/SKILL.md"), "utf8");
    assert.equal(installedCanvasSkill, sourceCanvasSkill);

    await assert.rejects(access(path.join(skillsRoot, "side-note2-note-comments", "SKILL.md")));
});
