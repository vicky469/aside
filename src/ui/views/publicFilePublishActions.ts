import type { TFile } from "obsidian";
import {
	normalizeVaultRelativePublishPath,
} from "../../core/publish/publishPath";
import {
	normalizePublishAllowedRoot,
} from "../../core/publish/publishSettings";
import type {
	PublicHtmlPublishActionState,
} from "../../publish/publicHtmlPublishController";

export interface PublicFilePublishActionView {
	file: TFile | null;
	containerEl?: HTMLElement;
	addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement;
}

export interface PublicFilePublishActionHost {
	getAllowedRoot(): string;
	getPublishActionStates(file: TFile): Promise<PublicHtmlPublishActionState[]>;
	runPublishAction(file: TFile, actionKind: PublicHtmlPublishActionState["kind"]): Promise<void>;
	showNotice(message: string): void;
}

function isSupportedPublishActionPath(path: string): boolean {
	return /\.md$|\.html?$|\.pdf$/iu.test(path);
}

function getPublishActionLabelKind(file: TFile): "Markdown" | "HTML" | "PDF" {
	if (/\.pdf$/iu.test(file.path)) {
		return "PDF";
	}
	if (/\.html?$/iu.test(file.path)) {
		return "HTML";
	}
	return "Markdown";
}

const LEGACY_PUBLISH_ACTION_SELECTORS: readonly string[] = [
	".view-action[data-aside-public-file-action]",
	".view-action[data-aside-public-html-action]",
	".aside-public-file-publish-action",
	".aside-public-html-publish-action",
	"[data-aside-public-html-action]",
	"[data-aside-public-file-action]",
	"[data-aside-public-file-file-path]",
	"[data-aside-public-file-view-id]",
] as const;

type LegacyPublishActionNode = {
	remove(): void;
	getAttribute(name: string): string | null;
	classList?: DOMTokenList;
	className?: string;
};

function hasPublishButtonClass(node: LegacyPublishActionNode): boolean {
	if (node.classList) {
		const classList = node.classList;
		return classList.contains("aside-public-file-publish-action")
			|| classList.contains("aside-public-html-publish-action");
	}

	const className = node.className
		?? node.getAttribute("class")
		?? "";
	return className.includes("aside-public-file-publish-action")
		|| className.includes("aside-public-html-publish-action");
}

function isPublishActionNode(node: unknown): node is LegacyPublishActionNode {
	return typeof node === "object"
		&& node !== null
		&& typeof (node as { remove?: unknown; getAttribute?: unknown }).remove === "function"
		&& typeof (node as { getAttribute?: unknown }).getAttribute === "function";
}

export function isPublicFilePublishActionPath(filePath: string, allowedRoot: string): boolean {
	const normalized = normalizeVaultRelativePublishPath(filePath);
	if (!normalized.ok) {
		return false;
	}
	const root = normalizePublishAllowedRoot(allowedRoot);
	return normalized.path.startsWith(root) && isSupportedPublishActionPath(normalized.path);
}

function getHeaderInsertionRank(kind: PublicHtmlPublishActionState["kind"]): number {
	switch (kind) {
		case "open-published":
			return 0;
		case "update-publish":
			return 1;
		case "unpublish":
			return 2;
		default:
			return 3;
	}
}

function getHeaderInsertionStates(states: PublicHtmlPublishActionState[]): PublicHtmlPublishActionState[] {
	return [...states].sort((left, right) => getHeaderInsertionRank(left.kind) - getHeaderInsertionRank(right.kind));
}

export class PublicFilePublishActionController {
	private readonly trackedViews = new Set<PublicFilePublishActionView>();
	private readonly actionElsByView = new Map<PublicFilePublishActionView, HTMLElement[]>();
	private readonly viewRefreshTokens = new WeakMap<PublicFilePublishActionView, number>();
	private readonly viewIds = new WeakMap<PublicFilePublishActionView, string>();
	private nextViewId = 0;

	constructor(private readonly host: PublicFilePublishActionHost) {}

	public async refreshViews(views: PublicFilePublishActionView[]): Promise<void> {
		const uniqueViews = Array.from(new Set(views));
		const currentViews = new Set(uniqueViews);
		for (const view of this.trackedViews) {
			if (!currentViews.has(view)) {
				this.removeViewActions(view);
				this.trackedViews.delete(view);
				this.viewRefreshTokens.delete(view);
			}
		}

		await Promise.all(uniqueViews.map((view) => this.refreshView(view)));
	}

