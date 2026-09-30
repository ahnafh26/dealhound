import type { SourceAdapter } from '@/lib/types';

/**
 * Facebook Marketplace: deliberately never searched. Meta's Terms prohibit
 * automated collection and Marketplace actively blocks it.
 *
 * TODO(browser-extension): a companion extension that reads the one listing
 * the shopper is already looking at (title, price, condition, seller, photos)
 * and sends it to DealHound for a true-cost and risk verdict against the
 * current search. User-initiated, one page at a time, no crawling.
 */
export const facebookMarketplace: SourceAdapter = {
  id: 'facebook-marketplace',
  name: 'Facebook Marketplace',
  type: 'marketplace',
  enabled: () => false,
  disabledReason: () => 'Not searched: its Terms prohibit automated access (browser extension planned)',
  search: async () => [],
};
