#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_MAIN_BUNDLE_BYTES = 750_000;

export function inspectBundleSize(bundlePath = "main.js") {
    const bundleName = path.basename(bundlePath);
    if (!existsSync(bundlePath)) {
        return [`Missing production bundle: ${bundleName}`];
    }

    const stat = statSync(bundlePath);
    if (!stat.isFile()) {
        return [`Production bundle is not a file: ${bundleName}`];
    }
    if (stat.size <= MAX_MAIN_BUNDLE_BYTES) {
        return [];
    }

    const overage = stat.size - MAX_MAIN_BUNDLE_BYTES;
    const byteLabel = overage === 1 ? "byte" : "bytes";
    return [
        `${bundleName} is ${stat.size} bytes; maximum is ${MAX_MAIN_BUNDLE_BYTES} bytes (${overage} ${byteLabel} over)`,
    ];
}

function main() {
    const bundlePath = process.argv[2] ?? "main.js";
    const issues = inspectBundleSize(bundlePath);
    if (issues.length > 0) {
        console.error("Production bundle size check failed:");
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
    }

    const bytes = statSync(bundlePath).size;
    console.log(`Production bundle size check passed: ${bytes}/${MAX_MAIN_BUNDLE_BYTES} bytes`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
