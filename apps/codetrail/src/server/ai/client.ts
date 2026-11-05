// The configured model and its live price. Prices come from Token Factory's own list and are re-read hourly.
import { env } from "@/env";
import type { CallUsage, NebiusConfig } from "./nebius";
import { fetchPrices, type PriceList } from "./pricing";

let prices: { at: number; list: Promise<PriceList | null> } | undefined;

export function getPrices(): Promise<PriceList | null> {
  if (!env.NEBIUS_API_KEY) return Promise.resolve(null);
  if (!prices || Date.now() - prices.at > 60 * 60 * 1000) {
    const list = fetchPrices(env.NEBIUS_API_KEY, env.NEBIUS_BASE_URL).catch((error) => {
      console.error("Couldn't load Token Factory prices", error);
      prices = undefined;
      return null;
    });
    prices = { at: Date.now(), list };
  }
  return prices.list;
}

export function nebius(onUsage?: (u: CallUsage) => void): NebiusConfig {
  return { apiKey: env.NEBIUS_API_KEY ?? "", baseURL: env.NEBIUS_BASE_URL, model: env.NEBIUS_MODEL, onUsage };
}
