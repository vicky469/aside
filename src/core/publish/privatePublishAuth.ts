import { normalizeVaultRelativePublishPath } from "./publishPath";

export type PrivatePublishAccess = "view" | "comment" | "full";
export type PrivatePublishProvider = "google" | "wechat";

export interface PrivatePublishAuthRule {
	path: string;
	provider: PrivatePublishProvider;
	identifier: string;
	access: PrivatePublishAccess;
	line: number;
}

export interface PrivatePublishIdentity {
	provider: PrivatePublishProvider;
	identifier: string;
}

export interface PrivatePublishPermission {
	canView: boolean;
	canComment: boolean;
	canManage: boolean;
	rule?: PrivatePublishAuthRule;
}

interface AuthTableColumns {
	path: number;
	provider: number;
	identifier: number;
	access: number;
}

interface NormalizedPrivatePublishPath {
	path: string;
	isFolder: boolean;
}

interface MarkdownFence {
	character: "`" | "~";
	length: number;
}

const supportedProviders = new Set<PrivatePublishProvider>(["google", "wechat"]);
const supportedAccessLevels = new Set<PrivatePublishAccess>(["view", "comment", "full"]);
const accessRanks: Record<PrivatePublishAccess, number> = {
	view: 1,
	comment: 2,
	full: 3,
};

export function parsePrivatePublishAuthMarkdown(markdown: string): PrivatePublishAuthRule[] {
	const rules: PrivatePublishAuthRule[] = [];
	let activeColumns: AuthTableColumns | undefined;
	let pendingColumns: AuthTableColumns | undefined;
	let activeFence: MarkdownFence | undefined;
	let inHtmlComment = false;
	const lines = markdown.split(/\r?\n/u);

	for (let index = 0; index < lines.length; index++) {
		if (isMarkdownIndentedCodeLine(lines[index])) {
			activeColumns = undefined;
			pendingColumns = undefined;
			continue;
		}

		if (activeFence) {
			if (closesMarkdownFence(lines[index], activeFence)) {
				activeFence = undefined;
			}
			activeColumns = undefined;
			pendingColumns = undefined;
			continue;
		}

		const lineWithoutComments = stripHtmlComments(lines[index], {
			get inComment() {
				return inHtmlComment;
			},
			set inComment(value: boolean) {
				inHtmlComment = value;
			},
		});
		const fence = lineWithoutComments === undefined
			? undefined
			: parseOpeningMarkdownFence(lineWithoutComments);

		if (fence) {
			activeColumns = undefined;
			pendingColumns = undefined;
			activeFence = fence;
			continue;
		}

		if (lineWithoutComments === undefined) {
			activeColumns = undefined;
			pendingColumns = undefined;
			continue;
		}

		const cells = parseMarkdownTableCells(lineWithoutComments);
		if (!cells) {
			activeColumns = undefined;
			pendingColumns = undefined;
			continue;
		}

		const headerColumns = resolveAuthTableColumns(cells);
		if (headerColumns) {
			activeColumns = undefined;
			pendingColumns = headerColumns;
			continue;
		}

		if (pendingColumns) {
			if (isAuthTableSeparator(cells, pendingColumns)) {
				activeColumns = pendingColumns;
				pendingColumns = undefined;
			} else {
				pendingColumns = undefined;
			}
			continue;
		}

		if (!activeColumns || isMarkdownTableSeparator(cells)) {
			continue;
		}

		const rule = parseAuthTableRule(cells, activeColumns, index + 1);
		if (rule) {
			rules.push(rule);
		}
	}

	return rules;
}

interface HtmlCommentState {
	inComment: boolean;
}

function isMarkdownIndentedCodeLine(line: string): boolean {
	return line.startsWith("\t") || line.startsWith("    ");
}

