import * as assert from "node:assert/strict";
import test from "node:test";
import type { Setting } from "obsidian";
import {
    ASIDE_SETTING_CATALOG,
    ASIDE_SETTING_SECTIONS,
    type AsideSettingCatalogContext,
} from "../src/ui/settings/asideSettingCatalog";
import {
    getLegacyAsideSettingKeys,
    renderLegacyAsideSettings,
} from "../src/ui/settings/asideSettingLegacyAdapter";
import {
    getAsideSettingDefinitions,
    getDefinitionAsideSettingKeys,
} from "../src/ui/settings/asideSettingDefinitionsAdapter";

const EXPECTED_KEYS = [
    "show-todo-tab",
    "show-agent-tab",
    "scripts-enabled",
    "default-agent",
    "publish-enabled",
    "publish-base-url",
    "publish-project-name",
    "publish-remote-purge-enabled",
    "publish-purge-broker-url",
    "publish-purge-broker-secret",
    "publish-purge-allowed-host",
    "index-header-image-url",
    "index-header-image-caption",
];

const EXPECTED_DETAIL_KEYS = EXPECTED_KEYS.filter((key) =>
    key !== "scripts-enabled" && key !== "publish-enabled");

test("legacy and declarative setting adapters expose the same stable surface keys", () => {
    assert.deepEqual(getLegacyAsideSettingKeys(), EXPECTED_KEYS);
    assert.deepEqual(getDefinitionAsideSettingKeys(), EXPECTED_KEYS);
});

test("section controls do not appear in the detail catalog", () => {
    assert.deepEqual(
        ASIDE_SETTING_CATALOG.map((entry) => entry.key),
        EXPECTED_DETAIL_KEYS,
    );
});

test("every Aside detail and section control has searchable metadata", () => {
    const searchableItems = [
        ...ASIDE_SETTING_CATALOG,
        ...ASIDE_SETTING_SECTIONS.flatMap((section) => section.control ? [section.control] : []),
    ];

    for (const item of searchableItems) {
        assert.ok(item.name.trim());
        assert.ok(item.description.trim());
        assert.ok(item.aliases.length > 0);
        assert.ok(item.keywords.length > 0);
    }

    for (const entry of ASIDE_SETTING_CATALOG) {
        assert.ok(["agents", "sidebar", "publishing", "index-note"].includes(entry.section));
    }
});

test("settings sections use the approved order and advanced labels", () => {
    assert.deepEqual(
        ASIDE_SETTING_SECTIONS.map(({ key, heading }) => ({ key, heading })),
        [
            { key: "sidebar", heading: "Sidebar tabs" },
            { key: "agents", heading: "Scripts (advanced)" },
            { key: "publishing", heading: "Publishing (advanced)" },
            { key: "index-note", heading: "Index note" },
        ],
    );
});

test("advanced sections own the approved native controls", () => {
    const scriptsControl = ASIDE_SETTING_SECTIONS
        .find((section) => section.key === "agents")?.control;
    const publishingControl = ASIDE_SETTING_SECTIONS
        .find((section) => section.key === "publishing")?.control;

    assert.deepEqual(
        scriptsControl && {
            key: scriptsControl.key,
            name: scriptsControl.name,
            description: scriptsControl.description,
            aliases: scriptsControl.aliases,
            keywords: scriptsControl.keywords,
        },
        {
            key: "scripts-enabled",
            name: "Enable scripts",
            description: "Create and run trusted local scripts with your local agent.",
            aliases: ["vault scripts"],
            keywords: ["agent", "commands", "automation"],
        },
    );
    assert.deepEqual(
        publishingControl && {
            key: publishingControl.key,
            name: publishingControl.name,
            description: publishingControl.description,
            aliases: publishingControl.aliases,
            keywords: publishingControl.keywords,
        },
        {
            key: "publish-enabled",
            name: "Enable publishing",
            description: "Show advanced publish controls for supported files in the public folder.",
            aliases: ["Cloudflare Pages"],
            keywords: ["public folder", "deploy"],
        },
    );
});

