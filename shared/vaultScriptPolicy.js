const VAULT_SCRIPT_FOLDER_PATH = "🛠️ scripts";
const VAULT_SCRIPT_EXTENSIONS = Object.freeze([".mjs", ".js", ".cjs"]);

const VALID_MENTION_NAME = /^[A-Za-z0-9_.-]+$/;
const TEST_OR_SPEC_SUFFIX = /\.(?:test|spec)$/i;

function parseVaultScriptPath(value) {
    if (typeof value !== "string") {
        return null;
    }

    const normalizedPath = value.replace(/\\/g, "/");
    const folderPrefix = `${VAULT_SCRIPT_FOLDER_PATH}/`;
    if (!normalizedPath.startsWith(folderPrefix)) {
        return null;
    }

    const fileName = normalizedPath.slice(folderPrefix.length);
    if (!fileName || fileName.includes("/") || fileName.startsWith(".")) {
        return null;
    }

    const lowerFileName = fileName.toLowerCase();
    const extension = VAULT_SCRIPT_EXTENSIONS.find((candidate) => lowerFileName.endsWith(candidate));
    if (!extension) {
        return null;
    }

    const mentionName = fileName.slice(0, -extension.length);
    if (!VALID_MENTION_NAME.test(mentionName) || TEST_OR_SPEC_SUFFIX.test(mentionName)) {
        return null;
    }

    return {
        path: normalizedPath,
        fileName,
        mentionName,
        normalizedMentionName: mentionName.toLowerCase(),
    };
}

function collectVaultScriptRegistrations(paths) {
    const registrationsByPath = new Map();
    for (const path of paths) {
        const registration = parseVaultScriptPath(path);
        if (registration) {
            registrationsByPath.set(registration.path, registration);
        }
    }

    const registrationsByMentionName = new Map();
    for (const registration of registrationsByPath.values()) {
        const registrations = registrationsByMentionName.get(registration.normalizedMentionName) ?? [];
        registrations.push(registration);
        registrationsByMentionName.set(registration.normalizedMentionName, registrations);
    }

    const runnable = [];
    const ambiguousMentionNames = [];
    for (const [mentionName, registrations] of registrationsByMentionName) {
        if (registrations.length === 1) {
            runnable.push(registrations[0]);
        } else {
            ambiguousMentionNames.push(mentionName);
        }
    }

    runnable.sort((left, right) => (
        left.normalizedMentionName.localeCompare(right.normalizedMentionName)
        || left.path.localeCompare(right.path)
    ));
    ambiguousMentionNames.sort((left, right) => left.localeCompare(right));

    return { runnable, ambiguousMentionNames };
}

module.exports = {
    VAULT_SCRIPT_FOLDER_PATH,
    VAULT_SCRIPT_EXTENSIONS,
    parseVaultScriptPath,
    collectVaultScriptRegistrations,
};
