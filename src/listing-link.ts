import type { Listing } from "./listings";

/** Wait for registration/publication races without making the buyer click again.
 * Never activate a listing here: only the authenticated publication API may do so.
 */
export async function resolveListingLink(
  token: string,
  lookup: (token: string) => Listing | undefined,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    onLookup?: (listing: Listing | undefined, attempt: number) => void;
  } = {},
): Promise<Listing | undefined> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return undefined;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? 8000);
  let attempt = 0;
  for (;;) {
    const listing = lookup(token);
    options.onLookup?.(listing, ++attempt);
    if (listing && listing.status !== "pending") return listing;
    const remaining = deadline - now();
    if (remaining <= 0) return listing;
    await sleep(Math.min(options.intervalMs ?? 250, remaining));
  }
}
