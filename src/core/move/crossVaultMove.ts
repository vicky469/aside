import { cloneCommentThreads, type CommentThread } from "../../commentManager";
import {
    buildAllCommentsNoteContent,
    normalizeAllCommentsNoteImageCaption,
    normalizeAllCommentsNoteImageUrl,
    normalizeAllCommentsNotePath,
} from "../derived/allCommentsNote";

export interface CrossVaultMovePathUtil {
    isAbsolute(filePath: string): boolean;
    join(...paths: string[]): string;
    normalize(filePath: string): string;
}

export interface CrossVaultMoveEnv {
    APPDATA?: string;
    LOCALAPPDATA?: string;
    XDG_CONFIG_HOME?: string;
    HOME?: string;
}

export interface CrossVaultMoveBinaryReader<TFile> {
    readBinary(file: TFile): Promise<ArrayBuffer>;
}

export interface CrossVaultTargetIndexModules {
    fsPromises: {
        access(filePath: string): Promise<void>;
        mkdir(filePath: string, options: { recursive?: boolean }): Promise<unknown>;
        readFile(filePath: string, encoding: "utf8"): Promise<string>;
        readdir(
            filePath: string,
            options: { withFileTypes: true },
        ): Promise<Array<{
            name: string;
            isDirectory(): boolean;
            isFile(): boolean;
        }>>;
        writeFile(filePath: string, contents: string): Promise<void>;
    };
    path: {
        basename(filePath: string): string;
        dirname(filePath: string): string;
        join(...paths: string[]): string;
    };
}

export interface CrossVaultTargetAsideCompatibilityModules {
    fsPromises: {
        access(filePath: string): Promise<void>;
        readFile(filePath: string, encoding: "utf8"): Promise<string>;
    };
    path: {
        join(...paths: string[]): string;
    };
}

export interface CrossVaultTargetAsideAutoUpdateModules extends CrossVaultTargetAsideCompatibilityModules {
    fsPromises: CrossVaultTargetAsideCompatibilityModules["fsPromises"] & {
        copyFile(sourcePath: string, targetPath: string): Promise<void>;
    };
}

export interface CrossVaultTargetSidecarModules {
    fsPromises: {
        mkdir(filePath: string, options: { recursive?: boolean }): Promise<unknown>;
        writeFile(filePath: string, contents: string): Promise<void>;
    };
    path: {
        dirname(filePath: string): string;
        join(...paths: string[]): string;
    };
}

export interface CrossVaultTargetIndexOptions {
    targetVaultPath: string;
    configDir: string;
    pluginId: string;
    vaultName?: string;
}

export interface CrossVaultTargetAsideCompatibilityOptions {
    targetVaultPath: string;
    configDir: string;
    pluginId: string;
    minimumVersion: string;
}

export interface CrossVaultTargetAsideAutoUpdateOptions extends CrossVaultTargetAsideCompatibilityOptions {
    sourcePluginRoot: string;
}

export interface CrossVaultTargetSidecarOptions {
    targetVaultPath: string;
    configDir: string;
    pluginId: string;
    notePath: string;
    sourceId?: string | null;
    threads: CommentThread[];
}

export const CROSS_VAULT_SIDE_NOTE_MOVE_MIN_TARGET_VERSION = "2.0.88";

interface StoredCrossVaultSidecarComments {
    notePath: string;
    threads: CommentThread[];
}

interface TargetIndexSettings {
    indexNotePath: string;
    indexHeaderImageUrl: string;
    indexHeaderImageCaption: string;
}

