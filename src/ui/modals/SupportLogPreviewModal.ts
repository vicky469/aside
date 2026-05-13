import { App, Modal } from "obsidian";
import { truncateLogPreview } from "../views/supportReportPlanner";

interface SupportLogPreviewModalOptions {
    fileName: string;
    logContent: string;
    attachedWindowMinutes: number | null;
    locateLogFile?: (() => Promise<boolean>) | undefined;
}

export default class SupportLogPreviewModal extends Modal {
    private canLocateLogFile = false;
    private readonly modalClassName = "aside-support-log-modal";

    constructor(app: App, private readonly options: SupportLogPreviewModalOptions) {
        super(app);
        this.canLocateLogFile = Boolean(options.locateLogFile);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.modalEl.addClass(this.modalClassName);
        this.setTitle(this.options.fileName);

        contentEl.empty();
        contentEl.addClass("aside-support-log-preview-modal");
        contentEl.createEl("p", {
            cls: "aside-support-preview-note",
            text: `Preview shows the attached raw log snapshot. The report includes the last ${this.options.attachedWindowMinutes ?? 30} minutes of local logs.`,
        });

        if (this.canLocateLogFile && this.options.locateLogFile) {
            const actions = contentEl.createDiv("aside-support-log-preview-actions");
            const openFileButton = actions.createEl("button", {
                text: "Locate log",
                cls: "aside-modal-cancel-btn",
            });
            openFileButton.setAttribute("type", "button");
            openFileButton.onclick = () => {
                void this.handleLocateLogFile(actions);
            };
        }

        const rawPreview = truncateLogPreview(this.options.logContent);
        if (rawPreview.truncated) {
            contentEl.createEl("p", {
                cls: "aside-support-preview-note",
                text: "Preview truncated for readability.",
            });
        }

        const rawPreviewEl = contentEl.createEl("textarea", {
            cls: "aside-support-log-preview aside-support-log-preview-raw",
            attr: {
                readonly: "true",
                spellcheck: "false",
                wrap: "off",
                "aria-label": `${this.options.fileName} preview`,
            },
        });
        rawPreviewEl.value = rawPreview.content;
    }

    onClose(): void {
        this.modalEl.removeClass(this.modalClassName);
        this.contentEl.empty();
    }

    private async handleLocateLogFile(actionsEl: HTMLElement): Promise<void> {
        const located = await this.options.locateLogFile?.();
        if (located) {
            return;
        }

        this.canLocateLogFile = false;
        actionsEl.remove();
    }
}
