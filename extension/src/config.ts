/**
 * Build-time defaults. Override per build with VITE_* env vars
 * (see .env.example) and per user in the Settings tab.
 */
export const DEFAULT_API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export const DEFAULT_ANALYTICS_BASE_URL: string =
  import.meta.env.VITE_ANALYTICS_BASE_URL ?? 'http://localhost:3003';

export const HISTORY_LIMIT = 50;