export function resolvePrivatePublishPermission(
	rules: readonly PrivatePublishAuthRule[],
	identity: PrivatePublishIdentity | undefined,
	requestedPath: string,
): PrivatePublishPermission {
	if (!identity) {
		return createDeniedPermission();
	}

	const normalizedRequest = normalizePrivatePublishPath(requestedPath);
	if (!normalizedRequest) {
		return createDeniedPermission();
	}

	let winningRule: PrivatePublishAuthRule | undefined;
	let winningSpecificity = -1;
	const identifier = normalizeIdentifier(identity.identifier, identity.provider);
	if (!identifier) {
		return createDeniedPermission();
	}

	for (const rule of rules) {
		if (rule.provider !== identity.provider || rule.identifier !== identifier) {
			continue;
		}

		const match = matchRulePath(rule.path, normalizedRequest);
		if (!match.ok) {
			continue;
		}

		if (
			match.specificity > winningSpecificity
			|| (
				match.specificity === winningSpecificity
				&& accessRanks[rule.access] >= accessRanks[winningRule?.access ?? "view"]
			)
		) {
			winningRule = rule;
			winningSpecificity = match.specificity;
		}
	}

	return permissionForRule(winningRule);
}

function parseMarkdownTableCells(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) {
		return null;
	}

	let tableContent = trimmed;
	if (tableContent.startsWith("|")) {
		tableContent = tableContent.slice(1);
	}
	if (tableContent.endsWith("|")) {
		tableContent = tableContent.slice(0, -1);
	}

	return tableContent.split("|").map((cell) => cell.trim());
}

function stripHtmlComments(line: string, state: HtmlCommentState): string | undefined {
	let remaining = line;
	let stripped = "";

	while (remaining.length > 0) {
		if (state.inComment) {
			const endIndex = remaining.indexOf("-->");
			if (endIndex < 0) {
				return stripped.trim() ? stripped : undefined;
			}
			state.inComment = false;
			remaining = remaining.slice(endIndex + 3);
			continue;
		}

		const startIndex = remaining.indexOf("<!--");
		if (startIndex < 0) {
			stripped += remaining;
			break;
		}

		stripped += remaining.slice(0, startIndex);
		const endIndex = remaining.indexOf("-->", startIndex + 4);
		if (endIndex < 0) {
			state.inComment = true;
			break;
		}
		remaining = remaining.slice(endIndex + 3);
	}

	return stripped.trim() ? stripped : undefined;
}

function parseOpeningMarkdownFence(line: string): MarkdownFence | undefined {
	const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
	if (!match) {
		return undefined;
	}
	const marker = match[1];
	const character = marker?.charAt(0);
	if (character !== "`" && character !== "~") {
		return undefined;
	}
	return {
		character,
		length: marker.length,
	};
}

function closesMarkdownFence(line: string, fence: MarkdownFence): boolean {
	const escapedCharacter = fence.character === "`" ? "`" : "~";
	const match = new RegExp(`^\\s{0,3}${escapedCharacter}{${fence.length},}\\s*$`, "u").exec(line);
	return Boolean(match);
}

function resolveAuthTableColumns(cells: readonly string[]): AuthTableColumns | undefined {
	const normalizedCells = cells.map((cell) => cell.toLowerCase());
	const columns = {
		path: findColumn(normalizedCells, ["path"]),
		provider: findColumn(normalizedCells, ["provider"]),
		identifier: findColumn(normalizedCells, ["identifier", "identity"]),
		access: findColumn(normalizedCells, ["access", "permission"]),
	};

	if (
		columns.path < 0
		|| columns.provider < 0
		|| columns.identifier < 0
		|| columns.access < 0
	) {
		return undefined;
	}

	return columns;
}

function findColumn(cells: readonly string[], names: readonly string[]): number {
	for (const name of names) {
		const index = cells.indexOf(name);
		if (index >= 0) {
			return index;
		}
	}
	return -1;
}

