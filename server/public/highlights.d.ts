export interface TextHighlight { id: string; text: string; prefix: string; suffix: string; color: string; comment?: string }
export function textNodes(root: Node): Text[];
export function captureRange(root: HTMLElement, range: Range): { text: string; prefix: string; suffix: string } | null;
export function applyHighlights(root: HTMLElement, highlights: TextHighlight[], className?: string): string[];
export function watchHighlights(root: HTMLElement, getHighlights: () => TextHighlight[], apply: () => void, delay?: number): { render: () => void; stop: () => void };
