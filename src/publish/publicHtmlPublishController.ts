import type {
	PublishSettings,
	PublishSettingsValidation,
} from "../core/publish/publishSettings";
import {
	normalizePublishAllowedRoot,
	validatePublishSettings,
} from "../core/publish/publishSettings";
import type { FeatureFlags } from "../core/config/featureFlags";
import {
	inspectPublishArtifact,
} from "../core/publish/publishArtifactGuard";
import {
	buildPublishPublicUrl,
	normalizeVaultRelativePublishPath,
} from "../core/publish/publishPath";
import {
	readAsidePublishFrontmatter,
	writeAsidePublishFrontmatter,
} from "../core/publish/publishFrontmatter";
import {
	deriveMarkdownHtmlPublishPath,
	renderMarkdownToBasicHtml,
} from "../core/publish/markdownHtmlRender";
import {
	resolvePublicHtmlPairForHtml,
	resolvePublicHtmlPairForSource,
	type PublicHtmlPairResolution,
} from "../core/publish/publishPair";
import {
	ensurePrivatePublishIndexMarkdown,
	mergePrivatePublishIndexEntries,
	readPrivatePublishIndexEntries,
	type PrivatePublishIndexEntry,
} from "../core/publish/privatePublishIndex";
import {
	selectPrivatePublishPaths,
} from "../core/publish/privatePublishSelection";
import {
	parsePrivatePublishAuthMarkdown,
} from "../core/publish/privatePublishAuth";
import {
	buildPrivatePublishSnapshotSupportFiles,
	type PrivatePublishSnapshotCommentSeedInput,
	type PrivatePublishSnapshotContentFile,
	type PrivatePublishSnapshotFileKind,
	type PrivatePublishSnapshotProjectFile,
	type PrivatePublishSnapshotStaticAssetFile,
} from "../core/publish/privatePublishSnapshot";
import type {
	AsidePublishFrontmatter,
} from "../core/publish/publishFrontmatter";

export interface PublicHtmlPublishSnapshotFile {
	vaultRelativePath: string;
	contents: string | ArrayBuffer;
}

export interface PublicHtmlDeploySnapshotSupport {
	staticAssets: PrivatePublishSnapshotStaticAssetFile[];
	projectFiles: PrivatePublishSnapshotProjectFile[];
	privateAssetPathByVaultRelativePath?: Record<string, string>;
}

export type PublicHtmlPublishResult =
	| { ok: true; url: string; notice?: string }
	| { ok: false; notice: string };

export type PublicHtmlDeploySnapshotResult =
	| { ok: true }
	| { ok: false; notice: string };

export type PublicHtmlCachePurgeResult =
	| { ok: true }
	| { ok: false; notice: string };

export type PublicHtmlPublishIndexResult =
	| { ok: true; path: string; notice?: string }
	| { ok: false; notice: string };

export interface PublicHtmlCachePurgeInput {
	url: string;
	sourcePath: string;
	event: "unpublish" | "republish";
}

export type PrivatePublishPageCommentSeed = Omit<PrivatePublishSnapshotCommentSeedInput, "publicPath">;

export type PublicHtmlPublishActionKind = "publish" | "unpublish" | "update-publish" | "open-published";

export type PublicHtmlPublishActionState =
	| {
		kind: PublicHtmlPublishActionKind;
		label: string;
		icon: string;
		disabled: false;
		url?: string;
	}
	| {
		kind: "disabled";
		label: string;
		icon: string;
		disabled: true;
		notice: string;
	};

export interface PublishHtmlFileOptions {
	sourcePath?: string | null;
}

export interface PublicHtmlPublishHost {
	getSettings(): PublishSettings;
	getFeatureFlags(): FeatureFlags;
	getVaultConfigDir(): string;
	listMarkdownFiles(rootPath: string): Promise<string[]>;
	listVaultFiles(rootPath: string): Promise<string[]>;
	fileExists(path: string): Promise<boolean>;
	readVaultFile(path: string): Promise<string>;
	readVaultBinaryFile(path: string): Promise<ArrayBuffer>;
	writeVaultFile(path: string, contents: string): Promise<void>;
	writeOrCreateVaultFile(path: string, contents: string): Promise<void>;
	getPublishedArtifactPaths(): string[];
	setPublishedArtifactPaths(paths: string[]): Promise<void>;
	getCurrentTimestamp(): string;
	getPrivatePublishPageCommentSeeds?(sourcePath: string): Promise<PrivatePublishPageCommentSeed[]>;
	deploySnapshot(
		files: PublicHtmlPublishSnapshotFile[],
		supportFiles?: PublicHtmlDeploySnapshotSupport,
	): Promise<PublicHtmlDeploySnapshotResult>;
	purgePublicUrlFromCache(input: PublicHtmlCachePurgeInput): Promise<PublicHtmlCachePurgeResult>;
}

interface FileFrontmatterPatch {
	markdownEnabled?: boolean;
	htmlEnabled?: boolean;
	html?: string | null;
}

function formatOneMarkdownOneHtmlNotice(existingHtmlPath: string): string {
	return `This Markdown file is already paired with ${existingHtmlPath}. Aside uses one Markdown file for one public HTML file; create another Markdown file for another HTML page.`;
}

function isMarkdownPath(path: string): boolean {
	return /\.md$/iu.test(path);
}

function isHtmlPath(path: string): boolean {
	return /\.html?$/iu.test(path);
}

function isPdfPath(path: string): boolean {
	return /\.pdf$/iu.test(path);
}

function isPublishArtifactPath(path: string): boolean {
	return /\.(?:pdf|html?)$/iu.test(path);
}

type PublishArtifactLabel = "Markdown" | "HTML" | "PDF";
type PublishArtifactContext = PublishArtifactLabel;

function normalizePublicFilePath(path: string): string | null {
	const normalized = normalizeVaultRelativePublishPath(path);
	return normalized.ok ? normalized.path : null;
}

function buildPublishedMarkdownArtifactPath(sourcePath: string): string {
	return deriveMarkdownHtmlPublishPath(sourcePath);
}

async function buildSnapshotContentHash(contents: string | ArrayBuffer): Promise<string> {
	const bytes = typeof contents === "string"
		? new TextEncoder().encode(contents)
		: new Uint8Array(contents);
	const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
	const hex = Array.from(new Uint8Array(hashBuffer), (byte) =>
		byte.toString(16).padStart(2, "0")).join("");
	return `sha256-${hex}`;
}

function buildHtmlPublishFrontmatter(
	sourceFrontmatter: AsidePublishFrontmatter,
	patch: FileFrontmatterPatch,
): AsidePublishFrontmatter {
	return {
		...sourceFrontmatter,
		...patch,
		htmlEnabled: patch.htmlEnabled ?? sourceFrontmatter.htmlEnabled,
		markdownEnabled: patch.markdownEnabled ?? sourceFrontmatter.markdownEnabled,
		html: patch.html ?? sourceFrontmatter.html,
	};
}

