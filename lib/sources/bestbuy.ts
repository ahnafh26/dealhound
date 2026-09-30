import 'server-only';

import { missingEnv, readEnv } from '@/lib/env';
import { politeFetch, useFixtures } from '@/lib/http';
import type { Condition, Listing, SearchRegion, SourceAdapter } from '@/lib/types';

/**
 * Best Buy's Products API. US only: the Canadian store has no public API,
 * and Google Shopping already covers it.
 */

const REQUIRED = ['BESTBUY_API_KEY'] as const;

export const bestbuy: SourceAdapter = {
  id: 'bestbuy',
  name: 'Best Buy (US)',
  type: 'retail',
  requiredEnv: REQUIRED,
  regions: ['US'],
  enabled: () => useFixtures() || missingEnv(REQUIRED).length === 0,
  async search(spec, { region, signal, limit }) {
    // Best Buy's query language: products((search=macbook&search=air)). Words only.
    const words = spec.searchQuery
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => `search=${word}`);
    if (words.length === 0) return [];
    const params = new URLSearchParams({
      apiKey: readEnv('BESTBUY_API_KEY') ?? '',
      format: 'json',
      pageSize: String(Math.min(limit, 50)),
      show: 'sku,name,salePrice,url,image,condition,freeShipping,shippingCost',
    });
    const response = await politeFetch(`https://api.bestbuy.com/v1/products((${words.join('&')}))?${params}`, {
      source: 'bestbuy',
      fixture: 'search.json',
      signal,
      minIntervalMs: 0,
    });
    if (!response.ok) throw new Error(`Best Buy returned HTTP ${response.status}`);
    return parseBestBuyProducts(JSON.parse(response.text), region);
  },
};

interface BestBuyProduct {
  sku?: number;
  name?: string;
  salePrice?: number;
  url?: string;
  image?: string | null;
  condition?: string;
  freeShipping?: boolean;
  shippingCost?: number | string;
}

const CONDITIONS: Record<string, Condition> = { new: 'new', refurbished: 'refurb', 'pre-owned': 'used' };

export function parseBestBuyProducts(body: unknown, region: SearchRegion): Listing[] {
  const products = (body as { products?: BestBuyProduct[] } | null)?.products ?? [];
  return products.flatMap((product): Listing[] => {
    if (!product.sku || !product.name || !product.url || typeof product.salePrice !== 'number') return [];
    const shippingCost = Number(product.shippingCost);
    return [
      {
        id: `bestbuy:${product.sku}`,
        source: 'bestbuy',
        sourceType: 'retail',
        channel: 'retailer',
        url: product.url,
        title: product.name,
        price: product.salePrice,
        currency: region.currency,
        // shippingCost is "" when it depends on the address.
        shipping: product.freeShipping ? 0 : product.shippingCost !== '' && Number.isFinite(shippingCost) ? shippingCost : null,
        condition: CONDITIONS[product.condition?.toLowerCase() ?? ''] ?? 'unknown',
        conditionText: product.condition,
        seller: 'Best Buy',
        imageUrl: product.image ?? undefined,
        imageCount: product.image ? 1 : undefined,
        raw: product,
      },
    ];
  });
}
