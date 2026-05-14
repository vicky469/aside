import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	throw new Error("npm_package_version is not set. Run this script through `npm version`.");
}

function replaceRequired(content, pattern, replacement, label) {
	if (!pattern.test(content)) {
		throw new Error(`Failed to update ${label}.`);
	}

	return content.replace(pattern, replacement);
}

function syncReleaseDocs(version) {
	const readmePath = "README.md";
	const readmeContent = readFileSync(readmePath, "utf8");
	const nextReadmeContent = replaceRequired(
		replaceRequired(
			readmeContent,
			/https:\/\/github\.com\/vicky469\/aside\/releases\/tag\/[^"]+/,
			`https://github.com/vicky469/aside/releases/tag/${version}`,
			`${readmePath} release badge link`,
		),
		/https:\/\/img\.shields\.io\/badge\/release-[^?"]+\?style=flat-square/,
		`https://img.shields.io/badge/release-${version}-22c55e?style=flat-square`,
		`${readmePath} release badge image`,
	);
	writeFileSync(readmePath, nextReadmeContent);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;

manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);

syncReleaseDocs(targetVersion);