function isMarkdownTableSeparator(cells: readonly string[]): boolean {
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function isAuthTableSeparator(cells: readonly string[], columns: AuthTableColumns): boolean {
	const requiredCellCount = Math.max(columns.path, columns.provider, columns.identifier, columns.access) + 1;
	return cells.length >= requiredCellCount && isMarkdownTableSeparator(cells);
}

function parseAuthTableRule(
	cells: readonly string[],
	columns: AuthTableColumns,
	line: number,
): PrivatePublishAuthRule | undefined {
	const pathValue = cells[columns.path];
	const providerValue = cells[columns.provider];
	const identifierValue = cells[columns.identifier];
	const accessValue = cells[columns.access];

	if (
		pathValue === undefined
		|| providerValue === undefined
		|| identifierValue === undefined
		|| accessValue === undefined
	) {
		return undefined;
	}

	const provider = normalizeProvider(providerValue);
	const path = normalizeAuthRulePath(pathValue);
	const identifier = provider ? normalizeIdentifier(identifierValue, provider) : "";
	const access = normalizeAccess(accessValue);

	if (!path || !provider || !identifier || !access) {
		return undefined;
	}

	return {
		path,
		provider,
		identifier,
		access,
		line,
	};
}

function normalizeProvider(value: string): PrivatePublishProvider | undefined {
	const provider = value.trim().toLowerCase();
	if (supportedProviders.has(provider as PrivatePublishProvider)) {
		return provider as PrivatePublishProvider;
	}
	return undefined;
}

function normalizeAccess(value: string): PrivatePublishAccess | undefined {
	const access = value.trim().toLowerCase();
	if (supportedAccessLevels.has(access as PrivatePublishAccess)) {
		return access as PrivatePublishAccess;
	}
	return undefined;
}

function normalizeIdentifier(value: string, provider: PrivatePublishProvider): string {
	const identifier = value.trim();
	return provider === "google" ? identifier.toLowerCase() : identifier;
}

function normalizeAuthRulePath(value: string): string | undefined {
	const normalized = normalizePrivatePublishPath(value, { allowRoot: true });
	if (!normalized) {
		return undefined;
	}

	if (normalized.path === "/") {
		return "/";
	}
	return normalized.isFolder ? `${normalized.path}/` : normalized.path;
}

function isAuthPathAbsoluteish(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:/u.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
}

function normalizePrivatePublishPath(
	value: string,
	options: { allowRoot?: boolean } = {},
): NormalizedPrivatePublishPath | undefined {
	const trimmed = value.trim();
	if (options.allowRoot === true && trimmed === "/") {
		return {
			path: "/",
			isFolder: true,
		};
	}

	if (
		!trimmed
		|| isAuthPathAbsoluteish(trimmed)
		|| trimmed.includes("\\")
		|| trimmed.includes("%")
		|| hasDotSegment(trimmed)
	) {
		return undefined;
	}

	const normalized = normalizeVaultRelativePublishPath(trimmed);
	if (!normalized.ok) {
		return undefined;
	}
	if (
		isAuthPathAbsoluteish(normalized.path)
		|| normalized.path === "public"
		|| normalized.path.startsWith("public/")
	) {
		return undefined;
	}

	return {
		path: normalized.path,
		isFolder: trimmed.endsWith("/"),
	};
}

function hasDotSegment(value: string): boolean {
	return value.split("/").some((part) => {
		const trimmedPart = part.trim();
		return trimmedPart === "." || trimmedPart === "..";
	});
}

function matchRulePath(
	rulePath: string,
	requestedPath: NormalizedPrivatePublishPath,
): { ok: boolean; specificity: number } {
	if (rulePath === "/") {
		return {
			ok: true,
			specificity: 0,
		};
	}

	if (rulePath.endsWith("/")) {
		const folderPath = rulePath.slice(0, -1);
		return {
			ok: requestedPath.isFolder && requestedPath.path === folderPath
				|| requestedPath.path.startsWith(`${folderPath}/`),
			specificity: folderPath.length,
		};
	}

	return {
		ok: !requestedPath.isFolder && requestedPath.path === rulePath,
		specificity: rulePath.length,
	};
}

function permissionForRule(rule: PrivatePublishAuthRule | undefined): PrivatePublishPermission {
	if (!rule) {
		return createDeniedPermission();
	}

	return {
		canView: true,
		canComment: rule.access === "comment" || rule.access === "full",
		canManage: rule.access === "full",
		rule: { ...rule },
	};
}

function createDeniedPermission(): PrivatePublishPermission {
	return {
		canView: false,
		canComment: false,
		canManage: false,
	};
}
