interface ParsedSvgDocumentLike<TElement> {
    documentElement: TElement | null;
    querySelector(selector: string): unknown;
}

interface SvgRootLike {
    nodeName: string;
}

export function parseTrustedMermaidSvgDocument<TElement extends SvgRootLike>(
    svg: string,
    parseSvg: (svgMarkup: string) => ParsedSvgDocumentLike<TElement>,
    importSvgRoot: (svgRoot: TElement) => TElement,
): TElement | null {
    if (!svg.trim()) {
        return null;
    }

    const parsedDocument = parseSvg(svg);
    const svgRoot = parsedDocument.documentElement;
    if (!svgRoot || svgRoot.nodeName.toLowerCase() !== "svg") {
        return null;
    }

    if (parsedDocument.querySelector("parsererror")) {
        return null;
    }

    return importSvgRoot(svgRoot);
}

export function parseTrustedMermaidSvg(svg: string): SVGSVGElement | null {
    if (typeof DOMParser === "undefined" || typeof document === "undefined") {
        return null;
    }

    const importedRoot = parseTrustedMermaidSvgDocument(
        svg,
        (svgMarkup) => new DOMParser().parseFromString(svgMarkup, "image/svg+xml"),
        (svgRoot) => document.importNode(svgRoot, true),
    );

    return importedRoot instanceof SVGSVGElement ? importedRoot : null;
}
