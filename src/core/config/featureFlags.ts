export const FeatureFlag = {
	publish: "publish",
} as const;

export type FeatureFlagKey = typeof FeatureFlag[keyof typeof FeatureFlag];

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
	[FeatureFlag.publish]: false,
};

export function normalizeFeatureFlags(value: unknown): FeatureFlags {
	const source = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		[FeatureFlag.publish]: source[FeatureFlag.publish] === true,
	};
}

export function isFeatureFlagEnabled(flags: unknown, flag: FeatureFlagKey): boolean {
	return normalizeFeatureFlags(flags)[flag];
}

export function shouldRewriteNormalizedFeatureFlags(
	loadedValue: unknown,
	normalized: FeatureFlags,
): boolean {
	if (!loadedValue || typeof loadedValue !== "object" || Array.isArray(loadedValue)) {
		return loadedValue !== undefined;
	}
	const source = loadedValue as Record<string, unknown>;
	const knownFlags = Object.values(FeatureFlag);
	return Object.keys(source).some((key) => !knownFlags.some((flag) => flag === key))
		|| knownFlags.some((flag) => source[flag] !== normalized[flag]);
}
