import type { SourceAdapter } from '@/lib/types';

/**
 * Kijiji: deliberately never searched. Its Terms of Use prohibit scraping
 * and it blocks automated traffic.
 *
 * TODO(browser-extension): same plan as Facebook Marketplace; see
 * facebook-marketplace.ts.
 */
export const kijiji: SourceAdapter = {
  id: 'kijiji',
  name: 'Kijiji',
  type: 'marketplace',
  regions: ['CA'],
  enabled: () => false,
  disabledReason: () => 'Not searched: its Terms prohibit automated access (browser extension planned)',
  search: async () => [],
};