const CROSS_VAULT_PLUGIN_UPDATE_ARTIFACTS = ["main.js", "styles.css", "manifest.json"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeCrossVaultMovePath(
    pathUtil: CrossVaultMovePathUtil,
    candidatePath: string,
): string | null {
    const trimmed = candidatePath.trim();
    if (!trimmed || !pathUtil.isAbsolute(trimmed)) {
        return null;
    }

    return pathUtil.normalize(trimmed);
}

export function getObsidianConfigRootCandidatesForMove(
    pathUtil: CrossVaultMovePathUtil,
    env: CrossVaultMoveEnv,
): string[] {
    const roots = new Set<string>();
    const add = (pathValue: string | undefined) => {
        if (!pathValue) {
            return;
        }

        const normalized = normalizeCrossVaultMovePath(pathUtil, pathValue);
        if (!normalized) {
            return;
        }

        roots.add(normalized);
    };

    add(pathUtil.join(env.APPDATA ?? "", "obsidian"));
    add(pathUtil.join(env.LOCALAPPDATA ?? "", "obsidian"));
    add(pathUtil.join(env.XDG_CONFIG_HOME ?? "", "obsidian"));
    add(pathUtil.join(env.HOME ?? "", ".config", "obsidian"));
    add(pathUtil.join(env.HOME ?? "", "Library", "Application Support", "obsidian"));

    return Array.from(roots);
}

export async function readCrossVaultMoveFileBytes<TFile>(
    vault: CrossVaultMoveBinaryReader<TFile>,
    sourceFile: TFile,
): Promise<Uint8Array> {
    return new Uint8Array(await vault.readBinary(sourceFile));
}

export function formatCrossVaultMoveSuccessNotice(sourceFilePath: string, targetVaultName: string): string {
    void sourceFilePath;
    void targetVaultName;
    return "Moved.";
}

export function formatCrossVaultMoveExistingFileNotice(targetVaultName: string): string {
    void targetVaultName;
    return "Already exists.";
}

export function selectCrossVaultMoveThreads(
    ...threadSnapshots: CommentThread[][]
): CommentThread[] {
    return cloneCommentThreads(threadSnapshots.find((threads) => threads.length > 0) ?? []);
}

async function hashCrossVaultStorageKey(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer), (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");
}

async function pathExists(
    fsPromises: Pick<CrossVaultTargetIndexModules["fsPromises"], "access">,
    filePath: string,
): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function parseVersionSegments(version: string): number[] | null {
    const segments = version.trim().split(".");
    if (segments.length === 0) {
        return null;
    }

    const parsed = segments.map((segment) => {
        if (!/^\d+$/.test(segment)) {
            return null;
        }
        return Number.parseInt(segment, 10);
    });
    return parsed.every((segment): segment is number => segment !== null)
        ? parsed
        : null;
}

function compareVersions(left: string, right: string): number | null {
    const leftSegments = parseVersionSegments(left);
    const rightSegments = parseVersionSegments(right);
    if (!leftSegments || !rightSegments) {
        return null;
    }

    const segmentCount = Math.max(leftSegments.length, rightSegments.length);
    for (let index = 0; index < segmentCount; index += 1) {
        const leftSegment = leftSegments[index] ?? 0;
        const rightSegment = rightSegments[index] ?? 0;
        if (leftSegment !== rightSegment) {
            return leftSegment - rightSegment;
        }
    }
    return 0;
}

export async function assertCrossVaultTargetAsidePluginCompatible(
    modules: CrossVaultTargetAsideCompatibilityModules,
    options: CrossVaultTargetAsideCompatibilityOptions,
): Promise<void> {
    const manifestPath = modules.path.join(
        options.targetVaultPath,
        options.configDir,
        "plugins",
        options.pluginId,
        "manifest.json",
    );
    if (!(await pathExists(modules.fsPromises, manifestPath))) {
        throw new Error("Target vault does not have Aside installed. Install or update Aside in the target vault before moving side notes.");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(await modules.fsPromises.readFile(manifestPath, "utf8")) as unknown;
    } catch {
        throw new Error("Target vault has an unreadable Aside manifest. Reinstall or update Aside in the target vault before moving side notes.");
    }

    if (!isRecord(parsed) || parsed.id !== options.pluginId || typeof parsed.version !== "string") {
        throw new Error("Target vault has an incompatible Aside manifest. Reinstall or update Aside in the target vault before moving side notes.");
    }

    const comparison = compareVersions(parsed.version, options.minimumVersion);
    if (comparison === null || comparison < 0) {
        throw new Error(`Target vault uses Aside ${parsed.version}; moving side notes requires Aside ${options.minimumVersion} or newer.`);
    }
}

export async function ensureCrossVaultTargetAsidePluginCompatible(
    modules: CrossVaultTargetAsideAutoUpdateModules,
    options: CrossVaultTargetAsideAutoUpdateOptions,
): Promise<void> {
    const targetPluginRoot = modules.path.join(
        options.targetVaultPath,
        options.configDir,
        "plugins",
        options.pluginId,
    );
    const targetManifestPath = modules.path.join(targetPluginRoot, "manifest.json");
    if (!(await pathExists(modules.fsPromises, targetManifestPath))) {
        throw new Error("Target vault does not have Aside installed. Install Aside in the target vault before moving side notes.");
    }

    let parsedTarget: unknown;
    try {
        parsedTarget = JSON.parse(await modules.fsPromises.readFile(targetManifestPath, "utf8")) as unknown;
    } catch {
        throw new Error("Target vault has an unreadable Aside manifest. Reinstall or update Aside in the target vault before moving side notes.");
    }

    if (!isRecord(parsedTarget) || parsedTarget.id !== options.pluginId || typeof parsedTarget.version !== "string") {
        throw new Error("Target vault has an incompatible Aside manifest. Reinstall or update Aside in the target vault before moving side notes.");
    }

    const targetComparison = compareVersions(parsedTarget.version, options.minimumVersion);
    if (targetComparison !== null && targetComparison >= 0) {
        return;
    }

    const sourceManifestPath = modules.path.join(options.sourcePluginRoot, "manifest.json");
    let parsedSource: unknown;
    try {
        parsedSource = JSON.parse(await modules.fsPromises.readFile(sourceManifestPath, "utf8")) as unknown;
    } catch {
        throw new Error("Current Aside build is unavailable. Update the target vault manually and retry.");
    }

    if (!isRecord(parsedSource) || parsedSource.id !== options.pluginId || typeof parsedSource.version !== "string") {
        throw new Error("Current Aside build is incompatible. Update the target vault manually and retry.");
    }

    const sourceComparison = compareVersions(parsedSource.version, options.minimumVersion);
    if (sourceComparison === null || sourceComparison < 0) {
        throw new Error("Current Aside build is too old. Update Aside and retry.");
    }

    for (const artifact of CROSS_VAULT_PLUGIN_UPDATE_ARTIFACTS) {
        await modules.fsPromises.copyFile(
            modules.path.join(options.sourcePluginRoot, artifact),
            modules.path.join(targetPluginRoot, artifact),
        );
    }

    await assertCrossVaultTargetAsidePluginCompatible(modules, options);
}

function cloneThreadsForNote(notePath: string, threads: unknown[]): CommentThread[] {
    return threads
        .filter((thread): thread is CommentThread => isRecord(thread))
        .map((thread) => ({
            ...thread,
            filePath: notePath,
            entries: Array.isArray(thread.entries)
                ? thread.entries
                    .filter((entry): entry is CommentThread["entries"][number] => isRecord(entry))
                    .map((entry) => ({ ...entry }))
                : [],
        }));
}

function buildSidecarPayload(notePath: string, threads: CommentThread[], sourceId?: string): string {
    return `${JSON.stringify({
        version: 1,
        notePath,
        ...(sourceId ? { sourceId } : {}),
        threads: cloneThreadsForNote(notePath, threads),
    })}\n`;
}

async function getTargetSidecarPath(
    modules: CrossVaultTargetSidecarModules,
    options: CrossVaultTargetSidecarOptions,
    storageKind: "by-note" | "by-source",
    key: string,
): Promise<string> {
    const hash = await hashCrossVaultStorageKey(key);
    const shard = hash.slice(0, 2) || "00";
    return modules.path.join(
        options.targetVaultPath,
        options.configDir,
        "plugins",
        options.pluginId,
        "sidenotes",
        storageKind,
        shard,
        `${hash}.json`,
    );
}

export async function writeCrossVaultTargetSidecars(
    modules: CrossVaultTargetSidecarModules,
    options: CrossVaultTargetSidecarOptions,
): Promise<string[]> {
    if (options.threads.length === 0) {
        return [];
    }

    const writtenPaths: string[] = [];
    const noteSidecarPath = await getTargetSidecarPath(modules, options, "by-note", options.notePath);
    await modules.fsPromises.mkdir(modules.path.dirname(noteSidecarPath), { recursive: true });
    await modules.fsPromises.writeFile(noteSidecarPath, buildSidecarPayload(options.notePath, options.threads));
    writtenPaths.push(noteSidecarPath);

    if (options.sourceId?.trim()) {
        const sourceId = options.sourceId.trim();
        const sourceSidecarPath = await getTargetSidecarPath(modules, options, "by-source", sourceId);
        await modules.fsPromises.mkdir(modules.path.dirname(sourceSidecarPath), { recursive: true });
        await modules.fsPromises.writeFile(
            sourceSidecarPath,
            buildSidecarPayload(options.notePath, options.threads, sourceId),
        );
        writtenPaths.push(sourceSidecarPath);
    }

    return writtenPaths;
}

function parseCrossVaultSidecarComments(value: unknown): StoredCrossVaultSidecarComments | null {
    if (
        !isRecord(value)
        || value.version !== 1
        || typeof value.notePath !== "string"
        || !Array.isArray(value.threads)
    ) {
        return null;
    }

    return {
        notePath: value.notePath,
        threads: cloneThreadsForNote(value.notePath, value.threads),
    };
}

async function readTargetIndexSettings(
    modules: CrossVaultTargetIndexModules,
    pluginRoot: string,
): Promise<TargetIndexSettings> {
    const dataPath = modules.path.join(pluginRoot, "data.json");
    if (!(await pathExists(modules.fsPromises, dataPath))) {
        return {
            indexNotePath: normalizeAllCommentsNotePath(""),
            indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
            indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
        };
    }

    try {
        const parsed = JSON.parse(await modules.fsPromises.readFile(dataPath, "utf8")) as unknown;
        return {
            indexNotePath: normalizeAllCommentsNotePath(
                isRecord(parsed) && typeof parsed.indexNotePath === "string" ? parsed.indexNotePath : "",
            ),
            indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(
                isRecord(parsed) && typeof parsed.indexHeaderImageUrl === "string" ? parsed.indexHeaderImageUrl : "",
            ),
            indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(
                isRecord(parsed) && typeof parsed.indexHeaderImageCaption === "string"
                    ? parsed.indexHeaderImageCaption
                    : null,
            ),
        };
    } catch {
        return {
            indexNotePath: normalizeAllCommentsNotePath(""),
            indexHeaderImageUrl: normalizeAllCommentsNoteImageUrl(""),
            indexHeaderImageCaption: normalizeAllCommentsNoteImageCaption(null),
        };
    }
}

async function listJsonFilesRecursively(
    modules: CrossVaultTargetIndexModules,
    directoryPath: string,
): Promise<string[]> {
    if (!(await pathExists(modules.fsPromises, directoryPath))) {
        return [];
    }

    let entries: Awaited<ReturnType<CrossVaultTargetIndexModules["fsPromises"]["readdir"]>>;
    try {
        entries = await modules.fsPromises.readdir(directoryPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = modules.path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listJsonFilesRecursively(modules, entryPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
            files.push(entryPath);
        }
    }

    return files.sort((left, right) => left.localeCompare(right));
}

async function readTargetSidecarRecords(
    modules: CrossVaultTargetIndexModules,
    pluginRoot: string,
): Promise<StoredCrossVaultSidecarComments[]> {
    const recordsByNotePath = new Map<string, StoredCrossVaultSidecarComments>();
    const storageFiles = await listJsonFilesRecursively(
        modules,
        modules.path.join(pluginRoot, "sidenotes", "by-note"),
    );
    storageFiles.push(...await listJsonFilesRecursively(
        modules,
        modules.path.join(pluginRoot, "sidenotes", "by-source"),
    ));

    for (const storagePath of storageFiles) {
        try {
            const parsed = JSON.parse(await modules.fsPromises.readFile(storagePath, "utf8")) as unknown;
            const payload = parseCrossVaultSidecarComments(parsed);
            if (!payload) {
                continue;
            }

            const existing = recordsByNotePath.get(payload.notePath);
            recordsByNotePath.set(payload.notePath, {
                notePath: payload.notePath,
                threads: existing?.threads.length ? existing.threads : payload.threads,
            });
        } catch {
            // Ignore invalid or concurrently changing sidecar files.
        }
    }

    return Array.from(recordsByNotePath.values())
        .sort((left, right) => left.notePath.localeCompare(right.notePath));
}

export async function writeCrossVaultTargetIndexFromSidecars(
    modules: CrossVaultTargetIndexModules,
    options: CrossVaultTargetIndexOptions,
): Promise<string> {
    const pluginRoot = modules.path.join(
        options.targetVaultPath,
        options.configDir,
        "plugins",
        options.pluginId,
    );
    const settings = await readTargetIndexSettings(modules, pluginRoot);
    const records = await readTargetSidecarRecords(modules, pluginRoot);
    const presentRecords: StoredCrossVaultSidecarComments[] = [];
    for (const record of records) {
        if (await pathExists(modules.fsPromises, modules.path.join(options.targetVaultPath, record.notePath))) {
            presentRecords.push(record);
        }
    }
    const threads = presentRecords.flatMap((record) => record.threads);
    const vaultName = options.vaultName?.trim() || modules.path.basename(options.targetVaultPath);
    const nextContent = buildAllCommentsNoteContent(vaultName, threads, {
        allCommentsNotePath: settings.indexNotePath,
        headerImageUrl: settings.indexHeaderImageUrl,
        headerImageCaption: settings.indexHeaderImageCaption,
    });
    const indexPath = modules.path.join(options.targetVaultPath, settings.indexNotePath);
    await modules.fsPromises.mkdir(modules.path.dirname(indexPath), { recursive: true });
    await modules.fsPromises.writeFile(indexPath, nextContent);
    return indexPath;
}
