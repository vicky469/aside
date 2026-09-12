import * as assert from "node:assert/strict";
import test from "node:test";
import { collectSidebarSearchTargets, renderSidebarSearchNavigation, SidebarSearchNavigation } from "../src/ui/views/sidebarSearchNavigation";

function target(id: string) {
    const classes = new Set<string>();
    const scrolls: ScrollIntoViewOptions[] = [];
    const element = {
        isConnected: true,
        classList: {
            add: (value: string) => { classes.add(value); },
            remove: (value: string) => { classes.delete(value); },
        },
        scrollIntoView: (options: ScrollIntoViewOptions) => { scrolls.push(options); },
    };
    return { target: { id, element: element as unknown as HTMLElement }, element, classes, scrolls };
}

test("search navigation moves in display order and wraps in both directions", () => {
    const navigation = new SidebarSearchNavigation();
    const first = target("first");
    const second = target("second");
    navigation.setTargets([first.target, second.target], "query");
    assert.deepEqual(navigation.getState(), { current: 0, total: 2 });
    navigation.navigate(1);
    assert.deepEqual(navigation.getState(), { current: 1, total: 2 });
    assert.equal(first.scrolls.length, 1);
    assert.equal(first.classes.has("is-active-search-match"), true);
    navigation.navigate(1);
    assert.equal(first.classes.size, 0);
    assert.equal(second.classes.has("is-active-search-match"), true);
    navigation.navigate(1);
    assert.equal(navigation.getState().current, 1);
    navigation.navigate(-1);
    assert.equal(navigation.getState().current, 2);
});

test("previous starts at the last match and empty searches stay idle", () => {
    const navigation = new SidebarSearchNavigation();
    navigation.navigate(-1);
    assert.deepEqual(navigation.getState(), { current: 0, total: 0 });
    navigation.setTargets([target("one").target, target("two").target], "query");
    navigation.navigate(-1);
    assert.equal(navigation.getState().current, 2);
});

test("search navigation retains the selected match across rendering but resets for a new scope", () => {
    const navigation = new SidebarSearchNavigation();
    navigation.setTargets([target("one").target, target("two").target], "note:query");
    navigation.navigate(-1);
    navigation.invalidate();
    assert.equal(navigation.getState().total, 0);
    const updated = target("two");
    navigation.setTargets([target("new").target, target("one").target, updated.target], "note:query");
    assert.deepEqual(navigation.getState(), { current: 3, total: 3 });
    assert.equal(updated.classes.has("is-active-search-match"), true);
    assert.equal(updated.scrolls.length, 0);
    navigation.setTargets([updated.target], "other-note:query");
    assert.deepEqual(navigation.getState(), { current: 0, total: 1 });
    assert.equal(updated.classes.size, 0);
});

test("invalidating pending search results disables controls and avoids detached targets", () => {
    const navigation = new SidebarSearchNavigation();
    const match = target("one");
    let total = -1;
    navigation.observe((state) => { total = state.total; });
    navigation.setTargets([match.target], "query");
    assert.equal(total, 1);
    match.element.isConnected = false;
    navigation.navigate(1);
    assert.equal(match.scrolls.length, 0);
    assert.equal(total, 0);
    navigation.setTargets([target("new").target], "next");
    navigation.invalidate();
    assert.equal(total, 0);
});

class ControlElement {
    children: ControlElement[] = [];
    attributes = new Map<string, string>();
    events = new Map<string, Array<(event: Event) => void>>();
    textContent = "";
    disabled = false;
    value = "query";
    type = "";
    createDiv() { return this.createEl(); }
    createSpan() { return this.createEl(); }
    createEl() {
        const child = new ControlElement();
        this.children.push(child);
        return child;
    }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(name: string, callback: (event: Event) => void) {
        this.events.set(name, [...this.events.get(name) ?? [], callback]);
    }
    fire(name: string, properties: Partial<KeyboardEvent> = {}) {
        let prevented = false;
        const event = {
            ...properties,
            preventDefault: () => { prevented = true; },
            stopPropagation: () => {},
        } as Event;
        this.events.get(name)?.forEach((callback) => callback(event));
        return prevented;
    }
}

test("search controls expose buttons, counter, keyboard navigation and pending-query state", () => {
    const navigation = new SidebarSearchNavigation();
    const field = new ControlElement();
    const input = new ControlElement();
    const icons: string[] = [];
    renderSidebarSearchNavigation(
        field as unknown as HTMLElement, input as unknown as HTMLInputElement, navigation,
        (_element, icon) => { icons.push(icon); },
    );
    const [counter, previous, next] = field.children[0].children;
    assert.deepEqual(icons, ["chevron-up", "chevron-down"]);
    assert.equal(next.disabled, true);
    assert.equal(previous.attributes.get("aria-label"), "Previous match (Shift+Enter)");
    navigation.setTargets([target("one").target, target("two").target], "query");
    assert.equal(counter.textContent, "0/2");
    assert.equal(next.disabled, false);
    next.fire("click");
    assert.equal(counter.textContent, "1/2");
    assert.equal(input.fire("keydown", { key: "Enter" }), true);
    assert.equal(counter.textContent, "2/2");
    input.fire("keydown", { key: "Enter", shiftKey: true });
    assert.equal(counter.textContent, "1/2");
    input.fire("keydown", { key: "Enter", isComposing: true });
    assert.equal(counter.textContent, "1/2");
    assert.equal(previous.fire("mousedown"), true);
    previous.fire("click");
    assert.equal(counter.textContent, "2/2");
    input.value = "changed query";
    input.fire("input");
    assert.equal(counter.textContent, "0/0");
    assert.equal(next.disabled, true);
    next.fire("click");
    assert.equal(counter.textContent, "0/0");
    input.value = "query";
    input.fire("input");
    assert.equal(counter.textContent, "2/2");
    assert.equal(next.disabled, false);
});

test("search targets use stable card IDs and per-card occurrence order", () => {
    const mark = (id: string) => ({ closest: () => ({ getAttribute: () => id }) });
    const marks = [mark("one"), mark("one"), mark("two")];
    const container = { querySelectorAll: () => marks } as unknown as HTMLElement;
    assert.deepEqual(collectSidebarSearchTargets(container).map((item) => item.id), [
        '["one",0]', '["one",1]', '["two",0]',
    ]);
});
