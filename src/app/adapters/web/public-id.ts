import Sqids from 'sqids';

// Public ids keep sequential database keys out of URLs. They are not an access control: every
// task SQL statement is scoped to the signed-in owner.
const sqids = new Sqids({
  alphabet: 'nTjWkP2QGBVqby6Eo3aONFwKADZ84SUYdL1v0h9fH7gCprRJXe5xismctMluIz',
  minLength: 10,
});

export const encodePublicId = (id: number): string => sqids.encode([id]);

export function decodePublicId(raw: string): number | undefined {
  try {
    const decoded = sqids.decode(raw);
    return decoded.length === 1 && Number.isSafeInteger(decoded[0]) ? decoded[0] : undefined;
  } catch {
    return undefined;
  }
}
