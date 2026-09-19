export interface PageTrail { list: string[]; at: number }
export function pageKey(url: string): string;
export function samePage(a: string | undefined | null, b: string | undefined | null): boolean;
export function sameSite(a: string, b: string): boolean;
export function realUrl(proxied: string): string;
export function visitPage(trail: PageTrail, url: string): PageTrail;
export function stepPage(trail: PageTrail, by: number): PageTrail;
