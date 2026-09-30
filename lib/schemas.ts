/**
 * Zod schemas for data crossing a trust boundary: adapter output, fixture
 * files, and request bodies. (LLM output joins this list with the spec parser.)
 */

import { z } from 'zod';
import { SEARCH } from './config';
import { CHANNELS, CONDITIONS, REGION_CODES, SOURCE_TYPES, type Listing } from './types';

export const ChannelSchema = z.enum(CHANNELS);
export const ConditionSchema = z.enum(CONDITIONS);

const money = z.number().nonnegative();

/** Validates a Listing; `raw` is left alone. */
export const ListingSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceType: z.enum(SOURCE_TYPES),
  channel: ChannelSchema,
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().trim().min(1),
  price: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  shipping: money.nullable(),
  condition: ConditionSchema,
  conditionText: z.string().optional(),
  seller: z.string().optional(),
  sellerRating: z.number().min(0).max(100).optional(),
  sellerFeedbackCount: z.number().int().nonnegative().optional(),
  location: z.string().optional(),
  imageUrl: z.url().optional(),
  imageCount: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
  warrantyMonths: z.number().int().nonnegative().optional(),
  postedAt: z.iso.datetime({ offset: true }).optional(),
}) satisfies z.ZodType<Omit<Listing, 'raw'>>;

export const SearchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Type at least 2 characters.')
    .max(SEARCH.queryMaxLength, `Keep it under ${SEARCH.queryMaxLength} characters.`),
  postalCode: z.string().trim().max(12).optional(),
  region: z.enum(REGION_CODES).optional(),
  /** false: search the query as typed, never answer with a clarifying question. */
  clarify: z.boolean().optional(),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
