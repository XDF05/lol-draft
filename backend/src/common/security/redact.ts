/**
 * Remove values that must not be copied into logs or error responses.
 *
 * A draft code is the capability used by its spectator URL. Even though the
 * code is public to an invited spectator, copying it into logs or unrelated
 * error bodies needlessly broadens disclosure. Query strings are dropped in
 * full because clients may accidentally place tokens or other credentials in
 * them.
 */
export function redactRequestPath(rawUrl: string | undefined): string {
  const path = (rawUrl ?? '/').split('?', 1)[0] || '/';
  return path.replace(
    /(\/(?:public\/)?draft\/)[^/]+/g,
    '$1[redacted]',
  );
}
