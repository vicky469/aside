type ExecEnv = Record<string, string | undefined>;
type FileEncoding = "utf8";

export interface CodexSkillSyncModules {
    fsPromises: {
        access(path: string): Promise<void>;
        mkdir(path: string, options: { recursive?: boolean }): Promise<string | undefined | void>;
        readFile(path: string, encoding: FileEncoding): Promise<string>;
        rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
        writeFile(path: string, data: string, encoding: FileEncoding): Promise<void>;
    };
    os: {
        homedir(): string;
    };
    path: {
        join(...parts: string[]): string;
    };
}

export type CodexSkillSyncResult =
    | {
        kind: "not-installed";
        skillDirPath: string;
        skillFilePath: string;
    }
    | {
        kind: "already-synced";
        skillDirPath: string;
        skillFilePath: string;
    }
    | {
        kind: "current";
        skillDirPath: string;
        skillFilePath: string;
    }
    | {
        kind: "updated";
        skillDirPath: string;
        skillFilePath: string;
    };

function getCodexSkillsRoot(modules: CodexSkillSyncModules, env: ExecEnv): string {
    const codexHome = env.CODEX_HOME?.trim();
    return codexHome
        ? modules.path.join(codexHome, "skills")
        : modules.path.join(modules.os.homedir(), ".codex", "skills");
}

async function pathExists(modules: CodexSkillSyncModules, targetPath: string): Promise<boolean> {
    try {
        await modules.fsPromises.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

export async function syncInstalledCodexSkill(options: {
    modules: CodexSkillSyncModules;
    env?: ExecEnv;
    skillName: string;
    skillContent: string;
    pluginVersion: string;
    previouslySyncedPluginVersion?: string | null;
}): Promise<CodexSkillSyncResult> {
    const env = options.env ?? {};
    const skillsRoot = getCodexSkillsRoot(options.modules, env);
    const skillDirPath = options.modules.path.join(skillsRoot, options.skillName);
    const skillFilePath = options.modules.path.join(skillDirPath, "SKILL.md");

    if (!(await pathExists(options.modules, skillDirPath))) {
        return {
            kind: "not-installed",
            skillDirPath,
            skillFilePath,
        };
    }

    if (options.previouslySyncedPluginVersion === options.pluginVersion) {
        return {
            kind: "already-synced",
            skillDirPath,
            skillFilePath,
        };
    }

    if (await pathExists(options.modules, skillFilePath)) {
        const installedSkill = await options.modules.fsPromises.readFile(skillFilePath, "utf8");
        if (installedSkill === options.skillContent) {
            return {
                kind: "current",
                skillDirPath,
                skillFilePath,
            };
        }
    }

    await options.modules.fsPromises.mkdir(skillDirPath, { recursive: true });
    await options.modules.fsPromises.writeFile(skillFilePath, options.skillContent, "utf8");
    return {
        kind: "updated",
        skillDirPath,
        skillFilePath,
    };
}
