import type {
	PublicHtmlDeploySnapshotResult,
	PublicHtmlPublishSnapshotFile,
} from "./publicHtmlPublishController";
import {
	normalizeVaultRelativePublishPath,
} from "../core/publish/publishPath";
import {
	runWranglerPagesDeploy,
	type WranglerRuntimeModules,
} from "./wranglerPagesPublisher";
import {
	planWranglerPagesDirectUploadStaging,
	type WranglerPagesProjectFile,
	type WranglerPagesStagingContents,
	type WranglerPagesStagingWrite,
	type WranglerPagesStaticAsset,
} from "./wranglerPagesStaging";

type ExecEnv = Record<string, string | undefined>;

export interface PublicHtmlSnapshotDeployRuntimeModules extends WranglerRuntimeModules {
	fsPromises: {
		mkdtemp(prefix: string): Promise<string>;
		mkdir(path: string, options: { recursive?: boolean }): Promise<void>;
		writeFile(path: string, contents: string | Uint8Array, encoding?: "utf8"): Promise<void>;
		rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
	};
	os: {
		tmpdir(): string;
	};
	path: {
		dirname(path: string): string;
		join(...paths: string[]): string;
	};
}

export interface DeployPublicHtmlSnapshotToWranglerPagesOptions {
	files: readonly PublicHtmlPublishSnapshotFile[];
	staticAssets?: readonly WranglerPagesStaticAsset[];
	projectFiles?: readonly WranglerPagesProjectFile[];
	projectName: string;
	publishBaseUrl?: string;
	vaultRootPath: string;
	env?: ExecEnv;
	assetDirectoryName?: string;
	staticAssetPathByVaultRelativePath?: Record<string, string>;
	onResolvedProjectName?: (projectName: string) => void | Promise<void>;
	onCleanupWarning?: (error: unknown) => void;
}

const DEFAULT_PAGES_ASSET_DIRECTORY_NAME = "assets";

export async function deployPublicHtmlSnapshotToWranglerPages(
	modules: PublicHtmlSnapshotDeployRuntimeModules,
	options: DeployPublicHtmlSnapshotToWranglerPagesOptions,
): Promise<PublicHtmlDeploySnapshotResult> {
	const staticAssets = normalizeStaticAssets(
		options.files,
		options.staticAssets ?? [],
		options.staticAssetPathByVaultRelativePath,
	);
	if (!staticAssets.ok) {
		return {
			ok: false,
			notice: staticAssets.notice,
		};
	}

	const projectFiles = [...options.projectFiles ?? []];
	const usesPagesProjectLayout = projectFiles.length > 0;
	const stagingPlan = usesPagesProjectLayout
		? planWranglerPagesDirectUploadStaging({
			assetDirectoryName: options.assetDirectoryName ?? DEFAULT_PAGES_ASSET_DIRECTORY_NAME,
			staticAssets: staticAssets.assets,
			projectFiles,
		})
		: null;
	if (stagingPlan && !stagingPlan.ok) {
		return {
			ok: false,
			notice: stagingPlan.notice,
		};
	}

	let stagingDirPath: string | null = null;
	try {
		stagingDirPath = await modules.fsPromises.mkdtemp(
			modules.path.join(modules.os.tmpdir(), "aside-public-publish-"),
		);
		const deployStagingDirPath = stagingPlan?.ok
			? await writePagesProjectLayout(modules, stagingDirPath, stagingPlan.writes, stagingPlan.assetDirectoryRelativePath)
			: await writeStaticOnlyLayout(modules, stagingDirPath, staticAssets.assets);
		const deployResult = await runWranglerPagesDeploy(modules, {
			stagingDirPath: deployStagingDirPath,
			projectName: options.projectName,
			publishBaseUrl: options.publishBaseUrl,
			cwd: stagingPlan?.ok ? stagingDirPath : options.vaultRootPath,
			env: options.env,
		});
		await options.onResolvedProjectName?.(deployResult.projectName);
		if (!deployResult.ok) {
			return {
				ok: false,
				notice: deployResult.notice,
			};
		}

		return { ok: true };
	} catch (error) {
		const message = error instanceof Error && error.message.trim()
			? error.message.trim()
			: "Unable to stage or deploy the publish snapshot.";
		return {
			ok: false,
			notice: message,
		};
	} finally {
		if (stagingDirPath) {
			try {
				await modules.fsPromises.rm(stagingDirPath, { recursive: true, force: true });
			} catch (error) {
				options.onCleanupWarning?.(error);
			}
		}
	}
}

function normalizeStaticAssets(
	files: readonly PublicHtmlPublishSnapshotFile[],
	staticAssets: readonly WranglerPagesStaticAsset[],
	staticAssetPathByVaultRelativePath: Readonly<Record<string, string>> = {},
): { ok: true; assets: WranglerPagesStaticAsset[] } | { ok: false; notice: string } {
	const assets: WranglerPagesStaticAsset[] = [];
	for (const file of files) {
		const normalizedPath = normalizeVaultRelativePublishPath(file.vaultRelativePath);
		if (!normalizedPath.ok) {
			return {
				ok: false,
				notice: "Selected publish path must stay inside the current vault.",
			};
		}
		const assetPath = staticAssetPathByVaultRelativePath[file.vaultRelativePath] ?? normalizedPath.path;
		const normalizedAssetPath = normalizeVaultRelativePublishPath(assetPath);
		if (!normalizedAssetPath.ok) {
			return {
				ok: false,
				notice: "Selected publish asset path must stay inside the Pages asset directory.",
			};
		}
		assets.push({
			assetRelativePath: normalizedAssetPath.path,
			contents: file.contents,
		});
	}

	for (const asset of staticAssets) {
		const normalizedPath = normalizeVaultRelativePublishPath(asset.assetRelativePath);
		if (!normalizedPath.ok) {
			return {
				ok: false,
				notice: "Generated Pages static asset path must stay inside the Pages asset directory.",
			};
		}
		assets.push({
			assetRelativePath: normalizedPath.path,
			contents: asset.contents,
		});
	}

	return {
		ok: true,
		assets,
	};
}

async function writePagesProjectLayout(
	modules: PublicHtmlSnapshotDeployRuntimeModules,
	stagingDirPath: string,
	writes: readonly WranglerPagesStagingWrite[],
	assetDirectoryRelativePath: string,
): Promise<string> {
	for (const write of writes) {
		await writeStagingFile(modules, stagingDirPath, write.projectRelativePath, write.contents);
	}
	return modules.path.join(stagingDirPath, assetDirectoryRelativePath);
}

async function writeStaticOnlyLayout(
	modules: PublicHtmlSnapshotDeployRuntimeModules,
	stagingDirPath: string,
	staticAssets: readonly WranglerPagesStaticAsset[],
): Promise<string> {
	for (const asset of staticAssets) {
		await writeStagingFile(modules, stagingDirPath, asset.assetRelativePath, asset.contents);
	}
	return stagingDirPath;
}

async function writeStagingFile(
	modules: PublicHtmlSnapshotDeployRuntimeModules,
	stagingDirPath: string,
	relativePath: string,
	contents: WranglerPagesStagingContents,
): Promise<void> {
	const stagedFilePath = modules.path.join(
		stagingDirPath,
		...relativePath.split("/").filter(Boolean),
	);
	await modules.fsPromises.mkdir(modules.path.dirname(stagedFilePath), { recursive: true });
	if (typeof contents === "string") {
		await modules.fsPromises.writeFile(stagedFilePath, contents, "utf8");
	} else {
		await modules.fsPromises.writeFile(stagedFilePath, new Uint8Array(contents));
	}
}
