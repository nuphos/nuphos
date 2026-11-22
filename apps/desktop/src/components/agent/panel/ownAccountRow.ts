/**
 * What a selector row shows for a member's accounts of one provider: the first account's label,
 * a tooltip naming every account, and a count of the rest (null with a single account).
 */
export function ownAccountRow(
  logins: string[],
  you: (login: string) => string,
  more: (count: number) => string,
): { text: string; title: string; more: string | null } {
  return {
    text: you(logins[0] ?? ''),
    title: you(logins.join(', ')),
    more: logins.length > 1 ? more(logins.length - 1) : null,
  }
}