test("agent tab search aliases derive from every supported agent", () => {
    const entry = ASIDE_SETTING_CATALOG.find((candidate) => candidate.key === "show-agent-tab");
    assert.deepEqual(entry?.aliases, ["Codex tab", "Claude Code tab", "Cursor tab", "Gemini tab", "DeepSeek tab"]);
});

test("default agent description covers every built-in default-agent command", () => {
    const entry = ASIDE_SETTING_CATALOG.find((candidate) => candidate.key === "default-agent");
    assert.equal(
        entry?.description,
        "Preferred local agent for /create-script, /update-script, and /pdf-to-markdown.",
    );
});

test("vault scripts keep the internal agents section identity", () => {
    assert.equal(
        ASIDE_SETTING_SECTIONS.some((section) => section.key === ("scripts" as never)),
        false,
    );
});

function createCatalogContext(options: {
    scriptsEnabled?: boolean;
    publishEnabled?: boolean;
    remotePurgeEnabled?: boolean;
    setScriptsEnabled?: (value: boolean) => Promise<void>;
    setPublishEnabled?: (value: boolean) => Promise<void>;
    refresh?: () => void;
} = {}): AsideSettingCatalogContext {
    const settings = {
        scriptsEnabled: options.scriptsEnabled ?? false,
        publishEnabled: options.publishEnabled ?? false,
        publishRemotePurgeEnabled: options.remotePurgeEnabled ?? false,
    };
    return {
        plugin: {
            settings,
            setScriptsEnabled: options.setScriptsEnabled ?? (async (value: boolean) => {
                settings.scriptsEnabled = value;
            }),
            setPublishEnabled: options.setPublishEnabled ?? (async (value: boolean) => {
                settings.publishEnabled = value;
            }),
        } as unknown as AsideSettingCatalogContext["plugin"],
        refresh: options.refresh ?? (() => undefined),
        renderDefaultAgentSettings: () => undefined,
        renderPurgeBrokerSecret: () => undefined,
    };
}

type DefinitionItem = {
    name?: string;
    desc?: string | DocumentFragment;
    aliases?: string[];
    visible?: boolean | (() => boolean);
    render?: (setting: Setting, group?: unknown) => void | (() => void);
};

function getGroupItems(
    context: ReturnType<typeof createCatalogContext>,
    heading: string,
): DefinitionItem[] {
    const group = getAsideSettingDefinitions(context)
        .find((item) => "heading" in item && item.heading === heading);
    assert.ok(group && "items" in group && group.items);
    return group.items as DefinitionItem[];
}

function getVisibleNames(items: DefinitionItem[]): string[] {
    return items
        .filter((item) => item.visible !== false
            && (typeof item.visible !== "function" || item.visible()))
        .map((item) => item.name ?? "");
}

test("declarative advanced groups stay visible with only their enable control while disabled", () => {
    const context = createCatalogContext();
    const definitions = getAsideSettingDefinitions(context);
    for (const heading of ["Scripts (advanced)", "Publishing (advanced)"]) {
        const group = definitions.find((item) => "heading" in item && item.heading === heading);
        assert.ok(group);
        assert.equal(group.visible, true);
    }

    assert.deepEqual(getVisibleNames(getGroupItems(context, "Scripts (advanced)")), [
        "Enable scripts",
    ]);
    assert.deepEqual(getVisibleNames(getGroupItems(context, "Publishing (advanced)")), [
        "Enable publishing",
    ]);
});

test("Scripts details appear independently of Publishing", () => {
    const context = createCatalogContext({ scriptsEnabled: true });

    assert.deepEqual(getVisibleNames(getGroupItems(context, "Scripts (advanced)")), [
        "Enable scripts",
        "Default agent",
    ]);
    assert.deepEqual(getVisibleNames(getGroupItems(context, "Publishing (advanced)")), [
        "Enable publishing",
    ]);
});

test("Publishing details appear independently of Scripts", () => {
    const context = createCatalogContext({ publishEnabled: true });

    assert.deepEqual(getVisibleNames(getGroupItems(context, "Scripts (advanced)")), [
        "Enable scripts",
    ]);
    assert.deepEqual(getVisibleNames(getGroupItems(context, "Publishing (advanced)")), [
        "Enable publishing",
        "Publishing URL",
        "Project name",
        "Remote cache purge",
    ]);
});

