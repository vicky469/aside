import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { FeatureFlag } from "../src/core/config/featureFlags";

const execFileAsync = promisify(execFile);

function scriptPath(): string {
	return path.join(process.cwd(), "scripts", "set-feature-flag.mjs");
}

async function readPluginData(vaultPath: string): Promise<Record<string, unknown>> {
	const dataPath = path.join(vaultPath, ".obsidian", "plugins", "aside", "data.json");
	return JSON.parse(await readFile(dataPath, "utf8")) as Record<string, unknown>;
}

test("set-feature-flag CLI creates plugin data and enables publish", async () => {
	const vaultPath = await mkdtemp(path.join(tmpdir(), "aside-feature-flag-"));
	try {
		await execFileAsync("node", [scriptPath(), "--vault", vaultPath, "--flag", FeatureFlag.publish, "--on"]);

		assert.deepEqual(await readPluginData(vaultPath), {
			featureFlags: {
				[FeatureFlag.publish]: true,
			},
		});
	} finally {
		await rm(vaultPath, { recursive: true, force: true });
	}
});

test("set-feature-flag CLI disables publish while preserving existing plugin data", async () => {
	const vaultPath = await mkdtemp(path.join(tmpdir(), "aside-feature-flag-"));
	try {
		const dataPath = path.join(vaultPath, ".obsidian", "plugins", "aside", "data.json");
		await mkdir(path.dirname(dataPath), { recursive: true });
		await writeFile(dataPath, JSON.stringify({
			indexNotePath: "Aside Index.md",
			featureFlags: {
				[FeatureFlag.publish]: true,
			},
		}), "utf8");

		await execFileAsync("node", [scriptPath(), "--vault", vaultPath, "--flag", FeatureFlag.publish, "--off"]);

		assert.deepEqual(await readPluginData(vaultPath), {
			indexNotePath: "Aside Index.md",
			featureFlags: {
				[FeatureFlag.publish]: false,
			},
		});
	} finally {
		await rm(vaultPath, { recursive: true, force: true });
	}
});
