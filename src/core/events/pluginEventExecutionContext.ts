export interface PluginEventExecutionContext {
    readonly signal: AbortSignal;
    isActive(): boolean;
}

export function isPluginEventExecutionActive(context: PluginEventExecutionContext): boolean {
    return !context.signal.aborted && context.isActive();
}

const alwaysActiveSignal = new AbortController().signal;

export const ALWAYS_ACTIVE_PLUGIN_EVENT_CONTEXT: PluginEventExecutionContext = Object.freeze({
    signal: alwaysActiveSignal,
    isActive: () => true,
});
