export interface BuildPublishPublicUrlOptions {
	baseUrl: string;
	vaultRelativePath: string;
}

interface NormalizedRelativePath {
	ok: boolean;
	path: string;
}

export function normalizeVaultRelativePublishPath(value: string): NormalizedRelativePath {
	const parts: string[] = [];
	for (const part of value.trim().replace(/\\/g, "/").split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (parts.length === 0) {
				return { ok: false, path: "" };
			}
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return {
		ok: parts.length > 0,
		path: parts.join("/"),
	};
}

export function buildPublishPublicUrl(options: BuildPublishPublicUrlOptions): string {
	const normalizedPath = normalizeVaultRelativePublishPath(options.vaultRelativePath);
	const encodedPath = normalizedPath.path
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${options.baseUrl.replace(/\/+$/u, "")}/${encodedPath}`;
}
