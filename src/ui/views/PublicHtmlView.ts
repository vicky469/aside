import {
	FileView,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import {
	PUBLIC_HTML_FILE_EXTENSIONS,
	PUBLIC_HTML_VIEW_TYPE,
} from "../../publish/publicHtmlViewTypes";

const EMPTY_PUBLIC_HTML_VIEW_DISPLAY_TEXT = "Public HTML";

export interface PublicHtmlViewHost {
	getResourcePath(file: TFile): string;
}

export default class PublicHtmlView extends FileView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: PublicHtmlViewHost,
	) {
		super(leaf);
		this.navigation = true;
	}

	public getViewType(): string {
		return PUBLIC_HTML_VIEW_TYPE;
	}

	public getDisplayText(): string {
		if (!this.file) {
			return EMPTY_PUBLIC_HTML_VIEW_DISPLAY_TEXT;
		}
		return this.file.path.split("/").at(-1) ?? this.file.basename;
	}

	public getIcon(): string {
		return "file-code";
	}

	public canAcceptExtension(extension: string): boolean {
		const normalizedExtension = extension.toLowerCase();
		return PUBLIC_HTML_FILE_EXTENSIONS.some((candidate) => candidate === normalizedExtension);
	}

	public onLoadFile(file: TFile): Promise<void> {
		this.renderFile(file);
		return Promise.resolve();
	}

	public onUnloadFile(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	private renderFile(file: TFile): void {
		this.contentEl.empty();
		this.contentEl.addClass("aside-public-html-view");
		this.contentEl.createEl("iframe", {
			cls: "aside-public-html-frame",
			attr: {
				title: file.path,
				src: this.host.getResourcePath(file),
				sandbox: "allow-same-origin",
			},
		});
	}
}
