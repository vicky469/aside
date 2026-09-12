interface AnchorPreviewControl {
    button: HTMLButtonElement;
}

/** One observer per sidebar, shared by saved and draft anchor previews. */
export class SidebarAnchorPreviews {
    private readonly controls = new Map<HTMLElement, AnchorPreviewControl>();
    private observer: ResizeObserver | null = null;

    refresh(container: HTMLElement): void {
        const previews = new Set(Array.from(container.querySelectorAll<HTMLElement>(".aside-comment-meta-preview")));
        for (const [preview, control] of this.controls) {
            if (!previews.has(preview)) {
                this.observer?.unobserve(preview);
                control.button.remove();
                this.controls.delete(preview);
            }
        }
        const Observer = container.ownerDocument.defaultView?.ResizeObserver;
        if (!this.observer && Observer) {
            this.observer = new Observer(() => this.updateControls());
        }
        for (const preview of previews) {
            if (!this.controls.has(preview)) {
                const button = createDetachedObsidianElement(preview.ownerDocument, "button");
                button.type = "button";
                button.className = "aside-anchor-preview-toggle";
                button.hidden = true;
                button.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    preview.classList.toggle("is-expanded");
                    preview.scrollTop = 0;
                    this.updateControls();
                });
                preview.insertAdjacentElement("afterend", button);
                this.controls.set(preview, { button });
                this.observer?.observe(preview);
            }
        }
        this.updateControls();
    }

    private updateControls(): void {
        for (const [preview, control] of this.controls) {
            if (!preview.isConnected) {
                this.observer?.unobserve(preview);
                control.button.remove();
                this.controls.delete(preview);
            }
        }
        // Measure all previews before changing layout, including during sidebar resizing.
        const states = Array.from(this.controls, ([preview, { button }]) => ({
            button,
            expanded: preview.classList.contains("is-expanded"),
            overflowing: preview.scrollHeight > preview.clientHeight + 1,
        }));
        for (const { button, expanded, overflowing } of states) {
            button.hidden = !expanded && !overflowing;
            const label = expanded ? "Show less" : "Show more";
            if (button.textContent !== label) button.textContent = label;
            button.setAttribute("aria-expanded", String(expanded));
            button.setAttribute("aria-label", `${label} anchored text`);
        }
    }

    revealMatch(target: HTMLElement): void {
        const preview = target.closest<HTMLElement>(".aside-comment-meta-preview");
        if (preview && this.controls.has(preview) && preview.scrollHeight > preview.clientHeight + 1) {
            const bounds = preview.getBoundingClientRect();
            const match = target.getBoundingClientRect();
            if (match.top < bounds.top || match.bottom > bounds.bottom) {
                preview.classList.add("is-expanded");
                this.updateControls();
            }
        }
    }

    dispose(): void {
        this.observer?.disconnect();
        this.observer = null;
        for (const [preview, control] of this.controls) {
            control.button.remove();
            preview.classList.remove("is-expanded");
        }
        this.controls.clear();
    }
}
import { createDetachedObsidianElement } from "../dom/createDetachedObsidianElement";
