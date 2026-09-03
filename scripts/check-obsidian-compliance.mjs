import { execFileSync } from "node:child_process";
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
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const PUBLIC_SOURCE_DIRECTORIES = [
    "src",
    "scripts",
    "workers",
];
const PUBLIC_SOURCE_FILES = [
    "esbuild.config.mjs",
    "eslint.config.mjs",
];
const PRIVACY_SCAN_DIRECTORIES = [
    ".github",
    "docs",
    "scripts",
    "skills",
    "src",
    "workers",
];
const REPOSITORY_TEXT_EXTENSIONS = new Set([
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".sh",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
]);
const PLACEHOLDER_HOME_NAMES = new Set(["example", "name", "sample", "test", "tester", "user", "username"]);
const SUPPORTED_NODE_VERSIONS = new Set([22, 24]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const REQUEST_LITERAL_HOST_PATTERN = /(?:fetch|request|WebSocket)\s*\(\s*["'`]https?:\/\/([a-z0-9.-]+)(?=[/:)'"`\s]|$)/giu;
const ESLINT_DIRECTIVE_COMMENT_PATTERN = /(?:^|\s)(?:\/\*|\/\/|#)\s*eslint-(?:disable|enable|disable-line|disable-next-line)\b/u;
const FETCH_CALL_PATTERN = /\bfetch\s*\(/u;

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

function listPublicSourceFiles(rootDir) {
    const files = [];
    for (const directory of PUBLIC_SOURCE_DIRECTORIES) {
        files.push(...listSourceFiles(path.join(rootDir, directory)));
    }
    for (const relativePath of PUBLIC_SOURCE_FILES) {
        const filePath = path.join(rootDir, relativePath);
        if (existsSync(filePath)) {
            files.push(filePath);
        }
    }
    return files.sort();
}

function listRepositoryTextFiles(directory) {
    if (!existsSync(directory)) {
        return [];
    }

    const results = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...listRepositoryTextFiles(entryPath));
        } else if (REPOSITORY_TEXT_EXTENSIONS.has(path.extname(entry.name))) {
            results.push(entryPath);
        }
    }
    return results.sort();
}

function listPrivacyScanFiles(rootDir) {
    try {
        const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
            cwd: rootDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return trackedFiles
            .split("\0")
            .filter(Boolean)
            .filter((relativePath) => REPOSITORY_TEXT_EXTENSIONS.has(path.extname(relativePath)))
            .map((relativePath) => path.join(rootDir, relativePath))
            .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile())
            .sort();
    } catch {
        return PRIVACY_SCAN_DIRECTORIES.flatMap((directory) =>
            listRepositoryTextFiles(path.join(rootDir, directory)));
    }
}

function containsPersonalHomeDirectoryPath(contents) {
    const unixHomeRoots = ["Users", "home"].join("|");
    const unixPattern = new RegExp(`/(?:${unixHomeRoots})/([^/\\s"'\x60<>]+)(?=/)`, "gu");
    for (const match of contents.matchAll(unixPattern)) {
        if (!PLACEHOLDER_HOME_NAMES.has(match[1].toLowerCase())) {
            return true;
        }
    }

    const windowsPattern = new RegExp(`[A-Za-z]:\\\\${"Users"}\\\\([^\\\\\\s"'\\x60<>]+)(?=\\\\)`, "gu");
    for (const match of contents.matchAll(windowsPattern)) {
        if (!PLACEHOLDER_HOME_NAMES.has(match[1].toLowerCase())) {
            return true;
        }
    }
    return false;
}

function inspectRepositoryPrivacy(rootDir) {
    const issues = [];
    for (const filePath of listPrivacyScanFiles(rootDir)) {
        const contents = readFileSync(filePath, "utf8");
        if (containsPersonalHomeDirectoryPath(contents)) {
            const relativePath = path.relative(rootDir, filePath);
            issues.push(`${relativePath} contains a personal home-directory path; use a placeholder`);
        }
    }
    return issues;
}

function readDeclaredPluginHosts(readme) {
    const match = readme.match(/^Declared plugin hosts:\s*(.+)$/imu);
    if (!match || match[1].trim().toLowerCase() === "none") {
        return new Set();
    }
    return new Set(match[1].split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function usesSupportedNodeMatrix(ciWorkflow) {
    const match = ciWorkflow.match(/node-version:\s*\[([^\]]+)\]/u);
    if (!match) {
        return false;
    }
    const versions = new Set(match[1].split(",").map((version) => Number.parseInt(version.trim().replaceAll(/["']/gu, ""), 10)));
    return versions.size === SUPPORTED_NODE_VERSIONS.size
        && [...SUPPORTED_NODE_VERSIONS].every((version) => versions.has(version));
}

function releaseCreatesExactAssets(releaseWorkflow) {
    const createIndex = releaseWorkflow.indexOf("gh release create");
    if (createIndex < 0) {
        return false;
    }
    const createBlock = releaseWorkflow.slice(createIndex);
    return ["main.js", "manifest.json", "styles.css"].every((asset) => createBlock.includes(asset));
}

function inspectPublicSourceArchive(rootDir) {
    const issues = [];
    for (const filePath of listPublicSourceFiles(rootDir)) {
        const contents = readFileSync(filePath, "utf8");
        const relativePath = path.relative(rootDir, filePath);
        if (ESLINT_DIRECTIVE_COMMENT_PATTERN.test(contents)) {
            issues.push(`${relativePath} contains forbidden ESLint directive comment`);
        }
        if (relativePath === "esbuild.config.mjs" && FETCH_CALL_PATTERN.test(contents)) {
            issues.push("esbuild.config.mjs uses fetch in public source; use Node http/https or keep dev-only transport out of the public source archive");
        }
    }
    return issues;
}

function hasStalePrivateRemoteHookRouting(rootDir) {
    const hookPath = path.join(rootDir, "scripts/hooks/pre-push");
    if (!existsSync(hookPath)) {
        return false;
    }
    const contents = readFileSync(hookPath, "utf8");
    return /\btwo-remote\b/u.test(contents)
        || /\bprivate\s*→/u.test(contents)
        || /\bgit\s+push\s+private\b/u.test(contents)
        || /\bicloud\b/u.test(contents);
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
    issues.push(...inspectPublicSourceArchive(rootDir));
    issues.push(...inspectRepositoryPrivacy(rootDir));

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

    if (!usesSupportedNodeMatrix(ciWorkflow)) {
        issues.push(".github/workflows/ci.yml must test supported Node.js LTS versions 22 and 24");
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
    if (hasStalePrivateRemoteHookRouting(rootDir)) {
        issues.push("scripts/hooks/pre-push must not advertise or require private or icloud remotes");
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
