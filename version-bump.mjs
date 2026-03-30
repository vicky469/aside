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

	const betaReleasePath = "docs/README-beta-release.md";
	const betaReleaseContent = readFileSync(betaReleasePath, "utf8");
	const nextBetaReleaseContent = replaceRequired(
		replaceRequired(
			betaReleaseContent,
			/- Current beta tag: `[^`]+`/,
			`- Current beta tag: \`${version}\``,
			`${betaReleasePath} current beta tag`,
		),
		/Ship fixes as new patch releases, for example `[^`]+`, `[^`]+`, and so on\./,
		`Ship fixes as new patch releases, for example \`${version}\`, \`${nextPatchVersion}\`, and so on.`,
		`${betaReleasePath} patch example line`,
	);
	writeFileSync(betaReleasePath, nextBetaReleaseContent);

	const readmePath = "README.md";
	const readmeContent = readFileSync(readmePath, "utf8");
	const nextReadmeContent = replaceRequired(
		readmeContent,
		/Current beta: <a href="https:\/\/github\.com\/vicky469\/SideNote2\/releases\/tag\/[^"]+">[^<]+<\/a>/,
		`Current beta: <a href="https://github.com/vicky469/SideNote2/releases/tag/${version}">${version}</a>`,
		`${readmePath} current beta link`,
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

syncBetaDocs(targetVersion);
