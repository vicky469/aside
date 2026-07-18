import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import {
	isPublicFilePublishActionPath,
	PublicFilePublishActionController,
} from "../src/ui/views/publicFilePublishActions";
import type { PublicHtmlPublishActionState } from "../src/publish/publicHtmlPublishController";

class FakeActionElement {
	public readonly classes = new Set<string>();
	public readonly attributes = new Map<string, string>();
	public removed = false;

	public addClass(className: string): void {
		this.classes.add(className);
		const existingClassName = this.attributes.get("class") ?? "";
		if (existingClassName.length === 0) {
			this.attributes.set("class", className);
			return;
		}
		if (existingClassName.split(/\s+/u).includes(className)) {
			return;
		}
		this.attributes.set("class", `${existingClassName} ${className}`);
	}

	public setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	public getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	public remove(): void {
		this.removed = true;
	}
}

class FakeContainer {
	public readonly elements: FakeActionElement[] = [];

	public append(element: FakeActionElement): void {
		this.elements.push(element);
	}

	public querySelectorAll(selector: string): FakeActionElement[] {
		if (selector !== ".aside-public-file-publish-action" && selector !== ".aside-public-html-publish-action") {
			return [];
		}
		return this.elements.filter((element) => !element.removed);
	}
}

function createFile(path: string): TFile {
	return {
		path,
		basename: path.split("/").pop()?.replace(/\.[^.]+$/u, "") ?? path,
		extension: path.split(".").pop() ?? "",
	} as TFile;
}

function createView(filePath: string, containerEl?: FakeContainer) {
	const actions: Array<{
		icon: string;
		label: string;
		element: FakeActionElement;
		callback: (evt: MouseEvent) => void;
	}> = [];
		return {
			file: createFile(filePath),
		addAction(icon: string, label: string, callback: (evt: MouseEvent) => void) {
			const element = new FakeActionElement();
			actions.push({ icon, label, element, callback });
			if (containerEl) {
				containerEl.append(element);
			}
			return element as unknown as HTMLElement;
		},
		actions,
		containerEl: containerEl as unknown as HTMLElement | undefined,
	};
}

function matchesLegacyPublishActionSelector(node: FakeActionElement, selector: string): boolean {
	const specificViewIdMatch = /^\[data-aside-public-file-view-id="([^"]+)"\]$/u.exec(selector);
	if (specificViewIdMatch) {
		return node.getAttribute("data-aside-public-file-view-id") === specificViewIdMatch[1];
	}

	const specificActionViewIdMatch =
		/^\.view-action\[data-aside-public-file-action\]\[data-aside-public-file-view-id="([^"]+)"\]$/u
		.exec(selector);
	if (specificActionViewIdMatch) {
		return node.classes.has("view-action")
			&& node.attributes.has("data-aside-public-file-action")
			&& node.getAttribute("data-aside-public-file-view-id") === specificActionViewIdMatch[1];
	}

	const specificHtmlActionViewIdMatch =
		/^\.view-action\[data-aside-public-html-action\]\[data-aside-public-file-view-id="([^"]+)"\]$/u
		.exec(selector);
	if (specificHtmlActionViewIdMatch) {
		return node.classes.has("view-action")
			&& node.attributes.has("data-aside-public-html-action")
			&& node.getAttribute("data-aside-public-file-view-id") === specificHtmlActionViewIdMatch[1];
	}

	if (selector === ".aside-public-file-publish-action") {
		return node.classes.has("aside-public-file-publish-action");
	}
	if (selector === ".view-action[data-aside-public-file-action]") {
		return node.classes.has("view-action") && node.attributes.has("data-aside-public-file-action");
	}
	if (selector === "[data-aside-public-file-action]") {
		return node.attributes.has("data-aside-public-file-action");
	}
	if (selector === ".aside-public-html-publish-action") {
		return node.classes.has("aside-public-html-publish-action");
	}
	if (selector === ".view-action[data-aside-public-html-action]") {
		return node.classes.has("view-action") && node.attributes.has("data-aside-public-html-action");
	}
	if (selector === "[data-aside-public-html-action]") {
		return node.attributes.has("data-aside-public-html-action");
	}
	if (selector === "[data-aside-public-file-file-path]") {
		return node.attributes.has("data-aside-public-file-file-path");
	}
	if (selector === "[data-aside-public-file-view-id]") {
		return node.attributes.has("data-aside-public-file-view-id");
	}
	if (selector === ".view-action[data-aside-public-file-action][data-aside-public-file-view-id=\"aside-publish-view-1\"]") {
		return node.classes.has("view-action")
			&& node.getAttribute("data-aside-public-file-action") !== null
			&& node.getAttribute("data-aside-public-file-view-id") === "aside-publish-view-1";
	}
	if (selector === ".view-action[data-aside-public-html-action][data-aside-public-file-view-id=\"aside-publish-view-1\"]") {
		return node.classes.has("view-action")
			&& node.getAttribute("data-aside-public-html-action") !== null
			&& node.getAttribute("data-aside-public-file-view-id") === "aside-publish-view-1";
	}
	return false;
}

