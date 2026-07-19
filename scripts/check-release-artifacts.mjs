import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const RELEASE_ARTIFACTS = [
    "main.js",
    "manifest.json",
    "styles.css",
];

const FORBIDDEN_CONTENT_CHECKS = [
    {
        label: "sourceMappingURL marker",
        pattern: /[#@]\s*sourceMappingURL=|sourceMappingURL=/,
    },
    {
        label: "embedded sourcesContent",
        pattern: /sourcesContent/,
    },
    {
        label: "global fetch token",
        pattern: /\bfetch\s*\(/,
    },
    {
        label: "private key material",
        pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    },
    {
        label: "certificate material",
        pattern: /-----BEGIN CERTIFICATE-----/,
    },
    {
        label: "npm token",
        pattern: /npm_[A-Za-z0-9]{20,}/,
    },
    {
        label: "GitHub token",
        pattern: /gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}/,
    },
    {
        label: "OpenAI-style API key",
        pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
    },
    {
        label: "local macOS path",
        pattern: /\/Users\/[^/\s]+\/?/,
    },
    {
        label: "local Windows path",
        pattern: /[A-Za-z]:\\\\Users\\\\[^\\\s]+\\?/,
    },
];

function inspectArtifactFile(filePath) {
    const issues = [];
    const content = readFileSync(filePath, "utf8");

    for (const check of FORBIDDEN_CONTENT_CHECKS) {
        if (check.pattern.test(content)) {
            issues.push(`${path.basename(filePath)} contains ${check.label}`);
        }
    }

    return issues;
}

export function inspectReleaseArtifacts(rootDir = process.cwd()) {
    const issues = [];

    for (const asset of RELEASE_ARTIFACTS) {
        const assetPath = path.join(rootDir, asset);
        if (!existsSync(assetPath)) {
            issues.push(`Missing release artifact: ${asset}`);
            continue;
        }

        const stat = statSync(assetPath);
        if (!stat.isFile()) {
            issues.push(`Release artifact is not a file: ${asset}`);
            continue;
        }

        issues.push(...inspectArtifactFile(assetPath));
    }

    const sourceMapPath = path.join(rootDir, "main.js.map");
    if (existsSync(sourceMapPath)) {
        issues.push("main.js.map must not be shipped with the public release");
    }

    return issues;
}

function main() {
    const issues = inspectReleaseArtifacts();
    if (issues.length) {
        console.error("Release artifact inspection failed:");
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
        process.exit(1);
    }

    console.log(`Release artifact inspection passed for ${RELEASE_ARTIFACTS.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
