export type WranglerPagesStagingContents = string | ArrayBuffer;
export type WranglerPagesStagingRoot = "asset" | "project";

export interface WranglerPagesStaticAsset {
	assetRelativePath: string;
	contents: WranglerPagesStagingContents;
}

export interface WranglerPagesProjectFile {
	projectRelativePath: string;
	contents: WranglerPagesStagingContents;
}

export interface WranglerPagesStagingWrite {
	stagingRoot: WranglerPagesStagingRoot;
	relativePath: string;
	projectRelativePath: string;
	contents: WranglerPagesStagingContents;
}

export type WranglerPagesStagingPlan =
	| {
		ok: true;
		assetDirectoryRelativePath: string;
		writes: WranglerPagesStagingWrite[];
	}
	| {
		ok: false;
		notice: string;
	};

export interface PlanWranglerPagesDirectUploadStagingInput {
	assetDirectoryName: string;
	staticAssets: readonly WranglerPagesStaticAsset[];
	projectFiles: readonly WranglerPagesProjectFile[];
}

export function planWranglerPagesDirectUploadStaging(
	input: PlanWranglerPagesDirectUploadStagingInput,
): WranglerPagesStagingPlan {
	const assetDirectoryRelativePath = normalizeRootRelativePath(input.assetDirectoryName);
	if (!assetDirectoryRelativePath || assetDirectoryRelativePath.includes("/")) {
		return {
			ok: false,
			notice: "Pages asset directory name must be one safe path segment.",
		};
	}

	const writes: WranglerPagesStagingWrite[] = [];
	for (const asset of input.staticAssets) {
		const relativePath = normalizeRootRelativePath(asset.assetRelativePath);
		if (!relativePath) {
			return {
				ok: false,
				notice: "Static asset path must stay inside the Pages asset directory.",
			};
		}
		writes.push({
			stagingRoot: "asset",
			relativePath,
			projectRelativePath: `${assetDirectoryRelativePath}/${relativePath}`,
			contents: asset.contents,
		});
	}

	for (const projectFile of input.projectFiles) {
		const relativePath = normalizeRootRelativePath(projectFile.projectRelativePath);
		if (!relativePath) {
			return {
				ok: false,
				notice: "Project file path must stay inside the temporary Pages project.",
			};
		}
		if (relativePath === assetDirectoryRelativePath || relativePath.startsWith(`${assetDirectoryRelativePath}/`)) {
			return {
				ok: false,
				notice: "Project file path must not write inside the Pages asset directory.",
			};
		}
		writes.push({
			stagingRoot: "project",
			relativePath,
			projectRelativePath: relativePath,
			contents: projectFile.contents,
		});
	}

	return {
		ok: true,
		assetDirectoryRelativePath,
		writes,
	};
}

function normalizeRootRelativePath(path: string): string | null {
	const normalized = path.trim().replace(/\\/gu, "/").replace(/\/+/gu, "/");
	if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
		return null;
	}

	const segments: string[] = [];
	for (const segment of normalized.split("/")) {
		if (!segment || segment === ".") {
			continue;
		}
		if (segment === "..") {
			return null;
		}
		segments.push(segment);
	}

	return segments.length > 0 ? segments.join("/") : null;
}
