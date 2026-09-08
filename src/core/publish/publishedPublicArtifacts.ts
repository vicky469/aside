import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";
import {
	normalizePublishAllowedRoot,
} from "./publishSettings";

function isPublicArtifactPath(path: string): boolean {
	return /\.(?:pdf|html?)$/iu.test(path);
}

function normalizePublicArtifactPath(value: string): string | null {
	const normalized = normalizeVaultRelativePublishPath(value);
	return normalized.ok && isPublicArtifactPath(normalized.path) ? normalized.path : null;
}

function normalizePublishRootArtifactPath(value: string, allowedRoot: string): string | null {
	const normalized = normalizePublicArtifactPath(value);
	if (!normalized) {
		return null;
	}

	return normalized.startsWith(normalizePublishAllowedRoot(allowedRoot)) ? normalized : null;
}

function normalizeFolderPrefix(value: string): string | null {
	const normalized = normalizeVaultRelativePublishPath(value);
	return normalized.ok ? `${normalized.path}/` : null;
}

export function normalizePublishedPublicArtifactPaths(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const paths = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const normalized = normalizePublicArtifactPath(entry);
		if (normalized) {
			paths.add(normalized);
		}
	}

	return [...paths].sort();
}

export function renamePublishedPublicArtifactPath(
	value: unknown,
	previousFilePath: string,
	nextFilePath: string,
	allowedRoot: string,
): string[] {
	const paths = new Set(normalizePublishedPublicArtifactPaths(value));
	const previousArtifactPath = normalizePublicArtifactPath(previousFilePath);
	if (!previousArtifactPath || !paths.delete(previousArtifactPath)) {
		return [...paths].sort();
	}

	const nextArtifactPath = normalizePublishRootArtifactPath(nextFilePath, allowedRoot);
	if (nextArtifactPath) {
		paths.add(nextArtifactPath);
	}

	return [...paths].sort();
}

export function removePublishedPublicArtifactPath(value: unknown, filePath: string): string[] {
	const paths = new Set(normalizePublishedPublicArtifactPaths(value));
	const artifactPath = normalizePublicArtifactPath(filePath);
	if (artifactPath) {
		paths.delete(artifactPath);
	}

	return [...paths].sort();
}

export function removePublishedPublicArtifactPathsInFolder(value: unknown, folderPath: string): string[] {
	const folderPrefix = normalizeFolderPrefix(folderPath);
	if (!folderPrefix) {
		return normalizePublishedPublicArtifactPaths(value);
	}

	return normalizePublishedPublicArtifactPaths(value)
		.filter((artifactPath) => !artifactPath.startsWith(folderPrefix));
}
