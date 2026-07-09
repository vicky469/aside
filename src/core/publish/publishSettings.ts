export interface PublishSettings {
	publishEnabled: boolean;
	publishPagesProjectName: string;
	publishBaseUrl: string;
	publishAllowedRoot: string;
}

export type PublishSettingsValidation =
	| { ok: true }
	| { ok: false; notice: string };

export const DEFAULT_PUBLISH_SETTINGS: PublishSettings = {
	publishEnabled: false,
	publishPagesProjectName: "",
	publishBaseUrl: "",
	publishAllowedRoot: "public/",
};

const PAGES_PROJECT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DEFAULT_PAGES_DOMAIN_SUFFIX = "pages.dev";

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function normalizePublishProjectName(value: unknown): string {
	const normalized = normalizeText(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.replace(/-{2,}/gu, "-")
		.slice(0, 63)
		.replace(/-+$/gu, "");
	return PAGES_PROJECT_NAME_PATTERN.test(normalized) ? normalized : "";
}

export function derivePublishBaseUrlFromProjectName(projectName: string): string {
	const normalizedName = normalizePublishProjectName(projectName);
	return normalizedName ? `https://${normalizedName}.${DEFAULT_PAGES_DOMAIN_SUFFIX}` : "";
}

export function derivePublishPagesProjectName(baseUrl: string): string {
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase();
		const projectName = hostname.endsWith(`.${DEFAULT_PAGES_DOMAIN_SUFFIX}`)
			? hostname.slice(0, -(`.${DEFAULT_PAGES_DOMAIN_SUFFIX}`).length)
			: hostname;
		const normalized = projectName
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-+|-+$/gu, "")
			.replace(/-{2,}/gu, "-")
			.slice(0, 63)
			.replace(/-+$/gu, "");
		return PAGES_PROJECT_NAME_PATTERN.test(normalized) ? normalized : "";
	} catch {
		return "";
	}
}

export function isDefaultPagesPublishBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase().endsWith(`.${DEFAULT_PAGES_DOMAIN_SUFFIX}`);
	} catch {
		return false;
	}
}

function normalizePublishEnabled(value: unknown): boolean {
	return value === true;
}

function normalizePublishBaseUrl(value: unknown): string {
	const trimmed = normalizeText(value);
	if (!trimmed) {
		return "";
	}
	try {
		const url = new URL(trimmed);
		if (url.pathname === "/" && !url.search && !url.hash) {
			return url.origin;
		}
	} catch {
		// Invalid URLs are returned trimmed so validation can report the problem.
	}
	return trimmed;
}

export function normalizePublishAllowedRoot(value: unknown): string {
	const trimmed = normalizeText(value).replace(/\\/g, "/");
	if (!trimmed) {
		return DEFAULT_PUBLISH_SETTINGS.publishAllowedRoot;
	}
	const collapsed = trimmed.replace(/\/+/g, "/");
	return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

export function normalizePublishSettings(value: Partial<PublishSettings> | null | undefined): PublishSettings {
	const publishBaseUrl = normalizePublishBaseUrl(value?.publishBaseUrl)
		|| derivePublishBaseUrlFromProjectName(normalizePublishProjectName(value?.publishPagesProjectName));
	const storedProjectName = normalizePublishProjectName(value?.publishPagesProjectName);
	const derivedProjectName = derivePublishPagesProjectName(publishBaseUrl);
	const publishPagesProjectName = isDefaultPagesPublishBaseUrl(publishBaseUrl)
		? (derivedProjectName || storedProjectName)
		: (storedProjectName || derivedProjectName);
	return {
		publishEnabled: normalizePublishEnabled(value?.publishEnabled),
		publishPagesProjectName,
		publishBaseUrl,
		publishAllowedRoot: DEFAULT_PUBLISH_SETTINGS.publishAllowedRoot,
	};
}

function isValidPublishBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:"
			&& url.origin === value
			&& !url.username
			&& !url.password
			&& !url.search
			&& !url.hash
			&& (url.pathname === "" || url.pathname === "/");
	} catch {
		return false;
	}
}

function isValidAllowedRoot(value: string): boolean {
	if (!value || value.startsWith("/") || value.includes("\0")) {
		return false;
	}
	const segments = value.split("/").filter(Boolean);
	return segments.length > 0
		&& segments.every((segment) => segment !== "." && segment !== "..");
}

export function validatePublishSettings(settings: PublishSettings): PublishSettingsValidation {
	if (!settings.publishEnabled) {
		return {
			ok: false,
			notice: "Turn on Publishing in Aside settings first.",
		};
	}

	const issues: string[] = [];
	if (!isValidPublishBaseUrl(settings.publishBaseUrl)) {
		issues.push("Publish base URL must be an https:// origin with no path, query, or fragment");
	}
	if (!isValidAllowedRoot(settings.publishAllowedRoot)) {
		issues.push("Allowed publish folder must be a vault-relative folder");
	}

	if (issues.length > 0) {
		return {
			ok: false,
			notice: `Publish settings are invalid: ${issues.join("; ")}.`,
		};
	}

	return { ok: true };
}
