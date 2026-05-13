#!/usr/bin/env node

import { mkdir, readFile, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const shippedArtifacts = ["main.js", "manifest.json", "styles.css"];

function printUsage() {
    console.error("Usage: node scripts/install-built-plugin.mjs --vault \"/path/to/vault\" [--plugin-id aside]");
}

function parseArgs(argv) {
    let vaultPath = "";
    let pluginId = "";

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--vault") {
            vaultPath = argv[index + 1] ?? "";
            index += 1;
            continue;
        }

        if (arg === "--plugin-id") {
            pluginId = argv[index + 1] ?? "";
            index += 1;
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (!vaultPath) {
        throw new Error("Missing required --vault argument.");
    }

    return {
        vaultPath: path.resolve(vaultPath),
        pluginId: pluginId.trim(),
    };
}

async function resolvePluginId(explicitPluginId) {
    if (explicitPluginId) {
        return explicitPluginId;
    }

    const manifestPath = path.join(repoRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest?.id || typeof manifest.id !== "string") {
        throw new Error("manifest.json is missing a valid plugin id.");
    }

    return manifest.id.trim();
}

async function ensureDirectoryExists(directoryPath, description) {
    try {
        const target = await stat(directoryPath);
        if (!target.isDirectory()) {
            throw new Error(`${description} exists but is not a directory: ${directoryPath}`);
        }
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            throw new Error(`${description} does not exist: ${directoryPath}`);
        }

        throw error;
    }
}

async function ensureArtifactsExist() {
    for (const artifact of shippedArtifacts) {
        const artifactPath = path.join(repoRoot, artifact);
        try {
            const target = await stat(artifactPath);
            if (!target.isFile()) {
                throw new Error();
            }
        } catch {
            throw new Error(`Missing built artifact: ${artifactPath}. Run npm run build first.`);
        }
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const pluginId = await resolvePluginId(options.pluginId);

    await ensureDirectoryExists(options.vaultPath, "Vault path");
    await ensureArtifactsExist();

    const pluginsRoot = path.join(options.vaultPath, ".obsidian", "plugins");
    const targetPluginDir = path.join(pluginsRoot, pluginId);

    await mkdir(targetPluginDir, { recursive: true });

    for (const artifact of shippedArtifacts) {
        await copyFile(
            path.join(repoRoot, artifact),
            path.join(targetPluginDir, artifact),
        );
    }

    console.log(`Installed ${pluginId} build into ${targetPluginDir}`);
    console.log("Copied: main.js, manifest.json, styles.css");
}

await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    printUsage();
    process.exit(1);
});
