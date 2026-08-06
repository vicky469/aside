import {
	ALL_COMMENTS_NOTE_IMAGE_ALT,
	ALL_COMMENTS_NOTE_IMAGE_CAPTION,
	ALL_COMMENTS_NOTE_IMAGE_CAPTION_STYLE,
	ALL_COMMENTS_NOTE_IMAGE_URL,
} from "../derived/allCommentsNote";
import {
	normalizePublishAllowedRoot,
} from "./publishSettings";

export type PublicPublishIndexEntryStatus = "published" | "unpublished";

export interface PublicPublishIndexEntry {
	path: string;
	publishedUrl: string | null;
	status: PublicPublishIndexEntryStatus;
	lastPublishedAt: string | null;
}

type PublicPublishIndexTableFormat = "current" | "typed" | "previous" | "legacy";

const tableHeader = "| path | published_url | status | last_published_at |";
const tableSeparator = "| --- | --- | --- | --- |";
const currentTableColumns = ["path", "published_url", "status", "last_published_at"] as const;
const typedTableColumns = ["path", "published_url", "type", "status", "last_published_at"] as const;
const previousTableColumns = ["path", "published_url", "type", "status", "permission_source", "last_published_at"] as const;
const legacyTableColumns = ["path", "type", "status", "permission_source", "last_published_at"] as const;

export const PUBLIC_PUBLISH_INDEX_OWNER_ONLY_NOTICE = "Aside manages public/index.md as an owner-only publish inventory.";

export function buildPublicPublishIndexPath(allowedRoot: string): string {
	return `${normalizePublishAllowedRoot(allowedRoot)}index.md`;
}

export function isPublicPublishIndexPath(filePath: string, allowedRoot: string): boolean {
	return filePath === buildPublicPublishIndexPath(allowedRoot);
}

export function renderPublicPublishIndex(entries: readonly PublicPublishIndexEntry[]): string {
	const rows = [...entries]
		.sort(compareEntries)
		.map(renderEntryRow);
	return `${[
		`![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${ALL_COMMENTS_NOTE_IMAGE_URL})`,
		`<div class="aside-index-header-caption" style="${ALL_COMMENTS_NOTE_IMAGE_CAPTION_STYLE}">${ALL_COMMENTS_NOTE_IMAGE_CAPTION}</div>`,
		"",
		tableHeader,
		tableSeparator,
		...rows,
	].join("\n")}\n`;
}

export function readPublicPublishIndexEntries(
	markdown: string | null | undefined,
): PublicPublishIndexEntry[] {
	const lines = (markdown ?? "").replace(/\r\n?/gu, "\n").split("\n");
	const table = findTable(lines);
	if (!table) {
		return [];
	}

	const entries: PublicPublishIndexEntry[] = [];
	for (let index = table.rowStart; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const cells = splitTableRowCells(line);
		if (!cells) {
			if (line.trimStart().startsWith("|")) {
				continue;
			}
			break;
		}
		const entry = parseEntryCells(cells, table.format);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries.sort(compareEntries);
}

export function mergePublicPublishIndexEntries(
	markdown: string | null | undefined,
	entries: readonly PublicPublishIndexEntry[],
): PublicPublishIndexEntry[] {
	const mergedByPath = new Map<string, PublicPublishIndexEntry>();
	for (const entry of readPublicPublishIndexEntries(markdown)) {
		mergedByPath.set(entry.path, entry);
	}
	for (const entry of entries) {
		mergedByPath.set(entry.path, entry);
	}
	return [...mergedByPath.values()].sort(compareEntries);
}

function findTable(lines: readonly string[]): {
	format: PublicPublishIndexTableFormat;
	rowStart: number;
} | null {
	for (let index = 0; index < lines.length - 1; index += 1) {
		const headerCells = splitTableRowCells(lines[index] ?? "");
		const separatorCells = splitTableRowCells(lines[index + 1] ?? "");
		const format = headerCells ? resolveTableFormat(headerCells) : null;
		if (format && separatorCells
			&& separatorCells.length === headerCells?.length
			&& separatorCells.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
			return { format, rowStart: index + 2 };
		}
	}
	return null;
}

function resolveTableFormat(cells: readonly string[]): PublicPublishIndexTableFormat | null {
	if (haveSameCells(cells, currentTableColumns)) {
		return "current";
	}
	if (haveSameCells(cells, typedTableColumns)) {
		return "typed";
	}
	if (haveSameCells(cells, previousTableColumns)) {
		return "previous";
	}
	return haveSameCells(cells, legacyTableColumns) ? "legacy" : null;
}

function haveSameCells(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function parseEntryCells(
	cells: readonly string[],
	format: PublicPublishIndexTableFormat,
): PublicPublishIndexEntry | null {
	const indexes = format === "current"
		? { publishedUrl: 1, type: null, status: 2, lastPublishedAt: 3, count: 4 }
		: format === "typed"
			? { publishedUrl: 1, type: 2, status: 3, lastPublishedAt: 4, count: 5 }
		: format === "previous"
			? { publishedUrl: 1, type: 2, status: 3, lastPublishedAt: 5, count: 6 }
			: { publishedUrl: null, type: 1, status: 2, lastPublishedAt: 4, count: 5 };
	if (cells.length !== indexes.count || !cells[0]) {
		return null;
	}

	const type = indexes.type === null ? "file" : unescapeTableCell(cells[indexes.type] ?? "");
	const status = unescapeTableCell(cells[indexes.status] ?? "");
	if (type !== "file" || (status !== "published" && status !== "unpublished")) {
		return null;
	}

	const publishedUrl = indexes.publishedUrl === null ? "" : cells[indexes.publishedUrl] ?? "";
	return {
		path: unescapeTableCell(cells[0]),
		publishedUrl: publishedUrl ? unescapeTableCell(publishedUrl) : null,
		status,
		lastPublishedAt: cells[indexes.lastPublishedAt]
			? unescapeTableCell(cells[indexes.lastPublishedAt])
			: null,
	};
}

function compareEntries(left: PublicPublishIndexEntry, right: PublicPublishIndexEntry): number {
	return compareText(left.path, right.path)
		|| compareText(left.publishedUrl ?? "", right.publishedUrl ?? "")
		|| compareText(left.status, right.status)
		|| compareText(left.lastPublishedAt ?? "", right.lastPublishedAt ?? "");
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function renderEntryRow(entry: PublicPublishIndexEntry): string {
	return `| ${escapeTableCell(entry.path)} | ${entry.publishedUrl ? escapeTableCell(entry.publishedUrl) : ""} | ${entry.status} | ${entry.lastPublishedAt ? escapeTableCell(entry.lastPublishedAt) : ""} |`;
}

function escapeTableCell(value: string): string {
	return value
		.replace(/<!--/gu, "<\\!--")
		.replace(/-->/gu, "--\\>")
		.replace(/\r\n?/gu, "\n")
		.replace(/\n/gu, " ")
		.replace(/\|/gu, "\\|");
}

function unescapeTableCell(value: string): string {
	return value
		.replace(/<\\!--/gu, "<!--")
		.replace(/--\\>/gu, "-->")
		.replace(/\\\|/gu, "|");
}

function splitTableRowCells(line: string): string[] | null {
	const trimmedLine = line.trim();
	if (!trimmedLine.startsWith("|") || !trimmedLine.endsWith("|")) {
		return null;
	}

	const cells: string[] = [];
	let current = "";
	const content = trimmedLine.slice(1, -1);
	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		if (character === "|" && content[index - 1] !== "\\") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += character;
	}
	cells.push(current.trim());
	return cells;
}
