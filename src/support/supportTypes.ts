import type { AsideLogAttachment } from "../logs/logService";

export interface SupportScreenshotAttachment {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentBase64: string;
}

export interface SupportReportPayload {
    email: string;
    title: string;
    content: string;
    pluginVersion: string;
    sessionId: string;
    logAttachment: {
        fileName: string;
        relativePath: string;
        sizeBytes: number;
        content: string;
    };
    screenshotAttachments: SupportScreenshotAttachment[];
}

export interface SupportReportContext {
    filePath: string | null;
    surface: "index" | "note";
    threadCount: number;
}

export type AttachedLogFile = AsideLogAttachment;
