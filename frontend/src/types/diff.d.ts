declare module 'diff' {
  export interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  }

  export function diffWordsWithSpace(oldText: string, newText: string): Change[];

  export interface DiffLinesOptions {
    ignoreWhitespace?: boolean;
    newlineIsToken?: boolean;
    stripTrailingCr?: boolean;
  }

  export function diffLines(oldText: string, newText: string, options?: DiffLinesOptions): Change[];
}
