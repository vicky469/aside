export interface IndexPreviewRenderedLineSample {
    line: number;
    top: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function estimatePixelsPerLine(samples: readonly IndexPreviewRenderedLineSample[]): number | null {
    if (samples.length < 2) {
        return null;
    }

    const sortedSamples = samples
        .slice()
        .sort((left, right) => left.line - right.line);
    let bestPixelsPerLine: number | null = null;
    let bestLineDelta = 0;

    for (let index = 1; index < sortedSamples.length; index += 1) {
        const previous = sortedSamples[index - 1];
        const current = sortedSamples[index];
        if (!(previous && current)) {
            continue;
        }

        const lineDelta = current.line - previous.line;
        const topDelta = current.top - previous.top;
        if (lineDelta <= 0 || topDelta <= 0) {
            continue;
        }

        if (lineDelta > bestLineDelta) {
            bestLineDelta = lineDelta;
            bestPixelsPerLine = topDelta / lineDelta;
        }
    }

    return bestPixelsPerLine;
}

export function estimateIndexPreviewScrollTop(
    targetLine: number,
    totalLineCount: number,
    samples: readonly IndexPreviewRenderedLineSample[],
    scrollHeight: number,
    clientHeight: number,
): number {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (maxScrollTop <= 0) {
        return 0;
    }

    const sortedSamples = samples
        .slice()
        .sort((left, right) => left.line - right.line);
    const nearestSample = sortedSamples.reduce<IndexPreviewRenderedLineSample | null>((nearest, sample) => {
        if (!nearest) {
            return sample;
        }

        const nearestDistance = Math.abs(nearest.line - targetLine);
        const sampleDistance = Math.abs(sample.line - targetLine);
        return sampleDistance < nearestDistance ? sample : nearest;
    }, null);
    const pixelsPerLine = estimatePixelsPerLine(sortedSamples);

    if (nearestSample && pixelsPerLine && Number.isFinite(pixelsPerLine)) {
        const targetTop = nearestSample.top + ((targetLine - nearestSample.line) * pixelsPerLine);
        return clamp(targetTop - (clientHeight / 2), 0, maxScrollTop);
    }

    const safeTotalLineCount = Math.max(1, totalLineCount - 1);
    const lineProgress = clamp(targetLine / safeTotalLineCount, 0, 1);
    return clamp((lineProgress * maxScrollTop) - (clientHeight * 0.25), 0, maxScrollTop);
}