test("remote purge details additionally depend on Remote cache purge", () => {
    const publishingContext = createCatalogContext({ publishEnabled: true });
    const purgeContext = createCatalogContext({
        publishEnabled: true,
        remotePurgeEnabled: true,
    });

    assert.deepEqual(getVisibleNames(getGroupItems(publishingContext, "Publishing (advanced)")), [
        "Enable publishing",
        "Publishing URL",
        "Project name",
        "Remote cache purge",
    ]);
    assert.deepEqual(getVisibleNames(getGroupItems(purgeContext, "Publishing (advanced)")), [
        "Enable publishing",
        "Publishing URL",
        "Project name",
        "Remote cache purge",
        "Purge broker URL",
        "Purge broker auth secret",
        "Purge allowed host",
    ]);
});

test("publishing detail predicates express only the nested remote purge dependency", () => {
    for (const key of [
        "publish-base-url",
        "publish-project-name",
        "publish-remote-purge-enabled",
    ]) {
        const entry = ASIDE_SETTING_CATALOG.find((candidate) => candidate.key === key);
        assert.equal(entry?.visible, undefined, `${key} should rely on its section gate`);
    }

    const remotePurgeEntry = ASIDE_SETTING_CATALOG
        .find((candidate) => candidate.key === "publish-purge-broker-url");
    assert.equal(
        remotePurgeEntry?.visible?.(createCatalogContext({ remotePurgeEnabled: true })),
        true,
    );
});

function createRecordingSetting(names: string[]): Setting {
    const createComponent = () => {
        const component = {
            setPlaceholder: () => component,
            setValue: () => component,
            onChange: () => component,
        };
        return component;
    };
    const setting = {
        setName: (name: string) => {
            names.push(name);
            return setting;
        },
        setHeading: () => setting,
        setDesc: () => setting,
        addToggle: (callback: (component: ReturnType<typeof createComponent>) => unknown) => {
            callback(createComponent());
            return setting;
        },
        addText: (callback: (component: ReturnType<typeof createComponent>) => unknown) => {
            callback(createComponent());
            return setting;
        },
    };
    return setting as unknown as Setting;
}

test("legacy settings render disabled advanced headings and controls but hide their details", () => {
    const names: string[] = [];

    renderLegacyAsideSettings(
        {} as HTMLElement,
        createCatalogContext(),
        () => createRecordingSetting(names),
    );

    assert.ok(names.includes("Scripts (advanced)"));
    assert.ok(names.includes("Enable scripts"));
    assert.ok(names.includes("Publishing (advanced)"));
    assert.ok(names.includes("Enable publishing"));
    assert.equal(names.includes("Default agent"), false);
    assert.equal(names.includes("Publishing URL"), false);
});

test("section control restores stored state and refreshes after persistence rejects", async () => {
    const toggleValues: boolean[] = [];
    let onChange: ((value: boolean) => Promise<void>) | undefined;
    let refreshCount = 0;
    const context = createCatalogContext({
        setScriptsEnabled: async () => {
            throw new Error("save failed");
        },
        refresh: () => {
            refreshCount += 1;
        },
    });
    const toggle = {
        setValue: (value: boolean) => {
            toggleValues.push(value);
            return toggle;
        },
        onChange: (callback: (value: boolean) => Promise<void>) => {
            onChange = callback;
            return toggle;
        },
    };
    const setting = {
        addToggle: (callback: (component: typeof toggle) => unknown) => {
            callback(toggle);
            return setting;
        },
    } as unknown as Setting;
    const controlItem = getGroupItems(context, "Scripts (advanced)")[0];
    assert.ok(controlItem?.render);

    controlItem.render(setting);
    assert.ok(onChange);
    await assert.rejects(onChange(true), /save failed/u);

    assert.deepEqual(toggleValues, [false, false]);
    assert.equal(refreshCount, 1);
});
