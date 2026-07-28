export type PrivatePublishIndexEntryType = "file" | "folder";
export type PrivatePublishIndexEntryStatus = "published" | "unpublished";

export interface PrivatePublishIndexEntry {
	path: string;
	publishedUrl?: string | null;
	type: PrivatePublishIndexEntryType;
	status: PrivatePublishIndexEntryStatus;
	permissionSource: string;
	lastPublishedAt: string | null;
}

const startMarker = "<!-- Aside publish index -->";
const endMarker = "<!-- /Aside publish index -->";
const tableHeader = "| path | published_url | type | status | permission_source | last_published_at |";
const tableSeparator = "| --- | --- | --- | --- | --- | --- |";
const legacyTableHeader = "| path | type | status | permission_source | last_published_at |";
const legacyTableSeparator = "| --- | --- | --- | --- | --- |";

export function ensurePrivatePublishIndexMarkdown(
	existingMarkdown: string | null | undefined,
	entries: readonly PrivatePublishIndexEntry[],
): string {
	const managedSection = renderManagedSection(entries);
	const normalizedExisting = normalizeLineEndings(existingMarkdown ?? "");

	if (normalizedExisting.trim() === "") {
		return withSingleTrailingNewline([
			"# Published Index",
			"",
			managedSection,
		].join("\n"));
	}

	const existingSection = findManagedSection(normalizedExisting);
	if (existingSection) {
		return withSingleTrailingNewline(
			normalizedExisting.slice(0, existingSection.start)
				+ managedSection
				+ normalizedExisting.slice(existingSection.end),
		);
	}

	return withSingleTrailingNewline([
		trimTrailingNewlines(normalizedExisting),
		"",
		managedSection,
	].join("\n"));
}

export function readPrivatePublishIndexEntries(
	existingMarkdown: string | null | undefined,
): PrivatePublishIndexEntry[] {
	const normalizedExisting = normalizeLineEndings(existingMarkdown ?? "");
	const existingSection = findManagedSection(normalizedExisting);
	if (!existingSection) {
		return [];
	}

	const section = normalizedExisting.slice(existingSection.start, existingSection.end);
	return section
		.split("\n")
		.slice(3, -1)
		.map(parseGeneratedTableRow)
		.filter((entry): entry is PrivatePublishIndexEntry => entry !== null);
}

export function mergePrivatePublishIndexEntries(
	existingMarkdown: string | null | undefined,
	entries: readonly PrivatePublishIndexEntry[],
): PrivatePublishIndexEntry[] {
	const mergedByPathAndType = new Map<string, PrivatePublishIndexEntry>();
	for (const entry of readPrivatePublishIndexEntries(existingMarkdown)) {
		mergedByPathAndType.set(buildEntryKey(entry), entry);
	}
	for (const entry of entries) {
		mergedByPathAndType.set(buildEntryKey(entry), entry);
	}
	return [...mergedByPathAndType.values()].sort(compareEntries);
}

function renderManagedSection(entries: readonly PrivatePublishIndexEntry[]): string {
	const rows = [...entries]
		.sort(compareEntries)
		.map(renderEntryRow);

	return [
		startMarker,
		tableHeader,
		tableSeparator,
		...rows,
		endMarker,
	].join("\n");
}

function compareEntries(left: PrivatePublishIndexEntry, right: PrivatePublishIndexEntry): number {
	return compareLexicographic(left.path, right.path)
		|| compareLexicographic(left.publishedUrl ?? "", right.publishedUrl ?? "")
		|| compareLexicographic(left.type, right.type)
		|| compareLexicographic(left.status, right.status)
		|| compareLexicographic(left.permissionSource, right.permissionSource)
		|| compareLexicographic(left.lastPublishedAt ?? "", right.lastPublishedAt ?? "");
}