function withFakeDocument(
	documentNodes: FakeActionElement[],
	testFn: () => Promise<void> | void,
): Promise<void> | void {
	const previousDocument = globalThis.document;
	const fakeDocument = {
		querySelectorAll: (selector: string): FakeActionElement[] => documentNodes.filter((node) =>
			matchesLegacyPublishActionSelector(node, selector)),
	} as unknown as Document;
	(globalThis as { document?: Document }).document = fakeDocument;
	try {
		return testFn();
	} finally {
		(globalThis as { document?: Document }).document = previousDocument;
	}
}

test("isPublicFilePublishActionPath supports markdown, html, and pdf files under public", () => {
	assert.equal(isPublicFilePublishActionPath("public/page.md", "public/"), true);
	assert.equal(isPublicFilePublishActionPath("public/page.html", "public/"), true);
	assert.equal(isPublicFilePublishActionPath("public/report.pdf", "public/"), true);
	assert.equal(isPublicFilePublishActionPath("page.md", "public/"), false);
	assert.equal(isPublicFilePublishActionPath("page.html", "public/"), false);
	assert.equal(isPublicFilePublishActionPath("notes/page.md", "public/"), false);
	assert.equal(isPublicFilePublishActionPath("public/image.png", "public/"), false);
});

test("PublicFilePublishActionController renders publish actions on markdown, html, and pdf views", async () => {
	const markdownView = createView("public/page.md");
	const pdfView = createView("public/report.pdf");
	const htmlView = createView("public/page.html");
	const statesByPath = new Map<string, PublicHtmlPublishActionState[]>([
		["public/page.md", [{
			kind: "publish",
			label: "Publish HTML",
			icon: "upload-cloud",
			disabled: false,
		}]],
		["public/page.html", [{
			kind: "unpublish",
			label: "Unpublish HTML",
			icon: "cloud-off",
			disabled: false,
		}, {
			kind: "update-publish",
			label: "Republish HTML",
			icon: "upload-cloud",
			disabled: false,
		}, {
			kind: "open-published",
			label: "Open published HTML",
			icon: "external-link",
			disabled: false,
			url: "https://publish.example.com/public/page.html",
		}]],
		["public/report.pdf", [{
			kind: "unpublish",
			label: "Unpublish PDF",
			icon: "cloud-off",
			disabled: false,
		}, {
			kind: "update-publish",
			label: "Republish PDF",
			icon: "upload-cloud",
			disabled: false,
		}, {
			kind: "open-published",
			label: "Open published PDF",
			icon: "external-link",
			disabled: false,
			url: "https://publish.example.com/public/report.pdf",
		}]],
	]);
	const controller = new PublicFilePublishActionController({
		getAllowedRoot: () => "public/",
		getPublishActionStates: async (file) => statesByPath.get(file.path) ?? [],
		runPublishAction: async () => {},
		showNotice: () => {},
	});

	await controller.refreshViews([markdownView, pdfView, htmlView]);

	assert.deepEqual(markdownView.actions.map((action) => action.label), ["Publish HTML"]);
	assert.deepEqual(pdfView.actions.map((action) => action.label), ["Open published PDF", "Republish PDF", "Unpublish PDF"]);
	assert.deepEqual(htmlView.actions.map((action) => action.label), ["Open published HTML", "Republish HTML", "Unpublish HTML"]);
	assert.equal(markdownView.actions[0].element.classes.has("aside-public-file-publish-action"), true);
	assert.equal(pdfView.actions[1].element.attributes.get("data-aside-public-file-action"), "update-publish");
	assert.equal(pdfView.actions[0].element.attributes.get("data-aside-public-file-action"), "open-published");
});

