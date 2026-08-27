import {
	inspectPublishArtifact,
	inspectPublishDependency,
	type PublishArtifactInspection,
} from "./publishArtifactGuard";
import {
	extractPublishDependencyReferences,
	getPublishDependencyTextKind,
	resolvePublishDependencyReference,
} from "./publishDependencyReferences";
import { normalizeVaultRelativePublishPath } from "./publishPath";

export interface PublishDependencyFile {
	vaultRelativePath: string;
	contents: string | ArrayBuffer;
}

export interface BuildPublishDependencyGraphInput {
	entryFiles: readonly Readonly<{
		vaultRelativePath: string;
		contents: string;
	}>[];
	allowedRoot: string;
	configDir: string;
	fileExists(path: string): Promise<boolean>;
	readTextFile(path: string): Promise<string>;
	readBinaryFile(path: string): Promise<ArrayBuffer>;
}

export type BuildPublishDependencyGraphResult =
	| { ok: true; files: PublishDependencyFile[] }
	| { ok: false; notice: string };

interface ScheduledTextFile {
	path: string;
	contents: string;
}

function dependencyInspectionFailure(
	inspection: PublishArtifactInspection,
	referrerPath: string,
	originalReference: string,
): BuildPublishDependencyGraphResult | null {
	if (inspection.ok) return null;
	return {
		ok: false,
		notice: `${inspection.notice} Referenced by ${referrerPath}: ${originalReference}`,
	};
}

export async function buildPublishDependencyGraph(
	input: BuildPublishDependencyGraphInput,
): Promise<BuildPublishDependencyGraphResult> {
	const normalizedEntries: PublishDependencyFile[] = [];
	const entryPaths = new Set<string>();
	for (const entry of input.entryFiles) {
		const normalized = normalizeVaultRelativePublishPath(entry.vaultRelativePath);
		if (!normalized.ok) {
			return {
				ok: false,
				notice: `Publish failed: invalid entry vault path ${entry.vaultRelativePath}.`,
			};
		}
		const inspection = inspectPublishArtifact({
			vaultRelativePath: normalized.path,
			allowedRoot: input.allowedRoot,
			configDir: input.configDir,
			contents: entry.contents,
		});
		if (!inspection.ok) return inspection;
		if (entryPaths.has(normalized.path)) {
			return {
				ok: false,
				notice: `Publish failed: duplicate entry aliases normalize to ${normalized.path}.`,
			};
		}
		entryPaths.add(normalized.path);
		normalizedEntries.push({
			vaultRelativePath: normalized.path,
			contents: entry.contents,
		});
	}

	const knownFiles = new Map<string, string | ArrayBuffer>();
	const dependencyFiles = new Map<string, PublishDependencyFile>();
	const queue: ScheduledTextFile[] = [];
	const scheduledTextPaths = new Set<string>();

	const scheduleTextFile = (path: string, contents: string | ArrayBuffer): void => {
		if (typeof contents !== "string"
			|| getPublishDependencyTextKind(path) === null
			|| scheduledTextPaths.has(path)) {
			return;
		}
		scheduledTextPaths.add(path);
		queue.push({ path, contents });
	};

	for (const entry of normalizedEntries) {
		knownFiles.set(entry.vaultRelativePath, entry.contents);
		scheduleTextFile(entry.vaultRelativePath, entry.contents);
	}

	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const current = queue[queueIndex];
		const extracted = extractPublishDependencyReferences({
			vaultRelativePath: current.path,
			contents: current.contents,
		});

		for (const originalReference of extracted.references) {
			const resolved = resolvePublishDependencyReference({
				referrerPath: current.path,
				reference: originalReference,
				baseHref: extracted.baseHref,
				allowedRoot: input.allowedRoot,
			});
			if (!resolved.ok) return resolved;
			if (resolved.kind === "ignored" || resolved.path === current.path) continue;

			const knownContents = knownFiles.get(resolved.path);
			if (knownContents !== undefined) {
				scheduleTextFile(resolved.path, knownContents);
				continue;
			}

			const pathInspectionFailure = dependencyInspectionFailure(inspectPublishDependency({
				vaultRelativePath: resolved.path,
				allowedRoot: input.allowedRoot,
				configDir: input.configDir,
				contents: "",
			}), current.path, originalReference);
			if (pathInspectionFailure) return pathInspectionFailure;

			let exists: boolean;
			try {
				exists = await input.fileExists(resolved.path);
			} catch {
				return {
					ok: false,
					notice: `Publish failed: unable to inspect local asset ${resolved.path} referenced by ${current.path}.`,
				};
			}
			if (!exists) {
				return {
					ok: false,
					notice: `Publish failed: ${current.path} references missing local asset ${resolved.path}.`,
				};
			}

			const textKind = getPublishDependencyTextKind(resolved.path);
			let contents: string | ArrayBuffer;
			try {
				contents = textKind === null
					? await input.readBinaryFile(resolved.path)
					: await input.readTextFile(resolved.path);
			} catch {
				return {
					ok: false,
					notice: `Publish failed: unable to read local asset ${resolved.path} referenced by ${current.path}.`,
				};
			}

			const contentsInspectionFailure = dependencyInspectionFailure(inspectPublishDependency({
				vaultRelativePath: resolved.path,
				allowedRoot: input.allowedRoot,
				configDir: input.configDir,
				contents,
			}), current.path, originalReference);
			if (contentsInspectionFailure) return contentsInspectionFailure;

			const dependency = {
				vaultRelativePath: resolved.path,
				contents,
			};
			knownFiles.set(resolved.path, contents);
			dependencyFiles.set(resolved.path, dependency);
			scheduleTextFile(resolved.path, contents);
		}
	}

	return { ok: true, files: [...dependencyFiles.values()] };
}
