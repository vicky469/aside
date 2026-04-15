import { App, Modal } from "obsidian";
import type { SideNote2LogLevel } from "../../logs/logService";
import type { AttachedLogFile, SupportReportPayload } from "../../support/supportTypes";
import { formatFriendlyLocalDateTime } from "../../core/time/dateTime";
import SupportImagePreviewModal from "./SupportImagePreviewModal";
import SupportLogInspectorModal from "./SupportLogInspectorModal";
import SupportLogPreviewModal from "./SupportLogPreviewModal";
import {
    formatSupportAttachmentSize,
    validateScreenshotSelection,
    validateSupportReportInput,
} from "../views/supportReportPlanner";

interface SupportReportModalHost {
    pluginVersion: string;
    sessionId: string;
    attachedLog: AttachedLogFile | null;
    canLocateLogFileLocation(): boolean;
    useInteractiveLogPreview: boolean;
    log(level: SideNote2LogLevel, area: string, event: string, payload?: Record<string, unknown>): Promise<void>;
    locateLogFile(relativePath: string): Promise<boolean>;
    sendSupportReport(payload: SupportReportPayload): Promise<void>;
    showNotice(message: string): void;
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

type ScreenshotDraftAttachment = {
    id: string;
    file: File;
};

export default class SupportReportModal extends Modal {
    private email = "";
    private title = "";
    private content = "";
    private screenshotAttachments: ScreenshotDraftAttachment[] = [];
    private sending = false;
    private emailInputEl: HTMLInputElement | null = null;
    private titleInputEl: HTMLInputElement | null = null;
    private contentInputEl: HTMLTextAreaElement | null = null;
    private attachmentsEl: HTMLDivElement | null = null;
    private sendButtonEl: HTMLButtonElement | null = null;

    constructor(app: App, private readonly host: SupportReportModalHost) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("sidenote2-support-report-modal");
        this.setTitle("Report an issue");

        const intro = contentEl.createEl("p", {
            cls: "sidenote2-support-intro",
            text: "Describe what happened. The plugin will attach the last 30 minutes of local logs automatically.",
        });
        intro.setAttribute("role", "note");

        this.emailInputEl = contentEl.createEl("input", {
            cls: "sidenote2-support-field",
            attr: {
                type: "email",
                placeholder: "Email",
                autocomplete: "email",
            },
        });
        this.emailInputEl.addEventListener("input", () => {
            this.email = this.emailInputEl?.value ?? "";
        });

        this.titleInputEl = contentEl.createEl("input", {
            cls: "sidenote2-support-field",
            attr: {
                type: "text",
                placeholder: "Title",
            },
        });
        this.titleInputEl.addEventListener("input", () => {
            this.title = this.titleInputEl?.value ?? "";
        });

        this.contentInputEl = contentEl.createEl("textarea", {
            cls: "sidenote2-support-textarea",
            attr: {
                placeholder: "What happened? What did you expect instead?",
            },
        });
        this.contentInputEl.addEventListener("input", () => {
            this.content = this.contentInputEl?.value ?? "";
        });

        const attachmentHeader = contentEl.createDiv("sidenote2-support-attachments-header");
        attachmentHeader.createEl("h3", { text: "Attachments" });
        const addScreenshotButton = attachmentHeader.createEl("button", {
            text: "Add screenshots",
            cls: "sidenote2-modal-cancel-btn",
        });
        addScreenshotButton.setAttribute("type", "button");
        addScreenshotButton.onclick = () => {
            this.openScreenshotPicker();
        };

        this.attachmentsEl = contentEl.createDiv("sidenote2-support-attachments");
        this.renderAttachments();

        const footer = contentEl.createDiv("sidenote2-modal-footer");
        const cancelButton = footer.createEl("button", {
            text: "Cancel",
            cls: "sidenote2-modal-cancel-btn",
        });
        cancelButton.setAttribute("type", "button");
        cancelButton.onclick = () => {
            this.close();
        };

