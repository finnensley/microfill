import type { WmsAdapter, WmsProvider } from "./types";
import { shipHeroAdapter } from "./shiphero";
import { fishbowlAdapter } from "./fishbowl";

export type { WmsAdapter, WmsNormalizedPayload, WmsProvider } from "./types";

/**
 * Registry of all active WMS adapters.
 * Add new adapters here after creating their adapter file.
 * Fishbowl is registered but its verifySignature always returns false until
 * the implementation is completed.
 */
const registry: Partial<Record<WmsProvider, WmsAdapter>> = {
  shiphero: shipHeroAdapter,
  fishbowl: fishbowlAdapter,
};

/**
 * Return the WMS adapter for a given provider, or null if not registered.
 * Use this in webhook routes to access provider-specific HMAC and normalization logic.
 */
export function getWmsAdapter(provider: WmsProvider): WmsAdapter | null {
  return registry[provider] ?? null;
}