	public clear(): void {
		for (const view of this.trackedViews) {
			this.removeViewActions(view);
			this.viewRefreshTokens.delete(view);
		}
		this.trackedViews.clear();
	}

	private async refreshView(view: PublicFilePublishActionView): Promise<void> {
		const refreshId = (this.viewRefreshTokens.get(view) ?? 0) + 1;
		this.viewRefreshTokens.set(view, refreshId);
		this.trackedViews.add(view);
		const file = view.file;
		const filePath = file?.path ?? "";
		const viewId = this.getViewId(view);
		this.removeAllPublishActions(view);

		if (!file || !isPublicFilePublishActionPath(file.path, this.host.getAllowedRoot())) {
			this.removeViewActions(view);
			return;
		}

		let states: PublicHtmlPublishActionState[];
		try {
			states = await this.host.getPublishActionStates(file);
		} catch (error) {
			const artifactLabel = getPublishActionLabelKind(file);
			const fallbackLabel = `Publish ${artifactLabel}`;
			states = [{
				kind: "disabled",
				label: fallbackLabel,
				icon: "upload-cloud",
				disabled: true,
				notice: error instanceof Error && error.message.trim()
					? error.message.trim()
					: "Unable to inspect publish state.",
			}];
		}

		if (this.viewRefreshTokens.get(view) !== refreshId) {
			return;
		}

		this.removeViewActions(view);
		for (const kind of new Set(states.map((state) => state.kind))) {
			this.removeGlobalDuplicateActions(viewId, filePath, kind);
		}
		const dedupedStates = new Map<PublicHtmlPublishActionState["kind"], PublicHtmlPublishActionState>();
		for (const state of states) {
			dedupedStates.set(state.kind, state);
		}
		const actionEls: HTMLElement[] = [];
		for (const state of getHeaderInsertionStates([...dedupedStates.values()])) {
			const actionEl = view.addAction(state.icon, state.label, (evt) => {
				evt.preventDefault();
				void this.handleAction(view, state, actionEl);
			});
			actionEl.addClass("aside-public-file-publish-action");
			actionEl.setAttribute("data-aside-public-file-file-path", filePath);
			actionEl.setAttribute("aria-label", state.label);
			actionEl.setAttribute("data-aside-public-file-action", state.kind);
			actionEl.setAttribute("data-aside-public-action-kind", state.kind);
			actionEl.setAttribute("data-aside-public-file-view-id", viewId);
			if (state.disabled) {
				actionEl.addClass("is-disabled");
				actionEl.setAttribute("aria-disabled", "true");
				actionEl.setAttribute("data-disabled-notice", state.notice);
			}
			actionEls.push(actionEl);
		}
		this.actionElsByView.set(view, actionEls);
	}

	private removeAllPublishActions(view: PublicFilePublishActionView): void {
		const containerEl = view.containerEl;
		const filePath = view.file?.path ?? "";
		const viewId = this.getViewId(view);
		const seen = new Set<LegacyPublishActionNode>();

		if (containerEl) {
			this.removePublishActionsInScope(containerEl, seen);
		}
		if (typeof document !== "undefined") {
			this.removeUnscopedLegacyActions(filePath, viewId, null, seen);
			this.removeGlobalViewActionsById(viewId, filePath, null, seen);
		}

		this.removeViewActions(view);
	}

	private removePublishActionsInScope(scope: ParentNode, seen: Set<LegacyPublishActionNode>): void {
		for (const selector of LEGACY_PUBLISH_ACTION_SELECTORS) {
			const actionEls = Array.from(scope.querySelectorAll(selector));
			for (const actionEl of actionEls) {
				if (!isPublishActionNode(actionEl) || seen.has(actionEl)) {
					continue;
				}
				actionEl.remove();
				seen.add(actionEl);
			}
		}
	}