        this.sendButtonEl = footer.createEl("button", {
            text: "Send",
            cls: "mod-cta sidenote2-modal-submit-btn",
        });
        this.sendButtonEl.setAttribute("type", "button");
        this.sendButtonEl.onclick = () => {
            void this.handleSubmit();
        };
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderAttachments(): void {
        if (!this.attachmentsEl) {
            return;
        }

        this.attachmentsEl.empty();

        const logAttachment = this.host.attachedLog;
        if (logAttachment) {
            const row = this.attachmentsEl.createDiv("sidenote2-support-attachment");
            const meta = row.createDiv("sidenote2-support-attachment-meta");
            meta.createEl("strong", { text: logAttachment.fileName });
            meta.createEl("span", {
                text: [
                    logAttachment.windowMinutes ? `last ${logAttachment.windowMinutes} min` : null,
                    formatSupportAttachmentSize(logAttachment.sizeBytes),
                    formatFriendlyLocalDateTime(logAttachment.modifiedAt) ?? "today",
                ].filter(Boolean).join(" · "),
            });

            const actions = row.createDiv("sidenote2-support-attachment-actions");
            const previewButton = actions.createEl("button", {
                text: "Preview",
                cls: "sidenote2-modal-cancel-btn",
            });
            previewButton.setAttribute("type", "button");
            previewButton.onclick = () => {
                void this.host.log("info", "support", "support.log.preview.opened", {
                    fileName: logAttachment.fileName,
                    previewType: this.host.useInteractiveLogPreview ? "table" : "raw",
                    sizeBytes: logAttachment.sizeBytes,
                });
                const locateLogFile = this.host.canLocateLogFileLocation()
                    ? () => this.host.locateLogFile(logAttachment.relativePath)
                    : undefined;
                if (this.host.useInteractiveLogPreview) {
                    new SupportLogInspectorModal(this.app, {
                        fileName: logAttachment.fileName,
                        logContent: logAttachment.content,
                    }).open();
                    return;
                }

                new SupportLogPreviewModal(this.app, {
                    fileName: logAttachment.fileName,
                    logContent: logAttachment.content,
                    attachedWindowMinutes: logAttachment.windowMinutes,
                    locateLogFile,
                }).open();
            };
        } else {
            const emptyState = this.attachmentsEl.createDiv("sidenote2-support-attachment sidenote2-support-attachment-empty");
            emptyState.setText("Today’s log file is unavailable right now.");
        }

        for (const attachment of this.screenshotAttachments) {
            const row = this.attachmentsEl.createDiv("sidenote2-support-attachment");
            const meta = row.createDiv("sidenote2-support-attachment-meta");
            meta.createEl("strong", { text: attachment.file.name });
            meta.createEl("span", {
                text: [
                    formatSupportAttachmentSize(attachment.file.size),
                    formatFriendlyLocalDateTime(attachment.file.lastModified) ?? "selected",
                ].join(" · "),
            });

            const actions = row.createDiv("sidenote2-support-attachment-actions");
            const previewButton = actions.createEl("button", {
                text: "Preview",
                cls: "sidenote2-modal-cancel-btn",
            });
            previewButton.setAttribute("type", "button");
            previewButton.onclick = () => {
                new SupportImagePreviewModal(this.app, attachment.file).open();
            };

            const removeButton = actions.createEl("button", {
                text: "Remove",
                cls: "sidenote2-modal-cancel-btn",
            });
            removeButton.setAttribute("type", "button");
            removeButton.onclick = () => {
                this.screenshotAttachments = this.screenshotAttachments.filter((candidate) => candidate.id !== attachment.id);
                this.renderAttachments();
            };
        }
    }

    private openScreenshotPicker(): void {
        const inputEl = document.createElement("input");
        inputEl.type = "file";
        inputEl.accept = "image/png,image/jpeg,image/webp";
        inputEl.multiple = true;
        inputEl.onchange = () => {
            const selectedFiles = Array.from(inputEl.files ?? []);
            const selection = validateScreenshotSelection(selectedFiles, this.screenshotAttachments.length);
            if (selection.error) {
                this.host.showNotice(selection.error);
                return;
            }

            this.screenshotAttachments = this.screenshotAttachments.concat(
                selection.accepted.map((file) => ({
                    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}`,
                    file,
                })),
            );
            this.renderAttachments();
        };
        inputEl.click();
    }

    private async handleSubmit(): Promise<void> {
        const validation = validateSupportReportInput({
            email: this.email,
            title: this.title,
            content: this.content,
        });
        if (!validation.valid) {
            this.host.showNotice(validation.error ?? "Please complete the report form.");
            return;
        }

        const logAttachment = this.host.attachedLog;
        if (!logAttachment) {
            this.host.showNotice("Today’s log attachment is unavailable. Try again in a moment.");
            return;
        }

        this.sending = true;
        if (this.sendButtonEl) {
            this.sendButtonEl.disabled = true;
            this.sendButtonEl.textContent = "Sending...";
        }

        try {
            await this.host.log("info", "support", "support.submit.begin", {
                screenshotCount: this.screenshotAttachments.length,
                logSizeBytes: logAttachment.sizeBytes,
                titleLength: this.title.trim().length,
                contentLength: this.content.trim().length,
            });

            const screenshotAttachments = await Promise.all(this.screenshotAttachments.map(async ({ file }) => ({
                fileName: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
                contentBase64: await arrayBufferToBase64(await file.arrayBuffer()),
            })));

            const payload: SupportReportPayload = {
                email: this.email.trim(),
                title: this.title.trim(),
                content: this.content.trim(),
                pluginVersion: this.host.pluginVersion,
                sessionId: this.host.sessionId,
                logAttachment: {
                    fileName: logAttachment.fileName,
                    relativePath: logAttachment.relativePath,
                    sizeBytes: logAttachment.sizeBytes,
                    content: logAttachment.content,
                },
                screenshotAttachments,
            };

            await this.host.sendSupportReport(payload);
            await this.host.log("info", "support", "support.submit.success", {
                screenshotCount: screenshotAttachments.length,
            });
            this.host.showNotice("Support report sent.");
            this.close();
        } catch (error) {
            await this.host.log("error", "support", "support.submit.error", {
                screenshotCount: this.screenshotAttachments.length,
                error,
            });
            this.host.showNotice(error instanceof Error ? error.message : "Failed to send support report.");
        } finally {
            this.sending = false;
            if (this.sendButtonEl) {
                this.sendButtonEl.disabled = false;
                this.sendButtonEl.textContent = "Send";
            }
        }
    }
}
