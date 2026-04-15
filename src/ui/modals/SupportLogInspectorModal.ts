import { App, Modal } from "obsidian";
import {
    buildSupportLogPreviewFromSource,
    buildSupportLogPreviewSource,
    type SupportLogKind,
    type SupportLogPreviewModel,
    type SupportLogPreviewSource,
    formatSupportLogSummaryLine,
} from "../views/supportReportPlanner";

interface SupportLogInspectorModalOptions {
    fileName: string;
    logContent: string;
    locateLogFile?: (() => Promise<boolean>) | undefined;
}

export default class SupportLogInspectorModal extends Modal {
    private readonly filterWindowOptions = [5, 10, 20, 30] as const;
    private readonly modalClassName = "sidenote2-support-log-modal";
    private selectedWindowMinutes: number = 5;
    private selectedKind: "all" | SupportLogKind = "all";
    private customLogContent: string | null = null;
    private customLogFileName: string | null = null;
    private customInputValue = "";
    private inputRefreshTimeout: number | null = null;
    private canLocateLogFile = false;
    private cachedPreviewSource: SupportLogPreviewSource | null = null;
    private cachedPreviewSourceContent: string | null = null;
    private cachedPreviewModels = new Map<string, SupportLogPreviewModel>();
    private inputEl: HTMLTextAreaElement | null = null;
    private actionsEl: HTMLDivElement | null = null;
    private resultsEl: HTMLDivElement | null = null;
    private summaryCardEl: HTMLDivElement | null = null;
    private summaryHeadingEl: HTMLElement | null = null;
    private summaryRangeEl: HTMLSpanElement | null = null;
    private infoBadgeEl: HTMLDivElement | null = null;
    private warnBadgeEl: HTMLDivElement | null = null;
    private errorBadgeEl: HTMLDivElement | null = null;
    private userBadgeEl: HTMLDivElement | null = null;
    private systemBadgeEl: HTMLDivElement | null = null;
    private controlsEl: HTMLDivElement | null = null;
    private invalidLinesNoteEl: HTMLParagraphElement | null = null;
    private rawFallbackNoteEl: HTMLParagraphElement | null = null;
    private rawPreviewEl: HTMLTextAreaElement | null = null;
    private emptyStateEl: HTMLDivElement | null = null;
    private tableWrapEl: HTMLDivElement | null = null;
    private tableBodyEl: HTMLTableSectionElement | null = null;
    private windowFilterButtons = new Map<number, HTMLButtonElement>();
    private kindFilterButtons = new Map<"all" | SupportLogKind, HTMLButtonElement>();

    constructor(app: App, private readonly options: SupportLogInspectorModalOptions) {
        super(app);
        this.canLocateLogFile = Boolean(options.locateLogFile);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.modalEl.addClass(this.modalClassName);
        contentEl.empty();
        contentEl.addClass("sidenote2-support-log-preview-modal");
        this.renderInspectorInput(contentEl);
        this.renderActions(contentEl);
        this.resultsEl = contentEl.createDiv("sidenote2-support-log-results");
        this.buildResultsChrome(this.resultsEl);
        this.renderResults();
    }