	private removeUnscopedLegacyActions(
		filePath: string,
		viewId: string,
		expectedActionKind: PublicHtmlPublishActionState["kind"] | null,
		seen: Set<LegacyPublishActionNode>,
	): void {
		if (typeof document === "undefined") {
			return;
		}

		const selectors = [
			".aside-public-file-publish-action",
			".aside-public-html-publish-action",
			`[data-aside-public-file-file-path="${filePath}"]`,
			`[data-aside-public-file-view-id="${viewId}"]`,
			"[data-aside-public-file-action]",
			"[data-aside-public-html-action]",
		];
		for (const selector of selectors) {
			for (const actionEl of Array.from(document.querySelectorAll(selector))) {
				if (!isPublishActionNode(actionEl) || seen.has(actionEl)) {
					continue;
				}
				if (!this.shouldRemovePublishAction(actionEl, filePath, viewId, expectedActionKind)) {
					continue;
				}
				actionEl.remove();
				seen.add(actionEl);
			}
		}
	}

	private removeGlobalViewActionsById(
		viewId: string,
		filePath: string,
		expectedActionKind: PublicHtmlPublishActionState["kind"] | null,
		seen: Set<LegacyPublishActionNode>,
	): void {
		if (typeof document === "undefined") {
			return;
		}

		const selectors = [
			`.aside-public-file-publish-action[data-aside-public-file-view-id="${viewId}"]`,
			`.aside-public-html-publish-action[data-aside-public-file-view-id="${viewId}"]`,
			`[data-aside-public-file-action][data-aside-public-file-view-id="${viewId}"]`,
			`[data-aside-public-html-action][data-aside-public-file-view-id="${viewId}"]`,
			`.view-action[data-aside-public-file-action][data-aside-public-file-view-id="${viewId}"]`,
			`.view-action[data-aside-public-html-action][data-aside-public-file-view-id="${viewId}"]`,
			`[data-aside-public-file-view-id="${viewId}"]`,
		];
		for (const selector of selectors) {
			const publishActions = Array.from(document.querySelectorAll(selector));
			for (const actionEl of publishActions) {
				if (!isPublishActionNode(actionEl) || seen.has(actionEl)) {
					continue;
				}
				if (!this.shouldRemovePublishAction(actionEl, filePath, viewId, expectedActionKind)) {
					continue;
				}
				actionEl.remove();
				seen.add(actionEl);
			}
		}
	}

	private shouldRemovePublishAction(
		actionEl: LegacyPublishActionNode,
		filePath: string,
		viewId: string,
		expectedActionKind: PublicHtmlPublishActionState["kind"] | null,
	): boolean {
		const actionKind = actionEl.getAttribute("data-aside-public-file-action")
			?? actionEl.getAttribute("data-aside-public-html-action");
		const actionViewId = actionEl.getAttribute("data-aside-public-file-view-id");
		const actionFilePath = actionEl.getAttribute("data-aside-public-file-file-path");

		if (actionViewId) {
			return actionViewId === viewId;
		}
		if (actionKind && expectedActionKind !== null && actionKind !== expectedActionKind) {
			return false;
		}

		if (actionKind && actionFilePath) {
			return actionFilePath === filePath;
		}
		if (hasPublishButtonClass(actionEl)) {
			return true;
		}

		if (expectedActionKind !== null && actionKind) {
			return false;
		}

		// Fallback for legacy publish buttons without identifying attributes as part of this view refresh.
		return actionKind !== null;
	}

	private removeGlobalDuplicateActions(
		viewId: string,
		filePath: string,
		kind: PublicHtmlPublishActionState["kind"] | null,
	): void {
		this.removeGlobalViewActionsById(viewId, filePath, kind, new Set());
	}

	private getViewId(view: PublicFilePublishActionView): string {
		const existingId = this.viewIds.get(view);
		if (existingId) {
			return existingId;
		}
		const nextId = `aside-publish-view-${++this.nextViewId}`;
		this.viewIds.set(view, nextId);
		return nextId;
	}

	private async handleAction(
		view: PublicFilePublishActionView,
		state: PublicHtmlPublishActionState,
		actionEl: HTMLElement,
	): Promise<void> {
		const file = view.file;
		if (!file) {
			return;
		}
		if (state.disabled) {
			this.host.showNotice(state.notice);
			await this.refreshView(view);
			return;
		}

		actionEl.addClass("is-loading");
		await this.host.runPublishAction(file, state.kind);
		actionEl.removeClass("is-loading");
		await this.refreshView(view);
	}

	private removeViewActions(view: PublicFilePublishActionView): void {
		const actionEls = this.actionElsByView.get(view) ?? [];
		for (const actionEl of actionEls) {
			actionEl.remove();
		}
		this.actionElsByView.delete(view);
	}
}
