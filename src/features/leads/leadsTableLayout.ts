/** Shared column widths for the leads table (colgroup + min table width). */
export const LEADS_TABLE_MIN_WIDTH = 1680;

export const LEADS_TABLE_COLS = [
  'w-10',
  'w-[76px]',
  'w-[108px]',
  'w-[148px]',
  'w-[148px]',
  'w-[240px]',
  'w-[136px]',
  'w-[220px]',
  'w-[132px]',
  'w-[200px]',
  'w-[168px]',
  'w-[164px]',
] as const;

export const fieldInputClass =
  'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm shadow-none transition-colors hover:border-input/50 hover:bg-muted/30 focus-visible:border-[#1a9696]/40 focus-visible:bg-background focus-visible:ring-[#1a9696]/20';

export const tableSelectClass =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-xs shadow-none transition-colors hover:border-input/50 hover:bg-muted/30 focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20 dark:[color-scheme:dark]';
