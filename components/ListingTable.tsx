import { CONDITION_LABELS, formatMoney } from '@/lib/format';
import type { ClientListing, Condition } from '@/lib/types';

/** Price plus known shipping. */
export function landedPrice(listing: ClientListing): number {
  return listing.price + (listing.shipping ?? 0);
}

interface ListingTableProps {
  listings: ClientListing[];
  sourceNames: Record<string, string>;
  locale: string;
}

export function ListingTable({ listings, sourceNames, locale }: ListingTableProps) {
  const money = (amount: number, listing: ClientListing) => formatMoney(amount, listing.currency, locale);

  return (
    <>
      {/* Phones: cards */}
      <ul className="space-y-3 md:hidden">
        {listings.map((listing) => (
          <li
            key={listing.id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <ListingTitle listing={listing} />
            <ListingMeta listing={listing} sourceNames={sourceNames} />
            <div className="mt-3 flex items-end justify-between gap-3">
              <ConditionBadge condition={listing.condition} />
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">{money(landedPrice(listing), listing)}</div>
                <div className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {shippingNote(listing, locale)}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Tablets and up: table */}
      <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wider text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Listing
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Condition
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Price
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Shipping
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {listings.map((listing) => (
              <tr key={listing.id} className="align-top hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                <td className="max-w-md px-4 py-3">
                  <ListingTitle listing={listing} />
                  <ListingMeta listing={listing} sourceNames={sourceNames} />
                </td>
                <td className="px-4 py-3">
                  <ConditionBadge condition={listing.condition} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(listing.price, listing)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">
                  {shippingLabel(listing, locale)}
                </td>
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">
                  {money(landedPrice(listing), listing)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ListingTitle({ listing }: { listing: ClientListing }) {
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="line-clamp-2 font-medium text-zinc-900 decoration-emerald-600 underline-offset-2 hover:underline dark:text-zinc-100"
    >
      {listing.title}
    </a>
  );
}

function ListingMeta({ listing, sourceNames }: { listing: ClientListing; sourceNames: Record<string, string> }) {
  const parts = [sourceNames[listing.source] ?? listing.source, listing.seller, listing.location];
  if (listing.sellerRating !== undefined) {
    const count = listing.sellerFeedbackCount;
    parts.push(`${listing.sellerRating}% positive${count !== undefined ? ` (${count.toLocaleString()})` : ''}`);
  } else if (listing.sellerFeedbackCount === 0) {
    parts.push('no seller feedback');
  }
  return (
    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{parts.filter(Boolean).join(' · ')}</p>
  );
}

function shippingLabel(listing: ClientListing, locale: string): string {
  if (listing.channel === 'local-marketplace' && !listing.shipping) return 'Pickup';
  if (listing.shipping === null) return 'Unknown';
  if (listing.shipping === 0) return 'Free';
  return formatMoney(listing.shipping, listing.currency, locale);
}

/** Card subtitle under the total, e.g. "$1,049.00 + $25.00 shipping". */
function shippingNote(listing: ClientListing, locale: string): string {
  if (listing.channel === 'local-marketplace' && !listing.shipping) return 'Local pickup';
  if (listing.shipping === null) return 'Shipping unknown';
  if (listing.shipping === 0) return 'Free shipping';
  const price = formatMoney(listing.price, listing.currency, locale);
  return `${price} + ${formatMoney(listing.shipping, listing.currency, locale)} shipping`;
}

const CONDITION_TONES: Record<Condition, string> = {
  new: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  'open-box': 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/20',
  refurb: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  'used-excellent': 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  'used-good': 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  'used-fair': 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  used: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  parts: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  unknown: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-400/20',
};

function ConditionBadge({ condition }: { condition: Condition }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${CONDITION_TONES[condition]}`}
    >
      {CONDITION_LABELS[condition]}
    </span>
  );
}
