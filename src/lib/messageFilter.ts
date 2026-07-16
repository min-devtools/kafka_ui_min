export interface JsFilter {
  id: string;
  code: string;
  enabled: boolean;
}

export type FilterFn = (
  value: unknown,
  key: string | null,
  partition: number,
  offset: number,
  timestamp: number | null,
  headers: Record<string, string>,
) => unknown;

/** Compile the same programmable filter shape used by Redpanda Console. */
export function compileFilter(code: string): FilterFn {
  const body = /\breturn\b/.test(code) ? code : `return (${code});`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("value", "key", "partition", "offset", "timestamp", "headers", `"use strict";${body}`) as FilterFn;
}
