import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REQUIRED_MANIFEST_FIELDS = [
    "id",
    "name",
    "version",
    "minAppVersion",
    "description",
    "author",
    "isDesktopOnly",
];
const REQUIRED_FILES = [
    "README.md",
    "LICENSE",
    "manifest.json",
    "styles.css",
    "versions.json",
];
const REQUIRED_DISCLOSURES = [
    "## Network access",
    "## Local vault indexing",
    "## Clipboard access",
    "## External services",
];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const REQUEST_LITERAL_HOST_PATTERN = /(?:fetch|request|WebSocket)\s*\(\s*["'`]https?:\/\/([a-z0-9.-]+)(?=[/:)'"`\s]|$)/giu;

function readText(rootDir, relativePath) {
    return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function readJson(rootDir, relativePath) {
    return JSON.parse(readText(rootDir, relativePath));
}

function listSourceFiles(directory) {
    if (!existsSync(directory)) {
        return [];
    }

    const results = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...listSourceFiles(entryPath));
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            results.push(entryPath);
        }
    }
    return results.sort();
}

function readDeclaredPluginHosts(readme) {
    const match = readme.match(/^Declared plugin hosts:\s*(.+)$/imu);
    if (!match || match[1].trim().toLowerCase() === "none") {
        return new Set();
    }
    return new Set(match[1].split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function includesNodeMatrix(ciWorkflow) {
    const match = ciWorkflow.match(/node-version:\s*\[([^\]]+)\]/u);
    if (!match) {
        return false;
    }
    const versions = new Set(match[1].split(",").map((version) => Number.parseInt(version.trim().replaceAll(/["']/gu, ""), 10)));
    return [20, 22, 24].every((version) => versions.has(version));
}

function releaseCreatesExactAssets(releaseWorkflow) {
    const createIndex = releaseWorkflow.indexOf("gh release create");
    if (createIndex < 0) {
        return false;
    }
    const createBlock = releaseWorkflow.slice(createIndex);
    return ["main.js", "manifest.json", "styles.css"].every((asset) => createBlock.includes(asset));
}

export function checkObsidianCompliance(rootDir = process.cwd()) {
    const issues = [];
    const packageJson = readJson(rootDir, "package.json");
    const manifest = readJson(rootDir, "manifest.json");
    const versions = readJson(rootDir, "versions.json");
    const readme = readText(rootDir, "README.md");
    const ciWorkflow = readText(rootDir, ".github/workflows/ci.yml");
    const releaseWorkflow = readText(rootDir, ".github/workflows/release.yml");

    for (const field of REQUIRED_MANIFEST_FIELDS) {
        if (manifest[field] === undefined || manifest[field] === "") {
            issues.push(`manifest.json is missing required field: ${field}`);
        }
    }
    if (!VERSION_PATTERN.test(manifest.version ?? "")) {
        issues.push(`manifest.json version must use x.y.z format: ${manifest.version ?? "<missing>"}`);
    }
    if (packageJson.version !== manifest.version) {
        issues.push(`manifest.json version ${manifest.version} does not match package.json version ${packageJson.version}`);
    }
    if (versions[manifest.version] !== manifest.minAppVersion) {
        issues.push(`versions.json entry for ${manifest.version} must equal minAppVersion ${manifest.minAppVersion}`);
    }

    for (const relativePath of REQUIRED_FILES) {
        const filePath = path.join(rootDir, relativePath);
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            issues.push(`Missing required repository file: ${relativePath}`);
        }
    }
    for (const heading of REQUIRED_DISCLOSURES) {
        if (!readme.includes(heading)) {
            issues.push(`README.md is missing capability disclosure: ${heading}`);
        }
    }

    const declaredHosts = readDeclaredPluginHosts(readme);
    for (const filePath of listSourceFiles(path.join(rootDir, "src"))) {
        const contents = readFileSync(filePath, "utf8");
        const relativePath = path.relative(rootDir, filePath);
        const reportedHosts = new Set();
        for (const match of contents.matchAll(REQUEST_LITERAL_HOST_PATTERN)) {
            const host = match[1].toLowerCase();
            if (!declaredHosts.has(host) && !reportedHosts.has(host)) {
                issues.push(`${relativePath} uses undeclared plugin network host: ${host}`);
                reportedHosts.add(host);
            }
        }
        if (/navigator\.clipboard\.readText\s*\(/u.test(contents)) {
            issues.push(`${relativePath} contains forbidden background clipboard read: navigator.clipboard.readText()`);
        }
    }

    if (!includesNodeMatrix(ciWorkflow)) {
        issues.push(".github/workflows/ci.yml must test Node.js 20, 22, and 24");
    }
    if (releaseWorkflow.includes("--clobber") || releaseWorkflow.includes("gh release edit")) {
        issues.push(".github/workflows/release.yml must not overwrite existing release assets");
    }
    if (!releaseWorkflow.includes("npm run release:check")) {
        issues.push(".github/workflows/release.yml must invoke npm run release:check");
    }
    if (!releaseCreatesExactAssets(releaseWorkflow)) {
        issues.push(".github/workflows/release.yml must create exactly main.js, manifest.json, and styles.css");
    }

    return issues;
}

function main() {
    const issues = checkObsidianCompliance();
    if (issues.length > 0) {
        console.error("Obsidian compliance check failed:");
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
    }
    console.log("Obsidian compliance check passed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