    private renderResults(): void {
        if (!this.resultsEl) {
            return;
        }

        const activeSource = this.getActiveSource();
        this.setTitle(activeSource.fileName);

        if (!activeSource.content.trim()) {
            this.setSectionVisible(this.summaryCardEl, false);
            this.setSectionVisible(this.controlsEl, false);
            this.setSectionVisible(this.invalidLinesNoteEl, false);
            this.setSectionVisible(this.rawFallbackNoteEl, false);
            this.setSectionVisible(this.rawPreviewEl, false);
            this.setSectionVisible(this.tableWrapEl, false);
            this.renderEmptyState("Paste or drop JSONL to render the log table.");
            return;
        }

        const preview = this.getPreviewModel(activeSource.content);
        this.updateFilterButtons();

        if (preview.rawFallbackContent !== null) {
            this.setSectionVisible(this.summaryCardEl, false);
            this.setSectionVisible(this.controlsEl, false);
            this.setSectionVisible(this.invalidLinesNoteEl, false);
            this.setSectionVisible(this.tableWrapEl, false);
            this.setSectionVisible(this.emptyStateEl, false);
            this.setSectionVisible(this.rawFallbackNoteEl, true);
            this.setSectionVisible(this.rawPreviewEl, true);
            if (this.rawPreviewEl) {
                this.rawPreviewEl.setAttribute("aria-label", `${activeSource.fileName} preview`);
                this.rawPreviewEl.value = preview.rawFallbackContent;
            }
            return;
        }

        const hasParsedRows = preview.summary.totalEvents > 0;
        this.setSectionVisible(this.summaryCardEl, hasParsedRows);
        this.setSectionVisible(this.controlsEl, hasParsedRows);
        this.setSectionVisible(this.rawFallbackNoteEl, false);
        this.setSectionVisible(this.rawPreviewEl, false);

        if (hasParsedRows) {
            const summaryEventCount = preview.summary.hiddenEvents > 0
                ? `${preview.summary.shownEvents} of ${preview.summary.filteredEvents}`
                : `${preview.summary.filteredEvents}`;
            this.summaryHeadingEl?.setText(`${summaryEventCount} events in last ${this.selectedWindowMinutes} min`);
            this.summaryRangeEl?.setText(
                preview.summary.filteredEvents > 0
                    ? formatSupportLogSummaryLine(preview.summary)
                    : "No events match the current filters.",
            );
            this.infoBadgeEl?.setText(`Info ${preview.summary.counts.info}`);
            this.warnBadgeEl?.setText(`Warn ${preview.summary.counts.warn}`);
            this.errorBadgeEl?.setText(`Error ${preview.summary.counts.error}`);
            this.userBadgeEl?.setText(`User ${preview.summary.kindCounts.user}`);
            this.systemBadgeEl?.setText(`System ${preview.summary.kindCounts.system}`);
        }

        if (preview.summary.invalidLines > 0) {
            this.invalidLinesNoteEl?.setText(`Skipped ${preview.summary.invalidLines} unparseable log lines in the table preview.`);
            this.setSectionVisible(this.invalidLinesNoteEl, true);
        } else {
            this.setSectionVisible(this.invalidLinesNoteEl, false);
        }

        if (!preview.rows.length) {
            this.setSectionVisible(this.tableWrapEl, false);
            this.renderEmptyState(`No log events in the last ${this.selectedWindowMinutes} minutes.`);
            return;
        }

        this.setSectionVisible(this.emptyStateEl, false);
        this.setSectionVisible(this.tableWrapEl, true);
        if (this.tableBodyEl) {
            this.renderTableRows(preview, this.tableBodyEl);
        }
    }

    private renderInspectorInput(contentEl: HTMLElement): void {
        const devPanelEl = contentEl.createDiv("sidenote2-support-log-dev-panel");
        const devPanelHeaderEl = devPanelEl.createDiv("sidenote2-support-log-dev-panel-header");
        devPanelHeaderEl.createEl("strong", {
            text: "Inspector input",
        });
        devPanelHeaderEl.createEl("span", {
            text: "Paste or drop log data to inspect it locally.",
        });

        const dropzoneEl = devPanelEl.createDiv("sidenote2-support-log-dev-dropzone");
        const inputEl = dropzoneEl.createEl("textarea", {
            cls: "sidenote2-support-log-dev-input",
            attr: {
                placeholder: "Paste or drop log data here.",
                spellcheck: "false",
                wrap: "off",
                "aria-label": "Log inspector input",
            },
        });
        this.inputEl = inputEl;
        inputEl.value = this.customInputValue;
        inputEl.addEventListener("input", () => {
            this.customInputValue = inputEl.value;
            this.scheduleInputRefresh();
        });
        dropzoneEl.addEventListener("dragover", (event) => {
            event.preventDefault();
            dropzoneEl.addClass("is-active");
        });
        dropzoneEl.addEventListener("dragleave", () => {
            dropzoneEl.removeClass("is-active");
        });
        dropzoneEl.addEventListener("drop", (event) => {
            event.preventDefault();
            dropzoneEl.removeClass("is-active");
            void this.handleDroppedFiles(event.dataTransfer?.files ?? null);
        });
    }

