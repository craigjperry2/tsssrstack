// Building blocks shared by the domain modules.

declare const brand: unique symbol;
// A value that has passed its checked constructor. Brands are erased at runtime, but the type
// checker refuses a plain string where, say, a TaskTitle is required.
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

// Expected failures are values, not exceptions; adapters decide how to present them.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Length in Unicode code points, so an emoji counts once, as PostgreSQL's char_length does.
export const codePoints = (value: string): number => Array.from(value).length;
