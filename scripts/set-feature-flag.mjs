#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const KNOWN_FEATURE_FLAGS = new Set(["publish"]);

function printUsage() {
	process.stderr.write([
		"Usage: node scripts/set-feature-flag.mjs --vault <vault-path> --flag publish (--on|--off) [--plugin-id aside]",
		"",
		"Examples:",
		"  node scripts/set-feature-flag.mjs --vault /path/to/vault --flag publish --on",
		"  npm run feature:flag -- --vault /path/to/vault --flag publish --off",
		"",
	].join("\n"));
}

function readOption(args, index, name) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${name}`);
	}
	return value;
}

function parseArgs(args) {
	const options = {
		pluginId: "aside",
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--vault":
				options.vaultPath = readOption(args, index, arg);
				index += 1;
				break;
			case "--flag":
				options.flag = readOption(args, index, arg);
				index += 1;
				break;
			case "--plugin-id":
				options.pluginId = readOption(args, index, arg);
				index += 1;
				break;
			case "--on":
				if (options.enabled !== undefined) {
					throw new Error("Use only one of --on or --off");
				}
				options.enabled = true;
				break;
			case "--off":
				if (options.enabled !== undefined) {
					throw new Error("Use only one of --on or --off");
				}
				options.enabled = false;
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!options.vaultPath) {
		throw new Error("Missing --vault");
	}
	if (!options.flag) {
		throw new Error("Missing --flag");
	}
	if (!KNOWN_FEATURE_FLAGS.has(options.flag)) {
		throw new Error(`Unknown feature flag: ${options.flag}`);
	}
	if (options.enabled === undefined) {
		throw new Error("Missing --on or --off");
	}
	return options;
}

async function readPluginData(dataPath) {
	try {
		const raw = await readFile(dataPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Aside plugin data must be a JSON object");
		}
		return parsed;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

function normalizeFeatureFlags(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}

async function assertVaultDirectory(vaultPath) {
	const vaultStat = await stat(vaultPath);
	if (!vaultStat.isDirectory()) {
		throw new Error(`Vault path is not a directory: ${vaultPath}`);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const vaultPath = path.resolve(options.vaultPath);
	await assertVaultDirectory(vaultPath);

	const pluginDir = path.join(vaultPath, ".obsidian", "plugins", options.pluginId);
	const dataPath = path.join(pluginDir, "data.json");
	const data = await readPluginData(dataPath);
	data.featureFlags = {
		...normalizeFeatureFlags(data.featureFlags),
		[options.flag]: options.enabled,
	};

	await mkdir(pluginDir, { recursive: true });
	await writeFile(dataPath, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
	process.stdout.write(`Set ${options.flag}=${String(options.enabled)} in ${dataPath}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
	printUsage();
	process.exit(1);
});