    private renderActions(contentEl: HTMLElement): void {
        this.actionsEl?.remove();
        this.actionsEl = null;
        if (!this.canLocateLogFile || !this.options.locateLogFile) {
            return;
        }

        const actions = contentEl.createDiv("sidenote2-support-log-preview-actions");
        this.actionsEl = actions;
        const locateButton = actions.createEl("button", {
            text: "Locate log",
            cls: "sidenote2-modal-cancel-btn",
        });
        locateButton.setAttribute("type", "button");
        locateButton.onclick = () => {
            void this.handleLocateLogFile();
        };
    }

    private buildResultsChrome(resultsEl: HTMLElement): void {
        const summaryCard = resultsEl.createDiv("sidenote2-support-log-summary");
        this.summaryCardEl = summaryCard;
        const summaryMeta = summaryCard.createDiv("sidenote2-support-log-summary-meta");
        this.summaryHeadingEl = summaryMeta.createEl("strong");
        this.summaryRangeEl = summaryMeta.createEl("span");

        const badges = summaryCard.createDiv("sidenote2-support-log-summary-badges");
        this.infoBadgeEl = badges.createDiv("sidenote2-support-log-summary-badge is-info");
        this.warnBadgeEl = badges.createDiv("sidenote2-support-log-summary-badge is-warn");
        this.errorBadgeEl = badges.createDiv("sidenote2-support-log-summary-badge is-error");
        this.userBadgeEl = badges.createDiv("sidenote2-support-log-summary-badge is-user");
        this.systemBadgeEl = badges.createDiv("sidenote2-support-log-summary-badge is-system");

        this.invalidLinesNoteEl = resultsEl.createEl("p", {
            cls: "sidenote2-support-preview-note",
        });

        const controlsEl = resultsEl.createDiv("sidenote2-support-log-controls");
        this.controlsEl = controlsEl;

        const windowFilterBar = controlsEl.createDiv("sidenote2-support-log-filter-bar");
        windowFilterBar.createEl("span", {
            cls: "sidenote2-support-log-filter-label",
            text: "Window",
        });
        for (const windowMinutes of this.filterWindowOptions) {
            const filterButton = windowFilterBar.createEl("button", {
                text: `${windowMinutes} min`,
                cls: "sidenote2-support-log-filter-button",
            });
            filterButton.setAttribute("type", "button");
            filterButton.onclick = () => {
                if (this.selectedWindowMinutes === windowMinutes) {
                    return;
                }
                this.selectedWindowMinutes = windowMinutes;
                this.renderResults();
            };
            this.windowFilterButtons.set(windowMinutes, filterButton);
        }

        const kindFilterBar = controlsEl.createDiv("sidenote2-support-log-filter-bar");
        kindFilterBar.createEl("span", {
            cls: "sidenote2-support-log-filter-label",
            text: "Behavior",
        });
        const kindOptions: Array<{ value: "all" | SupportLogKind; label: string }> = [
            { value: "all", label: "All" },
            { value: "user", label: "User" },
            { value: "system", label: "System" },
        ];
        for (const kindOption of kindOptions) {
            const filterButton = kindFilterBar.createEl("button", {
                text: kindOption.label,
                cls: "sidenote2-support-log-filter-button",
            });
            filterButton.setAttribute("type", "button");
            filterButton.onclick = () => {
                if (this.selectedKind === kindOption.value) {
                    return;
                }
                this.selectedKind = kindOption.value;
                this.renderResults();
            };
            this.kindFilterButtons.set(kindOption.value, filterButton);
        }

        this.rawFallbackNoteEl = resultsEl.createEl("p", {
            cls: "sidenote2-support-preview-note",
            text: "Showing raw text because this content could not be parsed into event rows.",
        });
        this.rawPreviewEl = resultsEl.createEl("textarea", {
            cls: "sidenote2-support-log-preview sidenote2-support-log-preview-raw",
            attr: {
                readonly: "true",
                spellcheck: "false",
                wrap: "off",
            },
        });

        this.emptyStateEl = resultsEl.createDiv("sidenote2-support-empty-log-state");

        this.tableWrapEl = resultsEl.createDiv("sidenote2-support-log-table-wrap");
        const previewTableEl = this.tableWrapEl.createEl("table", {
            cls: "sidenote2-support-log-table",
        });
        const tableHeadEl = previewTableEl.createTHead();
        const headerRowEl = tableHeadEl.insertRow();
        for (const header of ["Time", "Level", "Behavior", "Area", "Event", "Details"]) {
            headerRowEl.createEl("th", { text: header });
        }
        this.tableBodyEl = previewTableEl.createTBody();

        this.setSectionVisible(this.summaryCardEl, false);
        this.setSectionVisible(this.controlsEl, false);
        this.setSectionVisible(this.invalidLinesNoteEl, false);
        this.setSectionVisible(this.rawFallbackNoteEl, false);
        this.setSectionVisible(this.rawPreviewEl, false);
        this.setSectionVisible(this.emptyStateEl, false);
        this.setSectionVisible(this.tableWrapEl, false);
    }

