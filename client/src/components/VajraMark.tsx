export function VajraMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Vajra emblem">
    <path d="M32 25 25 32l7 7 7-7-7-7Z" fill="currentColor" fillOpacity=".11" />
    <path d="M25 32H9m30 0h16M20 28v8m24-8v8" />
    <path d="M9 32c3-3 5-8 6-14 2 5 4 8 10 10M9 32c3 3 5 8 6 14 2-5 4-8 10-10" />
    <path d="M55 32c-3-3-5-8-6-14-2 5-4 8-10 10m16 4c-3 3-5 8-6 14-2-5-4-8-10-10" />
    <path d="M8 28v8m48-8v8" />
  </svg>;
}