function compareLexicographic(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

function renderEntryRow(entry: PrivatePublishIndexEntry): string {
	const publishedUrl = entry.publishedUrl == null
		? ""
		: escapeTableCell(entry.publishedUrl);
	const lastPublishedAt = entry.lastPublishedAt === null
		? ""
		: escapeTableCell(entry.lastPublishedAt);
	return `| ${escapeTableCell(entry.path)} | ${publishedUrl} | ${entry.type} | ${entry.status} | ${escapeTableCell(entry.permissionSource)} | ${lastPublishedAt} |`;
}

function escapeTableCell(value: string): string {
	return value
		.replace(/<!--/gu, "<\\!--")
		.replace(/-->/gu, "--\\>")
		.replace(/\r\n?/gu, "\n")
		.replace(/\n/gu, " ")
		.replace(/\|/gu, "\\|");
}

function normalizeLineEndings(markdown: string): string {
	return markdown.replace(/\r\n?/gu, "\n");
}

function withSingleTrailingNewline(markdown: string): string {
	return `${trimTrailingNewlines(markdown)}\n`;
}

function trimTrailingNewlines(markdown: string): string {
	return markdown.replace(/\n*$/u, "");
}

function findManagedSection(markdown: string): { start: number; end: number } | null {
	let searchFrom = 0;
	while (searchFrom < markdown.length) {
		const start = markdown.indexOf(startMarker, searchFrom);
		if (start < 0) {
			return null;
		}

		const end = markdown.indexOf(endMarker, start + startMarker.length);
		if (end < 0) {
			return null;
		}

		if (
			isLineIsolatedMarker(markdown, start, startMarker.length)
			&& isLineIsolatedMarker(markdown, end, endMarker.length)
			&& isGeneratedManagedSection(markdown.slice(start, end + endMarker.length))
		) {
			return {
				start,
				end: end + endMarker.length,
			};
		}
		searchFrom = start + startMarker.length;
	}

	return null;
}

function isLineIsolatedMarker(markdown: string, index: number, markerLength: number): boolean {
	const before = markdown[index - 1];
	const after = markdown[index + markerLength];
	const lineStart = index === 0 || before === "\n";
	const lineEnd = after === undefined || after === "\n";
	return lineStart && lineEnd;
}

function isGeneratedManagedSection(section: string): boolean {
	const lines = section.split("\n");
	const usesCurrentTable = lines[1] === tableHeader && lines[2] === tableSeparator;
	const usesLegacyTable = lines[1] === legacyTableHeader && lines[2] === legacyTableSeparator;
	if (
		lines[0] !== startMarker
		|| (!usesCurrentTable && !usesLegacyTable)
		|| lines[lines.length - 1] !== endMarker
	) {
		return false;
	}

	return lines.slice(3, -1).every(isGeneratedTableRow);
}

function isGeneratedTableRow(line: string): boolean {
	if (line.includes(startMarker) || line.includes(endMarker)) {
		return false;
	}
	const cells = splitGeneratedTableRowCells(line);
	const typeCellIndex = cells?.length === 6 ? 2 : 1;
	const statusCellIndex = cells?.length === 6 ? 3 : 2;
	return cells !== null
		&& (cells.length === 5 || cells.length === 6)
		&& cells[0].length > 0
		&& (cells[typeCellIndex] === "file" || cells[typeCellIndex] === "folder")
		&& (cells[statusCellIndex] === "published" || cells[statusCellIndex] === "unpublished");
}

function parseGeneratedTableRow(line: string): PrivatePublishIndexEntry | null {
	if (!isGeneratedTableRow(line)) {
		return null;
	}
	const cells = splitGeneratedTableRowCells(line);
	if (!cells || (cells.length !== 5 && cells.length !== 6)) {
		return null;
	}
	const publishedUrlCellIndex = cells.length === 6 ? 1 : null;
	const typeCellIndex = cells.length === 6 ? 2 : 1;
	const statusCellIndex = cells.length === 6 ? 3 : 2;
	const permissionSourceCellIndex = cells.length === 6 ? 4 : 3;
	const lastPublishedAtCellIndex = cells.length === 6 ? 5 : 4;
	const type = unescapeTableCell(cells[typeCellIndex]);
	const status = unescapeTableCell(cells[statusCellIndex]);
	if ((type !== "file" && type !== "folder") || (status !== "published" && status !== "unpublished")) {
		return null;
	}
	return {
		path: unescapeTableCell(cells[0]),
		publishedUrl: publishedUrlCellIndex === null || cells[publishedUrlCellIndex] === ""
			? null
			: unescapeTableCell(cells[publishedUrlCellIndex]),
		type,
		status,
		permissionSource: unescapeTableCell(cells[permissionSourceCellIndex]),
		lastPublishedAt: cells[lastPublishedAtCellIndex] === ""
			? null
			: unescapeTableCell(cells[lastPublishedAtCellIndex]),
	};
}

function unescapeTableCell(value: string): string {
	return value
		.replace(/<\\!--/gu, "<!--")
		.replace(/--\\>/gu, "-->")
		.replace(/\\\|/gu, "|");
}

function buildEntryKey(entry: PrivatePublishIndexEntry): string {
	return `${entry.type}\n${entry.path}`;
}

function splitGeneratedTableRowCells(line: string): string[] | null {
	if (!line.startsWith("| ") || !line.endsWith(" |")) {
		return null;
	}

	const cells: string[] = [];
	let current = "";
	const content = line.slice(2, -2);
	for (let index = 0; index < content.length; index++) {
		if (content.startsWith(" | ", index)) {
			cells.push(current);
			current = "";
			index += 2;
			continue;
		}

		const character = content[index];
		if (character === "|" && content[index - 1] !== "\\") {
			return null;
		}
		current += character;
	}

	cells.push(current);
	return cells;
}