    private getActiveSource(): {
        fileName: string;
        content: string;
    } {
        if (this.customLogContent !== null) {
            return {
                fileName: this.customLogFileName ?? "Custom JSONL",
                content: this.customLogContent,
            };
        }

        return {
            fileName: this.options.fileName,
            content: this.options.logContent,
        };
    }

    private getPreviewSource(content: string): SupportLogPreviewSource {
        this.ensureSourceCaches(content);
        return this.cachedPreviewSource!;
    }

    private ensureSourceCaches(content: string): void {
        if (this.cachedPreviewSource && this.cachedPreviewSourceContent === content) {
            return;
        }

        this.cachedPreviewSource = buildSupportLogPreviewSource(content);
        this.cachedPreviewSourceContent = content;
        this.cachedPreviewModels.clear();
    }

    private getPreviewModel(content: string): SupportLogPreviewModel {
        const previewSource = this.getPreviewSource(content);
        const cacheKey = this.getPreviewFilterKey();
        const cached = this.cachedPreviewModels.get(cacheKey);
        if (cached) {
            return cached;
        }

        const preview = buildSupportLogPreviewFromSource(previewSource, {
            recentWindowMinutes: this.selectedWindowMinutes,
            kind: this.selectedKind,
        });
        this.cachedPreviewModels.set(cacheKey, preview);
        return preview;
    }

    private getPreviewFilterKey(): string {
        return `${this.selectedWindowMinutes}:${this.selectedKind}`;
    }

    private updateFilterButtons(): void {
        for (const [windowMinutes, button] of this.windowFilterButtons) {
            button.toggleClass("is-active", windowMinutes === this.selectedWindowMinutes);
        }
        for (const [kind, button] of this.kindFilterButtons) {
            button.toggleClass("is-active", kind === this.selectedKind);
        }
    }

    private renderEmptyState(message: string): void {
        if (this.emptyStateEl) {
            this.emptyStateEl.setText(message);
        }
        this.setSectionVisible(this.emptyStateEl, true);
    }

