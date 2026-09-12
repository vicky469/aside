function normalizeCommentPinState(value) {
    if (!value || typeof value.isPinned !== "boolean") return {};
    return {
        isPinned: value.isPinned,
        ...(Number.isFinite(value.pinUpdatedAt) && value.pinUpdatedAt >= 0
            ? { pinUpdatedAt: value.pinUpdatedAt }
            : {}),
    };
}

function mergeCommentPinState(current, incoming) {
    const left = normalizeCommentPinState(current);
    const right = normalizeCommentPinState(incoming);
    if (right.isPinned === undefined) return left;
    if (left.isPinned === undefined) return right;
    return (right.pinUpdatedAt ?? 0) >= (left.pinUpdatedAt ?? 0) ? right : left;
}

module.exports = { normalizeCommentPinState, mergeCommentPinState };
