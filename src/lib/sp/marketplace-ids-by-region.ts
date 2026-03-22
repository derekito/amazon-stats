/**
 * Official SP-API marketplace ids grouped by selling region (which host to use).
 * @see https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
 * @see https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints
 */
export const MARKETPLACE_IDS_BY_SP_REGION = {
  na: [
    "A2EUQ1WTGCTBG2", // CA
    "ATVPDKIKX0DER", // US
    "A1AM78C64UM0Y8", // MX
    "A2Q3Y263D00KWC", // BR
  ],
  eu: [
    "A28R8C7NBKEWEA", // IE
    "A1RKKUPIHCS9HS", // ES
    "A1F83G8C2ARO7P", // UK
    "A13V1IB3VIYZZH", // FR
    "AMEN7PMS3EDWL", // BE
    "A1805IZSGTT6HS", // NL
    "A1PA6795UKMFR9", // DE
    "APJ6JRA9NG5V4", // IT
    "A2NODRKZP88ZB9", // SE
    "AE08WJ6YKNBMC", // ZA
    "A1C3SOZRARQ6R3", // PL
    "ARBP9OOSHTCHU", // EG
    "A33AVAJ2PDY3EV", // TR
    "A17E79C6D8DWNP", // SA
    "A2VIGQ35RCS4UG", // AE
    "A21TJRUUN4KGV", // IN
  ],
  fe: [
    "A19VAU5U5O7RUS", // SG
    "A39IBJ37TRP1C6", // AU
    "A1VC38T7YXB528", // JP
  ],
} as const;

export type SpApiRegion = keyof typeof MARKETPLACE_IDS_BY_SP_REGION;

export function marketplaceIdsForRegion(region: SpApiRegion): Set<string> {
  return new Set(MARKETPLACE_IDS_BY_SP_REGION[region]);
}
