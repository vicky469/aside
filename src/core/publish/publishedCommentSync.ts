import { getPageCommentLabel } from "../anchors/commentAnchors";
import { normalizeCommentThreadEntryAuthor } from "../../domain/comments/commentThreadNormalization";
import type { CommentThread, CommentThreadEntry, CommentThreadEntryAuthor } from "../../domain/comments/commentThread";
import {
	SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
	type SideNoteSyncEvent,
} from "../../storage/comments/sideNoteSyncEvents";
import { normalizeVaultRelativePublishPath } from "./publishPath";
import { normalizePublishAllowedRoot } from "./publishSettings";

export type PublishedCommentEventOp = "createThread" | "appendReply" | "update" | "delete";

export interface PublishedCommentSyncManifestFile {
	publicPath: string;
	sourcePath: string;
}

export interface PublishedCommentEventAuthor {
	provider: string;
	identity: string;
	displayName?: string;
}

export interface PublishedCommentEventRow {
	eventId: string;
	path: string;
	op: PublishedCommentEventOp;
	payload: unknown;
	author?: PublishedCommentEventAuthor;
	createdAt: string | number;
}

export interface BuildPublishedCommentSyncEventsInput {
	siteId: string;
	allowedRoot: string;
	files: readonly PublishedCommentSyncManifestFile[];
	rows: readonly PublishedCommentEventRow[];
	hashText(text: string): Promise<string>;
	startLogicalClock?: number;
}

interface NormalizedPublishedCommentRow {
	eventId: string;
	path: string;
	op: PublishedCommentEventOp;
	payload: Record<string, unknown>;
	author?: CommentThreadEntryAuthor;
	createdAt: number;
}