test("PublicFilePublishActionController avoids duplicate actions when refresh runs concurrently", async () => {
	const markdownView = createView("public/page.md");
	let releasePending: () => void;
	const pending = new Promise<void>((resolve) => {
		releasePending = resolve;
	});
	const controller = new PublicFilePublishActionController({
		getAllowedRoot: () => "public/",
		getPublishActionStates: async () => {
			await pending;
			return [{
				kind: "publish",
				label: "Publish",
				icon: "upload-cloud",
				disabled: false,
			}];
		},
		runPublishAction: async () => {},
		showNotice: () => {},
	});

	const firstRefresh = controller.refreshViews([markdownView]);
	const secondRefresh = controller.refreshViews([markdownView]);
	releasePending!();

	await Promise.all([firstRefresh, secondRefresh]);

	const activeActions = markdownView.actions.filter((action) => !action.element.removed);
	assert.equal(activeActions.length, 1);
	assert.equal(activeActions[0].label, "Publish");
});

test("PublicFilePublishActionController deduplicates repeated state kinds", async () => {
	const markdownView = createView("public/page.md");
	const controller = new PublicFilePublishActionController({
		getAllowedRoot: () => "public/",
		getPublishActionStates: async () => [{
			kind: "publish",
			label: "Publish",
			icon: "upload-cloud",
			disabled: false,
		}, {
			kind: "publish",
			label: "Publish HTML",
			icon: "upload-cloud",
			disabled: false,
		}],
		runPublishAction: async () => {},
		showNotice: () => {},
	});

	await controller.refreshViews([markdownView]);

	const activeActions = markdownView.actions.filter((action) => !action.element.removed);
	assert.equal(activeActions.length, 1);
	assert.equal(activeActions[0].label, "Publish HTML");
});

test("PublicFilePublishActionController clears stale publish actions before rendering", async () => {
	const legacyElement = new FakeActionElement();
	legacyElement.addClass("aside-public-file-publish-action");
	const differentLegacyElement = new FakeActionElement();
	differentLegacyElement.addClass("aside-public-file-publish-action");
	const htmlLegacyElement = new FakeActionElement();
	htmlLegacyElement.addClass("aside-public-html-publish-action");
	const container = new FakeContainer();
	container.append(legacyElement);
	container.append(differentLegacyElement);
	container.append(htmlLegacyElement);
	const markdownView = createView("public/page.md", container);

	const controller = new PublicFilePublishActionController({
		getAllowedRoot: () => "public/",
		getPublishActionStates: async () => [{
			kind: "publish",
			label: "Publish HTML",
			icon: "upload-cloud",
			disabled: false,
		}],
		runPublishAction: async () => {},
		showNotice: () => {},
	});

	await controller.refreshViews([markdownView]);

	const activeActions = markdownView.actions.filter((action) => !action.element.removed);
	assert.equal(activeActions.length, 1);
	assert.equal(activeActions[0].label, "Publish HTML");
	assert.equal(legacyElement.removed, true);
	assert.equal(differentLegacyElement.removed, true);
	assert.equal(htmlLegacyElement.removed, true);
});

test("PublicFilePublishActionController clears stale publish actions from other file paths before rendering", async () => {
	const staleLegacyElement = new FakeActionElement();
	staleLegacyElement.addClass("aside-public-file-publish-action");
	staleLegacyElement.setAttribute("data-aside-public-file-file-path", "public/old.md");
	const staleLegacyAction = new FakeActionElement();
	staleLegacyAction.addClass("view-action");
	staleLegacyAction.setAttribute("data-aside-public-file-action", "update-publish");
	staleLegacyAction.setAttribute("data-aside-public-file-view-id", "aside-publish-view-1");
	const currentPathAction = new FakeActionElement();
	currentPathAction.addClass("view-action");
	currentPathAction.setAttribute("data-aside-public-file-action", "update-publish");
	currentPathAction.setAttribute("data-aside-public-file-view-id", "aside-publish-view-1");
	const markdownView = createView("public/page.md");
	const controller = new PublicFilePublishActionController({
		getAllowedRoot: () => "public/",
		getPublishActionStates: async () => [{
			kind: "publish",
			label: "Publish HTML",
			icon: "upload-cloud",
			disabled: false,
		}],
		runPublishAction: async () => {},
		showNotice: () => {},
	});
	const restore = (result: Promise<void> | void): Promise<void> => {
		return Promise.resolve(result);
	};
	const result = withFakeDocument([staleLegacyElement, staleLegacyAction, currentPathAction], async () => {
		await controller.refreshViews([markdownView]);
	});

	await restore(result);

	assert.equal(staleLegacyElement.removed, true);
	assert.equal(staleLegacyAction.removed, true);
	assert.equal(currentPathAction.removed, true);
});