export class PublicHtmlPublishController {
	constructor(private readonly host: PublicHtmlPublishHost) {}

	private validateSettings(settings: PublishSettings): PublishSettingsValidation {
		return validatePublishSettings(settings, this.host.getFeatureFlags());
	}

	public async ensurePrivatePublishIndex(): Promise<PublicHtmlPublishIndexResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		await this.writePrivatePublishIndexEntries(settings, []);
		return {
			ok: true,
			path: this.getPrivatePublishIndexPath(settings),
		};
	}

	public async publishRoot(): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		return this.publishFolder(settings.publishAllowedRoot);
	}

	public async publishFolder(folderPath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const selected = selectPrivatePublishPaths({
			targetPath: folderPath,
			allFilePaths: await this.host.listVaultFiles(settings.publishAllowedRoot),
			allowedRoot: settings.publishAllowedRoot,
		});
		if (!selected.ok) {
			return selected;
		}
		if (selected.rootKind !== "folder") {
			return {
				ok: false,
				notice: `Private publish target must be a folder inside ${settings.publishAllowedRoot}.`,
			};
		}
		if (selected.paths.length === 0) {
			await this.writePrivatePublishIndexEntries(settings, []);
			return {
				ok: false,
				notice: `No publishable files found under ${selected.rootPath}.`,
			};
		}

		const selectedMarkdownArtifactPaths = new Set(
			selected.paths
				.filter(isMarkdownPath)
				.map(buildPublishedMarkdownArtifactPath),
		);
		const publishedIndexPaths: string[] = [];
		const frontmatterBySourcePath = new Map<string, AsidePublishFrontmatter>();
		const sourceContentsByPath = new Map<string, string>();
		let nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			omitArtifactPaths: selectedMarkdownArtifactPaths,
		});
		for (const selectedPath of selected.paths) {
			if (isMarkdownPath(selectedPath)) {
				const sourceContents = await this.host.readVaultFile(selectedPath);
				const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
				frontmatterBySourcePath.set(selectedPath, buildHtmlPublishFrontmatter(sourceFrontmatter, {
					markdownEnabled: true,
				}));
				sourceContentsByPath.set(selectedPath, sourceContents);
				publishedIndexPaths.push(selectedPath);
				continue;
			}

			if (isPublishArtifactPath(selectedPath)) {
				const artifact = this.resolveArtifactPath(settings, selectedPath);
				if (!artifact.ok) {
					return artifact;
				}
				const availability = await this.validateArtifactExists(artifact.artifactPath);
				if (!availability.ok) {
					return availability;
				}
				if (selectedMarkdownArtifactPaths.has(artifact.artifactPath)) {
					continue;
				}
				nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
					artifactPaths: nextArtifactPaths,
					includeArtifactPath: artifact.artifactPath,
				});
				publishedIndexPaths.push(artifact.artifactPath);
			}
		}

		const deployResult = await this.deployEnabledSnapshot(settings, {
			frontmatterBySourcePath,
			artifactPaths: nextArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}

		for (const [sourcePath, nextFrontmatter] of frontmatterBySourcePath) {
			const sourceContents = sourceContentsByPath.get(sourcePath);
			if (sourceContents === undefined) {
				continue;
			}
			await this.host.writeVaultFile(sourcePath, writeAsidePublishFrontmatter(sourceContents, nextFrontmatter));
		}
		await this.host.setPublishedArtifactPaths(nextArtifactPaths);
		await this.writePrivatePublishIndexEntries(settings, this.buildPublishedIndexEntries(
			settings,
			publishedIndexPaths,
			selected.rootPath,
		));

		return {
			ok: true,
			url: buildPublishPublicUrl({
				baseUrl: settings.publishBaseUrl,
				vaultRelativePath: selected.rootPath,
			}),
			notice: `Published ${publishedIndexPaths.length} files from ${selected.rootPath}.`,
		};
	}

	public async getFileActionState(filePath: string): Promise<PublicHtmlPublishActionState> {
		return (await this.getFileActionStates(filePath))[0];
	}

	public async getFileActionStates(filePath: string): Promise<PublicHtmlPublishActionState[]> {
		const normalizedPath = normalizePublicFilePath(filePath);
		if (!normalizedPath) {
			return [this.disabledAction("Publish file path must stay inside the vault.")];
		}
		if (this.isPrivatePublishRootControlFile(this.host.getSettings(), normalizedPath)) {
			return [this.disabledAction("Private publish control files are not published.")];
		}
		if (isMarkdownPath(normalizedPath)) {
			return this.getMarkdownFileActionStates(normalizedPath);
		}
		if (isHtmlPath(normalizedPath)) {
			return this.getHtmlFileActionStates(normalizedPath, "HTML");
		}
		if (isPdfPath(normalizedPath)) {
			return this.getArtifactFileActionStates(normalizedPath);
		}
		return [this.disabledAction("Publish supports Markdown, HTML, and PDF files in this version.")];
	}

	public async getHtmlFileActionState(htmlPath: string): Promise<PublicHtmlPublishActionState> {
		return (await this.getHtmlFileActionStates(htmlPath))[0];
	}

	public async getHtmlFileActionStates(
		htmlPath: string,
		artifactContext: PublishArtifactContext = "HTML",
	): Promise<PublicHtmlPublishActionState[]> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return [this.disabledAction(validation.notice, artifactContext)];
		}

		const pair = await this.resolvePairForHtml(settings, htmlPath);
		if (!pair.ok) {
			return [this.disabledAction(pair.notice, artifactContext)];
		}
		if (!(await this.host.fileExists(pair.htmlPath))) {
			return [this.disabledAction(`HTML missing: ${pair.htmlPath}`, artifactContext)];
		}

		const sourcePathExists = await this.host.fileExists(pair.sourcePath);
		const artifactPaths = this.getNormalizedPublishedArtifactPaths(settings);
		if (sourcePathExists) {
			const sourceContents = await this.host.readVaultFile(pair.sourcePath);
			const frontmatter = readAsidePublishFrontmatter(sourceContents);
			if (this.sourceOwnsHtmlPath(settings, pair.sourcePath, frontmatter, pair.htmlPath)) {
				if (frontmatter.htmlEnabled) {
					return this.publishedActionStates(settings, pair.htmlPath, artifactContext);
				}

				return [{
					kind: "publish",
					label: this.publishActionLabel("publish", artifactContext),
					icon: "upload-cloud",
					disabled: false,
				}];
			}
		}

		if (artifactPaths.includes(pair.htmlPath)) {
			return this.publishedActionStates(settings, pair.htmlPath, artifactContext);
		}

		return [{
			kind: "publish",
			label: this.publishActionLabel("publish", artifactContext),
			icon: "upload-cloud",
			disabled: false,
		}];
	}

	public async publishHtmlFile(htmlPath: string, options: PublishHtmlFileOptions = {}): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const pair = options.sourcePath
			? resolvePublicHtmlPairForSource({
				sourcePath: options.sourcePath,
				frontmatterHtmlPath: htmlPath,
				allowedRoot: settings.publishAllowedRoot,
			})
			: await this.resolvePairForHtml(settings, htmlPath);
		if (!pair.ok) {
			return pair;
		}

		const pairSourceExists = await this.host.fileExists(pair.sourcePath);
		if (pairSourceExists) {
			const sourceContents = await this.host.readVaultFile(pair.sourcePath);
			const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
			if (sourceFrontmatter.html && sourceFrontmatter.html !== pair.htmlPath) {
				return {
					ok: false,
					notice: formatOneMarkdownOneHtmlNotice(sourceFrontmatter.html),
				};
			}
			if (this.isSourceMarkdownPairedWithHtml(sourceFrontmatter, pair.htmlPath)) {
				const conflictingSource = await this.findConflictingHtmlOwner(settings, pair.htmlPath, pair.sourcePath);
				if (conflictingSource !== null) {
					return {
						ok: false,
						notice: formatOneMarkdownOneHtmlNotice(pair.htmlPath),
					};
				}

				const nextFrontmatter = buildHtmlPublishFrontmatter(sourceFrontmatter, {
					htmlEnabled: true,
					html: pair.htmlPath,
				});
				const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
					omitArtifactPath: pair.htmlPath,
				});

				const deployResult = await this.deployEnabledSnapshot(settings, {
					frontmatterBySourcePath: new Map([[pair.sourcePath, nextFrontmatter]]),
					artifactPaths: nextArtifactPaths,
				});
				if (!deployResult.ok) {
					return deployResult;
				}
				await this.host.writeVaultFile(pair.sourcePath, writeAsidePublishFrontmatter(sourceContents, nextFrontmatter));
				await this.host.setPublishedArtifactPaths(nextArtifactPaths);
				await this.writePrivatePublishIndexEntries(settings, [
					this.buildPublishedIndexEntry(settings, pair.htmlPath, "file"),
				]);

				return {
					ok: true,
					url: buildPublishPublicUrl({
						baseUrl: settings.publishBaseUrl,
						vaultRelativePath: pair.htmlPath,
					}),
				};
			}
		}

		return this.publishStandaloneHtmlArtifact(settings, pair.htmlPath);
	}

	private async publishStandaloneHtmlArtifact(
		settings: PublishSettings,
		htmlPath: string,
	): Promise<PublicHtmlPublishResult> {
		const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			includeArtifactPath: htmlPath,
		});
		if (!(await this.validateArtifactExists(htmlPath)).ok) {
			return {
				ok: false,
				notice: `HTML missing: ${htmlPath}`,
			};
		}

		const deployResult = await this.deployEnabledSnapshot(settings, {
			artifactPaths: nextArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}
		await this.host.setPublishedArtifactPaths(nextArtifactPaths);
		await this.writePrivatePublishIndexEntries(settings, [
			this.buildPublishedIndexEntry(settings, htmlPath, "file"),
		]);

		return {
			ok: true,
			url: buildPublishPublicUrl({
				baseUrl: settings.publishBaseUrl,
				vaultRelativePath: htmlPath,
			}),
		};
	}

	private isSourceMarkdownPairedWithHtml(frontmatter: AsidePublishFrontmatter, htmlPath: string): boolean {
		return !frontmatter.html || frontmatter.html === htmlPath;
	}

	private async getMarkdownFileActionStates(sourcePath: string): Promise<PublicHtmlPublishActionState[]> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return [this.disabledAction(validation.notice, "Markdown")];
		}

		if (!sourcePath.startsWith(settings.publishAllowedRoot)) {
			return [this.disabledAction(`Publish file must be inside ${settings.publishAllowedRoot}.`, "Markdown")];
		}
		if (!(await this.host.fileExists(sourcePath))) {
			return [this.disabledAction(`Publish file missing: ${sourcePath}`, "Markdown")];
		}

		const sourceContents = await this.host.readVaultFile(sourcePath);
		const frontmatter = readAsidePublishFrontmatter(sourceContents);
		if (frontmatter.markdownEnabled) {
			return this.publishedActionStates(settings, buildPublishedMarkdownArtifactPath(sourcePath), "Markdown");
		}

		return [{
			kind: "publish",
			label: this.publishActionLabel("publish", "Markdown"),
			icon: "upload-cloud",
			disabled: false,
		}];
	}

	private async getArtifactFileActionStates(artifactPath: string): Promise<PublicHtmlPublishActionState[]> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return [this.disabledAction(validation.notice, "PDF")];
		}

		const artifact = this.resolveArtifactPath(settings, artifactPath);
		if (!artifact.ok) {
			return [this.disabledAction(artifact.notice, "PDF")];
		}
		if (!(await this.host.fileExists(artifact.artifactPath))) {
			return [this.disabledAction(`Publish file missing: ${artifact.artifactPath}`, "PDF")];
		}

		const publishedArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings);
		if (publishedArtifactPaths.includes(artifact.artifactPath)) {
			return this.publishedActionStates(settings, artifact.artifactPath, "PDF");
		}

		return [{
			kind: "publish",
			label: "Publish PDF",
			icon: "upload-cloud",
			disabled: false,
		}];
	}

	public async publishFile(filePath: string): Promise<PublicHtmlPublishResult> {
		const normalizedPath = normalizePublicFilePath(filePath);
		if (!normalizedPath) {
			return {
				ok: false,
				notice: "Publish file path must stay inside the vault.",
			};
		}
		if (this.isPrivatePublishRootControlFile(this.host.getSettings(), normalizedPath)) {
			return {
				ok: false,
				notice: "Private publish control files are not published.",
			};
		}
		if (isMarkdownPath(normalizedPath)) {
			return this.publishMarkdownFile(normalizedPath);
		}
		if (isHtmlPath(normalizedPath)) {
			return this.publishHtmlFile(normalizedPath);
		}
		if (isPdfPath(normalizedPath)) {
			return this.publishArtifactFile(normalizedPath);
		}
		return {
			ok: false,
			notice: "Publish supports Markdown, HTML, and PDF files in this version.",
		};
	}

	private async publishMarkdownFile(sourcePath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}
		if (!(await this.host.fileExists(sourcePath))) {
			return {
				ok: false,
				notice: `Publish file missing: ${sourcePath}`,
			};
		}

		const sourceContents = await this.host.readVaultFile(sourcePath);
		const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
		const nextFrontmatter = buildHtmlPublishFrontmatter(sourceFrontmatter, {
			markdownEnabled: true,
		});
		const markdownArtifactPath = buildPublishedMarkdownArtifactPath(sourcePath);
		const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			omitArtifactPath: markdownArtifactPath,
		});

		const deployResult = await this.deployEnabledSnapshot(settings, {
			frontmatterBySourcePath: new Map([[sourcePath, nextFrontmatter]]),
			artifactPaths: nextArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}
		await this.host.writeVaultFile(sourcePath, writeAsidePublishFrontmatter(sourceContents, nextFrontmatter));
		await this.host.setPublishedArtifactPaths(nextArtifactPaths);
		await this.writePrivatePublishIndexEntries(settings, [
			this.buildPublishedIndexEntry(settings, sourcePath, "file"),
		]);

		return {
			ok: true,
			url: buildPublishPublicUrl({
				baseUrl: settings.publishBaseUrl,
				vaultRelativePath: markdownArtifactPath,
			}),
		};
	}

	private async publishArtifactFile(artifactPath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const artifact = this.resolveArtifactPath(settings, artifactPath);
		if (!artifact.ok) {
			return artifact;
		}
		const availability = await this.validateArtifactExists(artifact.artifactPath);
		if (!availability.ok) {
			return availability;
		}

		const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			includeArtifactPath: artifact.artifactPath,
		});
		const deployResult = await this.deployEnabledSnapshot(settings, {
			artifactPaths: nextArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}
		await this.host.setPublishedArtifactPaths(nextArtifactPaths);
		await this.writePrivatePublishIndexEntries(settings, [
			this.buildPublishedIndexEntry(settings, artifact.artifactPath, "file"),
		]);

		return {
			ok: true,
			url: buildPublishPublicUrl({
				baseUrl: settings.publishBaseUrl,
				vaultRelativePath: artifact.artifactPath,
			}),
		};
	}

	public async unpublishHtmlFile(htmlPath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const pair = await this.resolvePairForHtml(settings, htmlPath);
		if (!pair.ok) {
			return pair;
		}
		const pairSourceExists = await this.host.fileExists(pair.sourcePath);
		if (pairSourceExists) {
			const sourceContents = await this.host.readVaultFile(pair.sourcePath);
			const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
			if (this.sourceOwnsHtmlPath(settings, pair.sourcePath, sourceFrontmatter, pair.htmlPath)) {
				if (!sourceFrontmatter.htmlEnabled) {
					return {
						ok: false,
						notice: "Publish this HTML file before unpublishing it.",
					};
				}

				const nextFrontmatter = buildHtmlPublishFrontmatter(sourceFrontmatter, {
					htmlEnabled: false,
					html: pair.htmlPath,
				});
				const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
					omitArtifactPath: pair.htmlPath,
				});

				const deployResult = await this.deployEnabledSnapshot(settings, {
					frontmatterBySourcePath: new Map([[pair.sourcePath, nextFrontmatter]]),
					artifactPaths: nextArtifactPaths,
				});
				if (!deployResult.ok) {
					return deployResult;
				}
				await this.host.writeVaultFile(pair.sourcePath, writeAsidePublishFrontmatter(sourceContents, nextFrontmatter));
				await this.host.setPublishedArtifactPaths(nextArtifactPaths);
				await this.writePrivatePublishIndexEntries(settings, [
					this.buildUnpublishedIndexEntry(settings, pair.htmlPath, "file"),
				]);

				return this.buildCachePurgeResult(settings, pair.htmlPath, pair.sourcePath, "unpublish");
			}
		}

		return this.unpublishStandaloneHtmlArtifact(settings, pair.htmlPath);
	}

	private async unpublishStandaloneHtmlArtifact(
		settings: PublishSettings,
		htmlPath: string,
	): Promise<PublicHtmlPublishResult> {
		const publishedArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings);
		if (!publishedArtifactPaths.includes(htmlPath)) {
			return {
				ok: false,
				notice: "Publish this HTML file before unpublishing it.",
			};
		}

		const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			omitArtifactPath: htmlPath,
		});
		const deployResult = await this.deployEnabledSnapshot(settings, {
			artifactPaths: nextArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}
		await this.host.setPublishedArtifactPaths(nextArtifactPaths);
		await this.writePrivatePublishIndexEntries(settings, [
			this.buildUnpublishedIndexEntry(settings, htmlPath, "file"),
		]);

		return this.buildCachePurgeResult(settings, htmlPath, htmlPath, "unpublish");
	}

	private async unpublishMarkdownFile(sourcePath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		if (!(await this.host.fileExists(sourcePath))) {
			return {
				ok: false,
				notice: `Publish file missing: ${sourcePath}`,
			};
		}

		const sourceContents = await this.host.readVaultFile(sourcePath);
		const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
		if (!sourceFrontmatter.markdownEnabled) {
			return {
				ok: false,
				notice: "Publish this Markdown file before unpublishing it.",
			};
		}

		const nextFrontmatter = buildHtmlPublishFrontmatter(sourceFrontmatter, {
			markdownEnabled: false,
		});

		const deployResult = await this.deployEnabledSnapshot(settings, {
			frontmatterBySourcePath: new Map([[sourcePath, nextFrontmatter]]),
		});
		if (!deployResult.ok) {
			return deployResult;
		}
		await this.host.writeVaultFile(sourcePath, writeAsidePublishFrontmatter(sourceContents, nextFrontmatter));
		await this.writePrivatePublishIndexEntries(settings, [
			this.buildUnpublishedIndexEntry(settings, sourcePath, "file"),
		]);

		return this.buildCachePurgeResult(
			settings,
			buildPublishedMarkdownArtifactPath(sourcePath),
			sourcePath,
			"unpublish",
		);
	}

	public async unpublishFile(filePath: string): Promise<PublicHtmlPublishResult> {
		const normalizedPath = normalizePublicFilePath(filePath);
		if (!normalizedPath) {
			return {
				ok: false,
				notice: "Publish file path must stay inside the vault.",
			};
		}
		if (isMarkdownPath(normalizedPath)) {
			return this.unpublishMarkdownFile(normalizedPath);
		}
		if (isHtmlPath(normalizedPath)) {
			return this.unpublishHtmlFile(normalizedPath);
		}
		if (isPdfPath(normalizedPath)) {
			return this.unpublishArtifactFile(normalizedPath);
		}
		return {
			ok: false,
			notice: "Publish supports Markdown/HTML pairs and PDF files in this version.",
		};
	}

	private async unpublishArtifactFile(artifactPath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const artifact = this.resolveArtifactPath(settings, artifactPath);
		if (!artifact.ok) {
			return artifact;
		}
		const publishedArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings);
		if (!publishedArtifactPaths.includes(artifact.artifactPath)) {
			return {
				ok: false,
				notice: "Publish this PDF before unpublishing it.",
			};
		}
		const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			omitArtifactPath: artifact.artifactPath,
		});
		const deployResult = await this.deployEnabledSnapshot(settings, {
			artifactPaths: nextArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}
		await this.host.setPublishedArtifactPaths(nextArtifactPaths);
		await this.writePrivatePublishIndexEntries(settings, [
			this.buildUnpublishedIndexEntry(settings, artifact.artifactPath, "file"),
		]);

		return this.buildCachePurgeResult(settings, artifact.artifactPath, artifact.artifactPath, "unpublish");
	}

	public async updatePublishedHtmlFile(htmlPath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const pair = await this.resolvePairForHtml(settings, htmlPath);
		if (!pair.ok) {
			return pair;
		}
		const pairSourceExists = await this.host.fileExists(pair.sourcePath);
		if (pairSourceExists) {
			const sourceContents = await this.host.readVaultFile(pair.sourcePath);
			const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
			if (this.sourceOwnsHtmlPath(settings, pair.sourcePath, sourceFrontmatter, pair.htmlPath)) {
				if (!sourceFrontmatter.htmlEnabled) {
					return {
						ok: false,
						notice: "Publish this HTML file before updating it.",
					};
				}

				const nextFrontmatter = buildHtmlPublishFrontmatter(sourceFrontmatter, {
					htmlEnabled: true,
					html: pair.htmlPath,
				});
				const nextArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
					omitArtifactPath: pair.htmlPath,
				});
				const deployResult = await this.deployEnabledSnapshot(settings, {
					frontmatterBySourcePath: new Map([[pair.sourcePath, nextFrontmatter]]),
					artifactPaths: nextArtifactPaths,
				});
				if (!deployResult.ok) {
					return deployResult;
				}
				await this.host.setPublishedArtifactPaths(nextArtifactPaths);

				return this.buildCachePurgeResult(settings, pair.htmlPath, pair.sourcePath, "republish");
			}
		}

		return this.updateStandaloneHtmlArtifact(settings, pair.htmlPath);
	}

	private async updateStandaloneHtmlArtifact(
		settings: PublishSettings,
		htmlPath: string,
	): Promise<PublicHtmlPublishResult> {
		const publishedArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings);
		if (!publishedArtifactPaths.includes(htmlPath)) {
			return {
				ok: false,
				notice: "Publish this HTML file before updating it.",
			};
		}

		if (!(await this.validateArtifactExists(htmlPath)).ok) {
			return {
				ok: false,
				notice: `HTML missing: ${htmlPath}`,
			};
		}

		const deployResult = await this.deployEnabledSnapshot(settings, {
			artifactPaths: publishedArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}

		return this.buildCachePurgeResult(settings, htmlPath, htmlPath, "republish");
	}

	private async updatePublishedMarkdownFile(sourcePath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		if (!(await this.host.fileExists(sourcePath))) {
			return {
				ok: false,
				notice: `Publish file missing: ${sourcePath}`,
			};
		}

		const sourceContents = await this.host.readVaultFile(sourcePath);
		const sourceFrontmatter = readAsidePublishFrontmatter(sourceContents);
		if (!sourceFrontmatter.markdownEnabled) {
			return {
				ok: false,
				notice: "Publish this Markdown file before updating it.",
			};
		}

		const deployResult = await this.deployEnabledSnapshot(settings, {
			frontmatterBySourcePath: new Map([[sourcePath, sourceFrontmatter]]),
		});
		if (!deployResult.ok) {
			return deployResult;
		}

		return this.buildCachePurgeResult(
			settings,
			buildPublishedMarkdownArtifactPath(sourcePath),
			sourcePath,
			"republish",
		);
	}

	public async updatePublishedFile(filePath: string): Promise<PublicHtmlPublishResult> {
		const normalizedPath = normalizePublicFilePath(filePath);
		if (!normalizedPath) {
			return {
				ok: false,
				notice: "Publish file path must stay inside the vault.",
			};
		}
		if (isMarkdownPath(normalizedPath)) {
			return this.updatePublishedMarkdownFile(normalizedPath);
		}
		if (isHtmlPath(normalizedPath)) {
			return this.updatePublishedHtmlFile(normalizedPath);
		}
		if (isPdfPath(normalizedPath)) {
			return this.updatePublishedArtifactFile(normalizedPath);
		}
		return {
			ok: false,
			notice: "Publish supports Markdown/HTML pairs and PDF files in this version.",
		};
	}

	private async updatePublishedArtifactFile(artifactPath: string): Promise<PublicHtmlPublishResult> {
		const settings = this.host.getSettings();
		const validation = this.validateSettings(settings);
		if (!validation.ok) {
			return validation;
		}

		const artifact = this.resolveArtifactPath(settings, artifactPath);
		if (!artifact.ok) {
			return artifact;
		}
		const publishedArtifactPaths = this.getNormalizedPublishedArtifactPaths(settings);
		if (!publishedArtifactPaths.includes(artifact.artifactPath)) {
			return {
				ok: false,
				notice: "Publish this PDF before updating it.",
			};
		}
		const availability = await this.validateArtifactExists(artifact.artifactPath);
		if (!availability.ok) {
			return availability;
		}

		const deployResult = await this.deployEnabledSnapshot(settings, {
			artifactPaths: publishedArtifactPaths,
		});
		if (!deployResult.ok) {
			return deployResult;
		}

		return this.buildCachePurgeResult(settings, artifact.artifactPath, artifact.artifactPath, "republish");
	}

	private async validatePairExists(sourcePath: string, htmlPath: string): Promise<{ ok: true } | { ok: false; notice: string }> {
		if (!(await this.host.fileExists(sourcePath))) {
			return {
				ok: false,
			notice: `Markdown pair missing: ${sourcePath}`,
			};
		}
		if (!(await this.host.fileExists(htmlPath))) {
			return {
				ok: false,
			notice: `HTML missing: ${htmlPath}`,
			};
		}
		return { ok: true };
	}

	private resolveOwnedHtmlPathForSource(
		settings: PublishSettings,
		sourcePath: string,
		frontmatter: AsidePublishFrontmatter,
	): string | null {
		if (!frontmatter.html && !frontmatter.htmlEnabled) {
			return null;
		}

		const pair = resolvePublicHtmlPairForSource({
			sourcePath,
			frontmatterHtmlPath: frontmatter.html,
			allowedRoot: settings.publishAllowedRoot,
		});
		return pair.ok ? pair.htmlPath : null;
	}

	private sourceOwnsHtmlPath(
		settings: PublishSettings,
		sourcePath: string,
		frontmatter: AsidePublishFrontmatter,
		htmlPath: string,
	): boolean {
		return this.resolveOwnedHtmlPathForSource(settings, sourcePath, frontmatter) === htmlPath;
	}

	private async resolvePairForHtml(settings: PublishSettings, htmlPath: string): Promise<PublicHtmlPairResolution> {
		const explicitPair = await this.findExplicitHtmlOwner(settings, htmlPath);
		if (explicitPair) {
			return explicitPair;
		}

		const inferredPair = resolvePublicHtmlPairForHtml({
			htmlPath,
			allowedRoot: settings.publishAllowedRoot,
		});
		if (!inferredPair.ok) {
			return inferredPair;
		}

		if (await this.host.fileExists(inferredPair.sourcePath)) {
			return inferredPair;
		}

		const markdownFiles = (await this.host.listMarkdownFiles(settings.publishAllowedRoot)).sort();
		for (const sourcePath of markdownFiles) {
			const sourceContents = await this.host.readVaultFile(sourcePath);
			const frontmatter = readAsidePublishFrontmatter(sourceContents);
			if (!frontmatter.html) {
				continue;
			}
			const explicitPair = resolvePublicHtmlPairForSource({
				sourcePath,
				frontmatterHtmlPath: frontmatter.html,
				allowedRoot: settings.publishAllowedRoot,
			});
			if (explicitPair.ok && explicitPair.htmlPath === inferredPair.htmlPath) {
				return explicitPair;
			}
		}

		return inferredPair;
	}

	private async findExplicitHtmlOwner(settings: PublishSettings, htmlPath: string): Promise<PublicHtmlPairResolution | null> {
		const normalizedHtmlPath = normalizePublicFilePath(htmlPath);
		if (!normalizedHtmlPath) {
			return null;
		}
		for (const sourcePath of (await this.host.listMarkdownFiles(settings.publishAllowedRoot)).sort()) {
			const sourceContents = await this.host.readVaultFile(sourcePath);
			const frontmatter = readAsidePublishFrontmatter(sourceContents);
			if (!this.sourceOwnsHtmlPath(settings, sourcePath, frontmatter, normalizedHtmlPath)) {
				continue;
			}
			const explicitPair = resolvePublicHtmlPairForSource({
				sourcePath,
				frontmatterHtmlPath: frontmatter.html,
				allowedRoot: settings.publishAllowedRoot,
			});
			if (explicitPair.ok && explicitPair.htmlPath === normalizedHtmlPath) {
				return explicitPair;
			}
		}
		return null;
	}

	private async resolvePairForSource(settings: PublishSettings, sourcePath: string): Promise<PublicHtmlPairResolution> {
		const inferredPair = resolvePublicHtmlPairForSource({
			sourcePath,
			frontmatterHtmlPath: null,
			allowedRoot: settings.publishAllowedRoot,
		});
		if (!inferredPair.ok || !(await this.host.fileExists(inferredPair.sourcePath))) {
			return inferredPair;
		}

		const sourceContents = await this.host.readVaultFile(inferredPair.sourcePath);
		const frontmatter = readAsidePublishFrontmatter(sourceContents);
		return resolvePublicHtmlPairForSource({
			sourcePath: inferredPair.sourcePath,
			frontmatterHtmlPath: frontmatter.html,
			allowedRoot: settings.publishAllowedRoot,
		});
	}

	private async findConflictingHtmlOwner(
		settings: PublishSettings,
		htmlPath: string,
		excludedSourcePath: string,
	): Promise<string | null> {
		const normalizedHtmlPath = normalizePublicFilePath(htmlPath);
		if (!normalizedHtmlPath) {
			return null;
		}
		const markdownFiles = await this.host.listMarkdownFiles(settings.publishAllowedRoot);
		for (const sourcePath of markdownFiles.sort()) {
			if (sourcePath === excludedSourcePath) {
				continue;
			}
			const sourceContents = await this.host.readVaultFile(sourcePath);
			const frontmatter = readAsidePublishFrontmatter(sourceContents);
			if (!this.sourceOwnsHtmlPath(settings, sourcePath, frontmatter, normalizedHtmlPath)) {
				continue;
			}
			const pair = resolvePublicHtmlPairForSource({
				sourcePath,
				frontmatterHtmlPath: frontmatter.html,
				allowedRoot: settings.publishAllowedRoot,
			});
			if (pair.ok && pair.htmlPath === normalizedHtmlPath) {
				return sourcePath;
			}
		}
		return null;
	}

	private resolveArtifactPath(
		settings: PublishSettings,
		artifactPath: string,
	): { ok: true; artifactPath: string } | { ok: false; notice: string } {
		const normalizedPath = normalizePublicFilePath(artifactPath);
		if (!normalizedPath) {
			return {
				ok: false,
			notice: "Publish file path must stay inside the vault.",
			};
		}
		if (!normalizedPath.startsWith(settings.publishAllowedRoot)) {
			return {
				ok: false,
			notice: `Publish file must be inside ${settings.publishAllowedRoot}.`,
			};
		}
		if (!isPublishArtifactPath(normalizedPath)) {
			return {
				ok: false,
			notice: "Publish supports PDF and HTML files directly in this version.",
			};
		}
		return {
			ok: true,
			artifactPath: normalizedPath,
		};
	}

	private getNormalizedPublishedArtifactPaths(
		settings: PublishSettings,
		options: {
			artifactPaths?: string[];
			includeArtifactPath?: string;
			omitArtifactPath?: string;
			omitArtifactPaths?: Iterable<string>;
		} = {},
	): string[] {
		const paths = new Set<string>();
		for (const path of options.artifactPaths ?? this.host.getPublishedArtifactPaths()) {
			const artifact = this.resolveArtifactPath(settings, path);
			if (artifact.ok) {
				paths.add(artifact.artifactPath);
			}
		}
		if (options.includeArtifactPath) {
			const artifact = this.resolveArtifactPath(settings, options.includeArtifactPath);
			if (artifact.ok) {
				paths.add(artifact.artifactPath);
			}
		}
		if (options.omitArtifactPath) {
			paths.delete(options.omitArtifactPath);
		}
		for (const artifactPath of options.omitArtifactPaths ?? []) {
			paths.delete(artifactPath);
		}
		return [...paths].sort();
	}

	private async validateArtifactExists(artifactPath: string): Promise<{ ok: true } | { ok: false; notice: string }> {
		if (!(await this.host.fileExists(artifactPath))) {
			return {
				ok: false,
			notice: `Publish file missing: ${artifactPath}`,
			};
		}
		return { ok: true };
	}

	private async readArtifactContents(artifactPath: string): Promise<string | ArrayBuffer> {
		return isPdfPath(artifactPath)
			? this.host.readVaultBinaryFile(artifactPath)
			: this.host.readVaultFile(artifactPath);
	}

	private async buildCachePurgeResult(
		settings: PublishSettings,
		vaultRelativePath: string,
		sourcePath: string,
		event: PublicHtmlCachePurgeInput["event"],
	): Promise<{ ok: true; url: string; notice?: string }> {
		const url = buildPublishPublicUrl({
			baseUrl: settings.publishBaseUrl,
			vaultRelativePath,
		});
		if (!settings.publishRemotePurgeEnabled) {
			return { ok: true, url };
		}

		const purgeResult = await this.host.purgePublicUrlFromCache({
			url,
			sourcePath,
			event,
		});
		if (purgeResult.ok) {
			return { ok: true, url };
		}

		return {
			ok: true,
			url,
			notice: `${event === "unpublish" ? "Unpublished" : "Republished"}, but remote cache purge failed: ${purgeResult.notice}`,
		};
	}

	private getPrivatePublishIndexPath(settings: PublishSettings): string {
		return `${normalizePublishAllowedRoot(settings.publishAllowedRoot)}index.md`;
	}

	private getPrivatePublishAuthPath(_settings: PublishSettings): string {
		return "auth.md";
	}

	private async writePrivatePublishIndexEntries(
		settings: PublishSettings,
		entries: readonly PrivatePublishIndexEntry[],
	): Promise<void> {
		const indexPath = this.getPrivatePublishIndexPath(settings);
		const existingMarkdown = await this.host.fileExists(indexPath)
			? await this.host.readVaultFile(indexPath)
			: null;
		const nextEntries = entries.length > 0
			? mergePrivatePublishIndexEntries(existingMarkdown, entries)
			: readPrivatePublishIndexEntries(existingMarkdown);
		const nextMarkdown = ensurePrivatePublishIndexMarkdown(existingMarkdown, nextEntries);
		if (existingMarkdown !== nextMarkdown) {
			await this.host.writeOrCreateVaultFile(indexPath, nextMarkdown);
		}
	}

	private buildPublishedIndexEntries(
		settings: PublishSettings,
		filePaths: readonly string[],
		folderPath?: string,
	): PrivatePublishIndexEntry[] {
		const timestamp = this.host.getCurrentTimestamp();
		const entries: PrivatePublishIndexEntry[] = filePaths.map((filePath) =>
			this.buildPublishedIndexEntry(settings, filePath, "file", timestamp));
		if (folderPath) {
			entries.push(this.buildPublishedIndexEntry(settings, folderPath, "folder", timestamp));
		}
		return entries;
	}

	private buildPublishedIndexEntry(
		settings: PublishSettings,
		vaultRelativePath: string,
		type: PrivatePublishIndexEntry["type"],
		timestamp = this.host.getCurrentTimestamp(),
	): PrivatePublishIndexEntry {
		return {
			path: this.toPrivatePublishIndexPath(settings, vaultRelativePath, type),
			publishedUrl: buildPublishPublicUrl({
				baseUrl: settings.publishBaseUrl,
				vaultRelativePath: type === "file" && isMarkdownPath(vaultRelativePath)
					? buildPublishedMarkdownArtifactPath(vaultRelativePath)
					: vaultRelativePath,
			}),
			type,
			status: "published",
			permissionSource: this.getPrivatePublishAuthPath(settings),
			lastPublishedAt: timestamp,
		};
	}

	private buildUnpublishedIndexEntry(
		settings: PublishSettings,
		vaultRelativePath: string,
		type: PrivatePublishIndexEntry["type"],
	): PrivatePublishIndexEntry {
		return {
			path: this.toPrivatePublishIndexPath(settings, vaultRelativePath, type),
			publishedUrl: null,
			type,
			status: "unpublished",
			permissionSource: this.getPrivatePublishAuthPath(settings),
			lastPublishedAt: null,
		};
	}

	private toPrivatePublishIndexPath(
		settings: PublishSettings,
		vaultRelativePath: string,
		type: PrivatePublishIndexEntry["type"],
	): string {
		const allowedRoot = normalizePublishAllowedRoot(settings.publishAllowedRoot);
		const allowedRootPath = allowedRoot.slice(0, -1);
		const normalizedPath = normalizePublicFilePath(vaultRelativePath);
		if (!normalizedPath) {
			return vaultRelativePath;
		}
		if (type === "folder" && normalizedPath === allowedRootPath) {
			return "/";
		}
		if (normalizedPath.startsWith(allowedRoot)) {
			const relativePath = normalizedPath.slice(allowedRoot.length);
			if (type === "folder") {
				return relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
			}
			return relativePath;
		}
		return normalizedPath;
	}

	private isPrivatePublishRootControlFile(settings: PublishSettings, filePath: string): boolean {
		const allowedRoot = normalizePublishAllowedRoot(settings.publishAllowedRoot);
		if (!filePath.startsWith(allowedRoot)) {
			return false;
		}
		const relativePath = filePath.slice(allowedRoot.length).toLowerCase();
		return relativePath === "index.md" || relativePath === "auth.md";
	}

	private disabledAction(
		notice: string,
		artifact?: PublishArtifactContext,
	): PublicHtmlPublishActionState {
		return {
			kind: "disabled",
			label: artifact ? `Publish ${artifact}` : "Publish",
			icon: "upload-cloud",
			disabled: true,
			notice,
		};
	}

	private publishedActionStates(
		settings: PublishSettings,
		vaultRelativePath: string,
		artifact: PublishArtifactContext,
	): PublicHtmlPublishActionState[] {
		const url = buildPublishPublicUrl({
			baseUrl: settings.publishBaseUrl,
			vaultRelativePath,
		});
		return [{
			kind: "unpublish",
			label: this.publishActionLabel("unpublish", artifact),
			icon: "cloud-off",
			disabled: false,
		}, {
			kind: "update-publish",
			label: this.publishActionLabel("update-publish", artifact),
			icon: "upload-cloud",
			disabled: false,
		}, {
			kind: "open-published",
			label: this.publishActionLabel("open-published", artifact),
			icon: "external-link",
			disabled: false,
			url,
		}];
	}

	private publishActionLabel(kind: PublicHtmlPublishActionState["kind"], artifact: PublishArtifactContext): string {
		switch (kind) {
			case "publish":
				return `Publish ${artifact}`;
			case "unpublish":
				return `Unpublish ${artifact}`;
			case "update-publish":
				return `Republish ${artifact}`;
			case "open-published":
				return `Open published ${artifact}`;
			default:
				return kind;
		}
	}

	private async deployEnabledSnapshot(
		settings: PublishSettings,
		options: {
			frontmatterBySourcePath?: Map<string, AsidePublishFrontmatter>;
			artifactPaths?: string[];
		} = {},
	): Promise<PublicHtmlDeploySnapshotResult> {
		const markdownFiles = (await this.host.listMarkdownFiles(settings.publishAllowedRoot)).sort();
		const snapshotFiles: PublicHtmlPublishSnapshotFile[] = [];
		const snapshotContentFiles: PrivatePublishSnapshotContentFile[] = [];
		const snapshotCommentSeeds: PrivatePublishSnapshotCommentSeedInput[] = [];
		const ownedHtmlArtifactPaths = new Set<string>();
		const addSnapshotFile = async (input: {
			vaultRelativePath: string;
			sourcePath: string;
			kind: PrivatePublishSnapshotFileKind;
			contents: string | ArrayBuffer;
		}) => {
			snapshotFiles.push({
				vaultRelativePath: input.vaultRelativePath,
				contents: input.contents,
			});
			snapshotContentFiles.push({
				vaultRelativePath: input.vaultRelativePath,
				sourcePath: input.sourcePath,
				kind: input.kind,
				contentHash: await buildSnapshotContentHash(input.contents),
			});
			const commentSeeds = await this.host.getPrivatePublishPageCommentSeeds?.(input.sourcePath) ?? [];
			const normalizedRoot = normalizePublishAllowedRoot(settings.publishAllowedRoot);
			const normalizedArtifactPath = normalizePublicFilePath(input.vaultRelativePath);
			const publicPath = normalizedArtifactPath?.startsWith(normalizedRoot)
				? normalizedArtifactPath.slice(normalizedRoot.length)
				: input.vaultRelativePath;
			snapshotCommentSeeds.push(...commentSeeds.map((seed) => ({
				...seed,
				publicPath,
			})));
		};
		for (const sourcePath of markdownFiles) {
			if (this.isPrivatePublishRootControlFile(settings, sourcePath)) {
				continue;
			}
			const sourceContents = await this.host.readVaultFile(sourcePath);
			const frontmatter = options.frontmatterBySourcePath?.get(sourcePath)
				? options.frontmatterBySourcePath.get(sourcePath) as AsidePublishFrontmatter
				: readAsidePublishFrontmatter(sourceContents);
			const nextSourceContents = options.frontmatterBySourcePath?.has(sourcePath)
				? writeAsidePublishFrontmatter(sourceContents, frontmatter)
				: sourceContents;
			const ownedHtmlPath = this.resolveOwnedHtmlPathForSource(settings, sourcePath, frontmatter);
			if (ownedHtmlPath) {
				ownedHtmlArtifactPaths.add(ownedHtmlPath);
			}

			if (frontmatter.markdownEnabled) {
				if (!(await this.host.fileExists(sourcePath))) {
					return {
						ok: false,
						notice: `Publish file missing: ${sourcePath}`,
					};
				}
				const markdownArtifactPath = buildPublishedMarkdownArtifactPath(sourcePath);
				ownedHtmlArtifactPaths.add(markdownArtifactPath);
				const htmlPairUsesMarkdownArtifactPath = frontmatter.htmlEnabled && ownedHtmlPath === markdownArtifactPath;
				if (!htmlPairUsesMarkdownArtifactPath) {
					const htmlContents = renderMarkdownToBasicHtml({
						sourcePath,
						markdown: nextSourceContents,
					});
					const markdownInspection = inspectPublishArtifact({
						vaultRelativePath: markdownArtifactPath,
						allowedRoot: settings.publishAllowedRoot,
						configDir: this.host.getVaultConfigDir(),
						contents: htmlContents,
					});
					if (!markdownInspection.ok) {
						return markdownInspection;
					}
					await addSnapshotFile({
						vaultRelativePath: markdownArtifactPath,
						sourcePath,
						kind: "markdown",
						contents: htmlContents,
					});
				}
			}

			if (frontmatter.htmlEnabled) {
				const pair = resolvePublicHtmlPairForSource({
					sourcePath,
					frontmatterHtmlPath: frontmatter.html,
					allowedRoot: settings.publishAllowedRoot,
				});
				if (!pair.ok) {
					return {
						ok: false,
						notice: pair.notice,
					};
				}
				ownedHtmlArtifactPaths.add(pair.htmlPath);
				if (!(await this.host.fileExists(pair.htmlPath))) {
					return {
						ok: false,
						notice: `HTML missing: ${pair.htmlPath}`,
					};
				}

				const htmlContents = await this.host.readVaultFile(pair.htmlPath);
				const artifactInspection = inspectPublishArtifact({
					vaultRelativePath: pair.htmlPath,
					allowedRoot: settings.publishAllowedRoot,
					configDir: this.host.getVaultConfigDir(),
					contents: htmlContents,
				});
				if (!artifactInspection.ok) {
					return artifactInspection;
				}
				await addSnapshotFile({
					vaultRelativePath: pair.htmlPath,
					sourcePath,
					kind: "html",
					contents: htmlContents,
				});
			}
		}

		const artifactPaths = this.getNormalizedPublishedArtifactPaths(settings, {
			artifactPaths: options.artifactPaths,
			omitArtifactPaths: ownedHtmlArtifactPaths,
		});
		for (const artifactPath of artifactPaths) {
			const artifact = this.resolveArtifactPath(settings, artifactPath);
			if (!artifact.ok) {
				return artifact;
			}
			const availability = await this.validateArtifactExists(artifact.artifactPath);
			if (!availability.ok) {
				return availability;
			}
			const contents = await this.readArtifactContents(artifact.artifactPath);
			const artifactInspection = inspectPublishArtifact({
				vaultRelativePath: artifact.artifactPath,
				allowedRoot: settings.publishAllowedRoot,
				configDir: this.host.getVaultConfigDir(),
				contents,
			});
			if (!artifactInspection.ok) {
				return artifactInspection;
			}
			await addSnapshotFile({
				vaultRelativePath: artifact.artifactPath,
				sourcePath: artifact.artifactPath,
				kind: this.getSnapshotFileKind(artifact.artifactPath),
				contents,
			});
		}

		return this.host.deploySnapshot(
			snapshotFiles,
			await this.buildDeploySnapshotSupport(settings, snapshotContentFiles, snapshotCommentSeeds),
		);
	}

	private getSnapshotFileKind(path: string): PrivatePublishSnapshotFileKind {
		if (isPdfPath(path)) {
			return "pdf";
		}
		return "html";
	}

	private async buildDeploySnapshotSupport(
		settings: PublishSettings,
		files: readonly PrivatePublishSnapshotContentFile[],
		commentSeeds: readonly PrivatePublishSnapshotCommentSeedInput[] = [],
	): Promise<PublicHtmlDeploySnapshotSupport | undefined> {
		if (files.length === 0) {
			return undefined;
		}

		const authPath = `${normalizePublishAllowedRoot(settings.publishAllowedRoot)}auth.md`;
		const authRules = await this.host.fileExists(authPath)
			? parsePrivatePublishAuthMarkdown(await this.host.readVaultFile(authPath))
			: [];
		const supportFiles = buildPrivatePublishSnapshotSupportFiles({
			allowedRoot: settings.publishAllowedRoot,
			publishBaseUrl: settings.publishBaseUrl,
			publishedAt: this.host.getCurrentTimestamp(),
			files,
			authRules,
			commentSeeds,
		});
		return {
			staticAssets: supportFiles.staticAssets,
			projectFiles: [
				...supportFiles.functions,
				...supportFiles.privateModules,
			],
			privateAssetPathByVaultRelativePath: supportFiles.privateAssetPathByVaultRelativePath,
		};
	}
}
