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

function getNextPatchVersion(version) {
	const [major, minor, patch] = version.split(".").map((value) => Number.parseInt(value, 10));
	if ([major, minor, patch].some((value) => Number.isNaN(value))) {
		throw new Error(`Invalid semver version: ${version}`);
	}

	return `${major}.${minor}.${patch + 1}`;
}

function syncBetaDocs(version) {
	const nextPatchVersion = getNextPatchVersion(version);

	const betaReleasePath = "README-beta-release.md";
	const betaReleaseContent = readFileSync(betaReleasePath, "utf8");
	const nextBetaReleaseContent = replaceRequired(
		replaceRequired(
			betaReleaseContent,
			/- Current release line: `[^`]+` or newer/,
			`- Current release line: \`${version}\` or newer`,
			`${betaReleasePath} current release line`,
		),
		/Ship fixes as new patch releases, for example `[^`]+`, `[^`]+`, and so on\./,
		`Ship fixes as new patch releases, for example \`${version}\`, \`${nextPatchVersion}\`, and so on.`,
		`${betaReleasePath} patch example line`,
	);
	writeFileSync(betaReleasePath, nextBetaReleaseContent);

	const qaPath = "README-qa.md";
	const qaContent = readFileSync(qaPath, "utf8");
	const nextQaContent = replaceRequired(
		qaContent,
		/- Current beta release line: `[^`]+` or newer/,
		`- Current beta release line: \`${version}\` or newer`,
		`${qaPath} current beta release line`,
	);
	writeFileSync(qaPath, nextQaContent);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;

manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);

syncBetaDocs(targetVersion);