    private renderTableRows(preview: SupportLogPreviewModel, tableBodyEl: HTMLTableSectionElement): void {
        const document = tableBodyEl.ownerDocument;
        const fragment = document.createDocumentFragment();

        for (const row of preview.rows) {
            const rowEl = fragment.appendChild(document.createElement("tr"));
            rowEl.className = `is-${row.level}`;

            const appendCell = (className: string, text: string): void => {
                const cellEl = rowEl.appendChild(document.createElement("td"));
                const spanEl = cellEl.appendChild(document.createElement("span"));
                spanEl.className = className;
                spanEl.textContent = text;
            };

            appendCell("sidenote2-support-log-row-time", row.displayTime);
            appendCell(`sidenote2-support-log-row-level is-${row.level}`, row.level.toUpperCase());
            appendCell(`sidenote2-support-log-row-kind is-${row.kind}`, row.kind === "user" ? "USER" : "SYSTEM");
            appendCell("sidenote2-support-log-row-area", row.area);
            appendCell("sidenote2-support-log-row-event", row.event);

            const detailsCellEl = rowEl.appendChild(document.createElement("td"));
            detailsCellEl.className = "sidenote2-support-log-row-details";
            if (row.payloadTokens.length === 0) {
                const emptyEl = detailsCellEl.appendChild(document.createElement("span"));
                emptyEl.className = "sidenote2-support-log-row-token is-empty";
                emptyEl.textContent = "—";
            } else {
                for (const token of row.payloadTokens) {
                    const tokenEl = detailsCellEl.appendChild(document.createElement("span"));
                    tokenEl.className = "sidenote2-support-log-row-token";
                    tokenEl.textContent = token;
                }
            }
        }

        tableBodyEl.replaceChildren(fragment);
    }

    private setSectionVisible(element: HTMLElement | null, visible: boolean): void {
        if (!element) {
            return;
        }
        element.style.display = visible ? "" : "none";
    }

    private async handleLocateLogFile(): Promise<void> {
        const located = await this.options.locateLogFile?.();
        if (located) {
            return;
        }

        this.canLocateLogFile = false;
        this.renderActions(this.contentEl);
    }

    private scheduleInputRefresh(): void {
        if (this.inputRefreshTimeout !== null) {
            window.clearTimeout(this.inputRefreshTimeout);
        }

        this.inputRefreshTimeout = window.setTimeout(() => {
            this.inputRefreshTimeout = null;
            this.applyCustomInputPreview();
        }, 120);
    }

    private applyCustomInputPreview(): void {
        if (!this.customInputValue.trim()) {
            this.customLogContent = null;
            this.customLogFileName = null;
            this.renderResults();
            return;
        }

        this.customLogContent = this.customInputValue;
        this.customLogFileName = "Pasted JSONL";
        this.renderResults();
    }

    private async handleDroppedFiles(files: FileList | null): Promise<void> {
        const file = files?.item(0);
        if (!file) {
            this.renderResults();
            return;
        }

        try {
            const text = await file.text();
            this.customInputValue = text;
            this.customLogContent = text;
            this.customLogFileName = file.name || "Dropped JSONL";
            if (this.inputEl) {
                this.inputEl.value = text;
            }
        } finally {
            this.renderResults();
        }
    }

    onClose(): void {
        if (this.inputRefreshTimeout !== null) {
            window.clearTimeout(this.inputRefreshTimeout);
            this.inputRefreshTimeout = null;
        }
        this.inputEl = null;
        this.actionsEl = null;
        this.resultsEl = null;
        this.cachedPreviewSource = null;
        this.cachedPreviewSourceContent = null;
        this.cachedPreviewModels.clear();
        this.summaryCardEl = null;
        this.summaryHeadingEl = null;
        this.summaryRangeEl = null;
        this.infoBadgeEl = null;
        this.warnBadgeEl = null;
        this.errorBadgeEl = null;
        this.userBadgeEl = null;
        this.systemBadgeEl = null;
        this.controlsEl = null;
        this.invalidLinesNoteEl = null;
        this.rawFallbackNoteEl = null;
        this.rawPreviewEl = null;
        this.emptyStateEl = null;
        this.tableWrapEl = null;
        this.tableBodyEl = null;
        this.windowFilterButtons.clear();
        this.kindFilterButtons.clear();
        this.modalEl.removeClass(this.modalClassName);
        this.contentEl.empty();
    }
}