interface ManifestFileTarget {
	publicPath: string;
	sourcePath: string;
	notePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePublicPath(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = normalizeVaultRelativePublishPath(value.replace(/^\/+/u, ""));
	return normalized.ok ? normalized.path : null;
}

function normalizeEventOp(value: unknown): PublishedCommentEventOp | null {
	if (value === "createThread" || value === "appendReply" || value === "update" || value === "delete") {
		return value;
	}
	return null;
}

function normalizePayload(value: unknown): Record<string, unknown> | null {
	if (isRecord(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function normalizeTimestamp(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.floor(value);
	}
	if (typeof value !== "string") {
		return null;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeRow(row: PublishedCommentEventRow): NormalizedPublishedCommentRow | null {
	const eventId = typeof row.eventId === "string" ? row.eventId.trim() : "";
	const path = normalizePublicPath(row.path);
	const op = normalizeEventOp(row.op);
	const payload = normalizePayload(row.payload);
	const createdAt = normalizeTimestamp(row.createdAt);
	if (!eventId || !path || !op || !payload || createdAt === null) {
		return null;
	}

	const author = normalizeCommentThreadEntryAuthor(row.author);
	return {
		eventId,
		path,
		op,
		payload,
		...(author ? { author } : {}),
		createdAt,
	};
}

function buildPublishedCommentSyncDeviceId(siteId: string): string {
	const normalizedSiteId = siteId.trim() || "site";
	return `published:${normalizedSiteId}`;
}

function buildLocalCommentId(siteId: string, remoteId: string): string {
	return `${buildPublishedCommentSyncDeviceId(siteId)}:${remoteId}`;
}

function normalizeManifestFileTargets(
	allowedRoot: string,
	files: readonly PublishedCommentSyncManifestFile[],
): Map<string, ManifestFileTarget> {
	const allowedRootPath = normalizePublishAllowedRoot(allowedRoot);
	const targetsByPublicPath = new Map<string, ManifestFileTarget>();
	for (const file of files) {
		const publicPath = normalizePublicPath(file.publicPath);
		const sourcePath = normalizePublicPath(file.sourcePath);
		if (!publicPath || !sourcePath) {
			continue;
		}

		targetsByPublicPath.set(publicPath, {
			publicPath,
			sourcePath,
			notePath: `${allowedRootPath}${sourcePath}`,
		});
	}
	return targetsByPublicPath;
}

function createEntry(
	id: string,
	body: string,
	timestamp: number,
	author: CommentThreadEntryAuthor | undefined,
): CommentThreadEntry {
	return {
		id,
		body,
		timestamp,
		...(author ? { author } : {}),
	};
}

function createPageThread(
	threadId: string,
	target: ManifestFileTarget,
	body: string,
	timestamp: number,
	author: CommentThreadEntryAuthor | undefined,
): CommentThread {
	return {
		id: threadId,
		filePath: target.notePath,
		startLine: 0,
		startChar: 0,
		endLine: 0,
		endChar: 0,
		selectedText: getPageCommentLabel(target.notePath),
		selectedTextHash: `page:${target.sourcePath}`,
		anchorKind: "page",
		orphaned: false,
		entries: [createEntry(threadId, body, timestamp, author)],
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
	const value = payload[key];
	return typeof value === "string" && value.trim() ? value : null;
}

export async function buildPublishedCommentSyncEvents(
	input: BuildPublishedCommentSyncEventsInput,
): Promise<SideNoteSyncEvent[]> {
	const targetsByPublicPath = normalizeManifestFileTargets(input.allowedRoot, input.files);
	const deviceId = buildPublishedCommentSyncDeviceId(input.siteId);
	const sortedRows = input.rows
		.map(normalizeRow)
		.filter((row): row is NormalizedPublishedCommentRow => row !== null)
		.sort((left, right) => left.createdAt - right.createdAt || left.eventId.localeCompare(right.eventId));
	const noteHashesByPath = new Map<string, string>();
	const threadIdByRemoteCommentId = new Map<string, string>();
	let logicalClock = Math.max(0, Math.floor(input.startLogicalClock ?? 0));
	const events: SideNoteSyncEvent[] = [];

	const getNoteHash = async (notePath: string): Promise<string> => {
		const existing = noteHashesByPath.get(notePath);
		if (existing) {
			return existing;
		}
		const noteHash = await input.hashText(notePath);
		noteHashesByPath.set(notePath, noteHash);
		return noteHash;
	};

	for (const row of sortedRows) {
		const target = targetsByPublicPath.get(row.path);
		if (!target) {
			continue;
		}

		const localEventId = buildLocalCommentId(input.siteId, row.eventId);
		const noteHash = await getNoteHash(target.notePath);
		let event: Omit<SideNoteSyncEvent, "logicalClock"> | null = null;

		if (row.op === "createThread") {
			const body = getStringPayloadValue(row.payload, "body");
			if (!body) {
				continue;
			}
			threadIdByRemoteCommentId.set(row.eventId, localEventId);
			event = {
				schemaVersion: SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
				eventId: localEventId,
				deviceId,
				notePath: target.notePath,
				noteHash,
				baseRevisionId: null,
				createdAt: row.createdAt,
				op: "createThread",
				payload: {
					thread: createPageThread(localEventId, target, body, row.createdAt, row.author),
				},
			};
		}

		if (row.op === "appendReply") {
			const parentId = getStringPayloadValue(row.payload, "parentId");
			const body = getStringPayloadValue(row.payload, "body");
			if (!parentId || !body) {
				continue;
			}
			const threadId = threadIdByRemoteCommentId.get(parentId) ?? buildLocalCommentId(input.siteId, parentId);
			threadIdByRemoteCommentId.set(row.eventId, threadId);
			event = {
				schemaVersion: SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
				eventId: localEventId,
				deviceId,
				notePath: target.notePath,
				noteHash,
				baseRevisionId: null,
				createdAt: row.createdAt,
				op: "appendEntry",
				payload: {
					threadId,
					entry: createEntry(localEventId, body, row.createdAt, row.author),
				},
			};
		}

		if (row.op === "update") {
			const targetId = getStringPayloadValue(row.payload, "targetId");
			const body = getStringPayloadValue(row.payload, "body");
			if (!targetId || !body) {
				continue;
			}
			const localTargetId = buildLocalCommentId(input.siteId, targetId);
			const threadId = threadIdByRemoteCommentId.get(targetId) ?? localTargetId;
			event = {
				schemaVersion: SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
				eventId: localEventId,
				deviceId,
				notePath: target.notePath,
				noteHash,
				baseRevisionId: null,
				createdAt: row.createdAt,
				op: "updateEntry",
				payload: {
					threadId,
					entryId: localTargetId,
					entry: createEntry(localTargetId, body, row.createdAt, row.author),
				},
			};
		}

		if (row.op === "delete") {
			const targetId = getStringPayloadValue(row.payload, "targetId");
			if (!targetId) {
				continue;
			}
			const localTargetId = buildLocalCommentId(input.siteId, targetId);
			const threadId = threadIdByRemoteCommentId.get(targetId) ?? localTargetId;
			event = {
				schemaVersion: SIDE_NOTE_SYNC_EVENT_SCHEMA_VERSION,
				eventId: localEventId,
				deviceId,
				notePath: target.notePath,
				noteHash,
				baseRevisionId: null,
				createdAt: row.createdAt,
				op: threadId === localTargetId ? "setThreadDeleted" : "deleteEntry",
				payload: threadId === localTargetId
					? {
						threadId,
						deletedAt: row.createdAt,
						updatedAt: row.createdAt,
					}
					: {
						threadId,
						entryId: localTargetId,
						deletedAt: row.createdAt,
					},
			};
		}

		if (!event) {
			continue;
		}

		logicalClock += 1;
		events.push({
			...event,
			logicalClock,
		});
	}

	return events;
}
