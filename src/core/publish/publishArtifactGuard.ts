import {
	normalizePublishAllowedRoot,
} from "./publishSettings";
import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";

export type PublishArtifactInspection =
	| { ok: true }
	| { ok: false; notice: string };

export interface InspectPublishArtifactOptions {
	vaultRelativePath: string;
	allowedRoot: string;
	configDir: string;
	contents: string | ArrayBuffer;
}

function getLowerBasename(path: string): string {
	const parts = path.split("/");
	return (parts.at(-1) ?? path).toLowerCase();
}

function containsPathSegments(path: string, segmentPath: string): boolean {
	const normalizedSegmentPath = normalizeVaultRelativePublishPath(segmentPath);
	if (!normalizedSegmentPath.ok) {
		return false;
	}

	const pathSegments = path.toLowerCase().split("/");
	const targetSegments = normalizedSegmentPath.path.toLowerCase().split("/");
	for (let index = 0; index <= pathSegments.length - targetSegments.length; index += 1) {
		if (targetSegments.every((segment, segmentIndex) => pathSegments[index + segmentIndex] === segment)) {
			return true;
		}
	}
	return false;
}

function isSecretBearingPath(path: string): boolean {
	const basename = getLowerBasename(path);
	return basename === ".npmrc"
		|| basename.startsWith(".env")
		|| basename === "id_rsa"
		|| basename === "id_ed25519";
}

function isKeyOrCertificatePath(path: string): boolean {
	const basename = getLowerBasename(path);
	return /\.(?:key|pem|p12|pfx|crt|cer)$/iu.test(basename)
		|| basename.includes("private_key");
}

function isHtmlPath(path: string): boolean {
	return /\.html?$/iu.test(path);
}

function isMarkdownPath(path: string): boolean {
	return /\.md$/iu.test(path);
}

function isPdfPath(path: string): boolean {
	return /\.pdf$/iu.test(path);
}

function getSourceMapContentMarkers(): string[] {
	return [
		["source", "Mapping", "URL"],
		["sources", "Content"],
	].map((parts) => parts.join(""));
}

export function inspectPublishArtifact(options: InspectPublishArtifactOptions): PublishArtifactInspection {
	const normalizedPath = normalizeVaultRelativePublishPath(options.vaultRelativePath);
	if (!normalizedPath.ok) {
		return {
			ok: false,
			notice: "Publish failed: selected path must stay inside the current vault.",
		};
	}

	const allowedRoot = normalizePublishAllowedRoot(options.allowedRoot);
	if (!normalizedPath.path.startsWith(allowedRoot)) {
		return {
			ok: false,
			notice: `Publish failed: artifact path is outside the configured publish folder: ${allowedRoot}`,
		};
	}

	if (containsPathSegments(normalizedPath.path, options.configDir)) {
		return {
			ok: false,
			notice: "Publish failed: Obsidian configuration files cannot be published.",
		};
	}

	if (isSecretBearingPath(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: secret-bearing files cannot be published.",
		};
	}

	if (isKeyOrCertificatePath(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: key and certificate files cannot be published.",
		};
	}

	if (/\.map$/iu.test(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: source maps cannot be published.",
		};
	}

	if (typeof options.contents === "string") {
		const contents = options.contents;
		if (getSourceMapContentMarkers().some((marker) => contents.includes(marker))) {
			return {
				ok: false,
				notice: "Publish failed: source-map references cannot be published.",
			};
		}
	}

	if (/\.log$/iu.test(normalizedPath.path)) {
		return {
			ok: false,
			notice: "Publish failed: log files cannot be published.",
		};
	}

	if (!(isHtmlPath(normalizedPath.path) || isMarkdownPath(normalizedPath.path) || isPdfPath(normalizedPath.path))) {
		return {
			ok: false,
			notice: "Publish failed: only .html, .htm, .md, and .pdf files can be published in this version.",
		};
	}

	return { ok: true };
}
