import path from "node:path";
import process from "node:process";
import {
    createBridgeConfig,
    createDgxRuntimeBridge,
    getBridgeDefaultBaseUrl,
    getBridgeTransportProtocol,
    loadEnvFile,
} from "./dgx-runtime-bridge-lib.mjs";

function logStartup(config) {
    const baseUrl = config.publicBaseUrl ?? getBridgeDefaultBaseUrl(config);
    console.log(`[sidenote2-dgx-bridge] Listening on ${config.bindHost}:${config.port}`);
    console.log(`[sidenote2-dgx-bridge] Transport: ${getBridgeTransportProtocol(config).toUpperCase()}`);
    console.log(`[sidenote2-dgx-bridge] Public base URL: ${baseUrl}`);
    console.log(`[sidenote2-dgx-bridge] Workspace root: ${config.workspaceRoot}`);
    console.log(`[sidenote2-dgx-bridge] Codex binary: ${config.codexBin}`);
}

async function main() {
    const envFilePath = path.join(process.cwd(), ".env");
    const fileEnv = loadEnvFile(envFilePath);
    const config = createBridgeConfig({
        env: {
            ...fileEnv,
            ...process.env,
        },
        rootDir: process.cwd(),
    });

    const bridge = createDgxRuntimeBridge({ config });
    const shutdown = async (signal) => {
        console.log(`[sidenote2-dgx-bridge] Received ${signal}. Shutting down.`);
        try {
            await bridge.close();
            process.exit(0);
        } catch (error) {
            console.error("[sidenote2-dgx-bridge] Shutdown failed:", error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });

    await new Promise((resolve, reject) => {
        bridge.server.once("error", reject);
        bridge.server.listen(config.port, config.bindHost, () => {
            bridge.server.off("error", reject);
            resolve(undefined);
        });
    });

    logStartup(config);
}

main().catch((error) => {
    console.error("[sidenote2-dgx-bridge] Startup failed:", error);
    process.exit(1);
});
