import { App, Modal } from "obsidian";

export default class ConfirmDeleteModal extends Modal {
    onConfirm: () => void;
    private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

    constructor(app: App, onConfirm: () => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("sidenote2-confirm-modal");

        contentEl.createEl("h2", { text: "Delete comment" });
        contentEl.createEl("p", { text: "Are you sure you want to delete this comment? This action cannot be undone." });

        const footer = contentEl.createDiv("sidenote2-modal-footer");

        const cancelButton = footer.createEl("button", {
            text: "Cancel",
            cls: "sidenote2-modal-cancel-btn"
        });
        cancelButton.setAttribute("type", "button");
        cancelButton.setAttribute("aria-keyshortcuts", "Escape");
        cancelButton.onclick = () => {
            this.close();
        };

        const deleteButton = footer.createEl("button", {
            text: "Delete",
            cls: "mod-warning sidenote2-modal-submit-btn"
        });
        deleteButton.setAttribute("type", "button");
        deleteButton.setAttribute("aria-keyshortcuts", "Enter");
        deleteButton.onclick = () => {
            this.onConfirm();
            this.close();
        };

        this.keydownHandler = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                this.close();
                return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                this.onConfirm();
                this.close();
            }
        };
        this.modalEl.addEventListener("keydown", this.keydownHandler);
        window.setTimeout(() => {
            deleteButton.focus();
        }, 0);
    }

    onClose() {
        const { contentEl } = this;
        if (this.keydownHandler) {
            this.modalEl.removeEventListener("keydown", this.keydownHandler);
            this.keydownHandler = null;
        }
        contentEl.empty();
    }
}
