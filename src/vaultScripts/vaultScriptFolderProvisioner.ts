import { VAULT_SCRIPT_FOLDER_PATH } from "../../shared/vaultScriptPolicy.js";

export type VaultScriptFolderPathKind = "missing" | "folder" | "occupied";

export type VaultScriptFolderProvisionResult =
    | { ok: true }
    | { ok: false; message: string };

export interface VaultScriptFolderProvisionHost {
    getPathKind(path: string): VaultScriptFolderPathKind;
    createFolder(path: string): Promise<void>;
}

const CONFLICT_MESSAGE = `Couldn’t create ${VAULT_SCRIPT_FOLDER_PATH}/ because a file already uses that path.`;
const FAILURE_MESSAGE = `Couldn’t create ${VAULT_SCRIPT_FOLDER_PATH}/. Check that the vault is writable and try again.`;

export async function ensureVaultScriptFolder(
    host: VaultScriptFolderProvisionHost,
): Promise<VaultScriptFolderProvisionResult> {
    const initialKind = host.getPathKind(VAULT_SCRIPT_FOLDER_PATH);
    if (initialKind === "folder") {
        return { ok: true };
    }
    if (initialKind === "occupied") {
        return { ok: false, message: CONFLICT_MESSAGE };
    }

    try {
        await host.createFolder(VAULT_SCRIPT_FOLDER_PATH);
        return { ok: true };
    } catch {
        const currentKind = host.getPathKind(VAULT_SCRIPT_FOLDER_PATH);
        if (currentKind === "folder") {
            return { ok: true };
        }
        return currentKind === "occupied"
            ? { ok: false, message: CONFLICT_MESSAGE }
            : { ok: false, message: FAILURE_MESSAGE };
    }
}
