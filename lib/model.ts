// The token radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that passes the house's own watchlist rule as far as the
// snapshot's ten fields allow: it records no token, it is not a wrapped, staked or bridged
// product (its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
// Restaked BTC or CEX, its name carries no whole word wrapped, staked or staking, and it
// does not begin with an exchange's name), and its name ends in no version marker. The
// watchlist is the floor: all 40 of its slugs are on the board, plus every other protocol
// that passes the same rule, above or below the floor. The one part of the house rule the
// snapshot cannot carry, DefiLlama's parentProtocol, is the one part this model cannot
// check, and the dashboard says so.
//
// Implied value is calibrated from the snapshot itself, not from a flat multiple. The
// live-token protocols in the same snapshot are the market's own comps: for each category
// the model takes the median market-cap-to-TVL ratio of the live-token protocols in that
// category (at least three comps, else the global median), clamped to a sane band. Then:
//
//   base      = tvl_usd x category_multiple
//   growth    = clamp(change_7d, -50, 100) per cent (unreported: 0)
//   growthMul = 1 + (growth / 100) x 0.6
//   maturity  = 0.70 + 0.30 x ln(1 + min(age_days, 1095)) / ln(1 + 1095)  (age unknown: 365)
//   breadth   = 1 + 0.02 x min(max(chains - 1, 0), 4)
//   implied   = max(1, round(base x growthMul x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and every
// constant is stated in the dashboard, where the sandbox may change it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comps: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  min_comps: 3,
  breadth_per_chain: 0.02,
  breadth_max_chains: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 32;

/** One category's calibration: the live-token comps behind its multiple. */
export interface CalibrationEntry {
  category: string;
  multiple: number;
  comps: number;
  fallback: boolean;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comps: number;
    fallback_multiple: boolean;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  comps: number;
  fallback_multiple: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  above_floor_extra: number;
  live_size: number;
  set_aside: number;
  global_multiple: number;
  global_comps: number;
  calibration: CalibrationEntry[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Four-decimal rounding for the multipliers the board and the page both show. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a sorted array of numbers; the mean of the two middles when even. */
function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist rule's category exclusions: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a clean protocol's name must not begin with. */
const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/** A whole word wrapped, staked or staking anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name ending in a version marker is a pool of another protocol, not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether a protocol passes the watchlist's cleanliness rule as far as the snapshot's ten
 * fields allow. The rule's parent-protocol part cannot be checked: parentProtocol is not
 * one of the snapshot's fields, and the dashboard says that plainly.
 */
export function isCleanPreToken(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const lower = p.name.toLowerCase();
  if (EXCHANGE_PREFIXES.some((x) => lower.startsWith(x))) return false;
  return true;
}

/** The calibration: one multiple per category, from the live-token comps in this snapshot. */
export interface Calibration {
  byCategory: Map<string, { multiple: number; comps: number; fallback: boolean }>;
  globalMultiple: number;
  globalComps: number;
}

/**
 * Calibrate the TVL-to-value multiple from the snapshot's own live-token protocols. Each
 * category's multiple is the median market-cap-to-TVL ratio of its live-token protocols
 * with a market cap and a TVL; a category with fewer than `min_comps` comps falls back
 * to the global median. Every multiple is clamped to [multiple_floor, multiple_cap] so
 * one thin category cannot set an absurd price.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  allRatios.sort((a, b) => a - b);
  const globalRaw = medianSorted(allRatios);
  const globalMultiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalRaw));
  const byCategory = new Map<string, { multiple: number; comps: number; fallback: boolean }>();
  for (const [category, ratios] of ratiosByCategory) {
    ratios.sort((a, b) => a - b);
    if (ratios.length >= model.min_comps) {
      const raw = medianSorted(ratios);
      byCategory.set(category, {
        multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw)),
        comps: ratios.length,
        fallback: false,
      });
    } else {
      byCategory.set(category, { multiple: globalMultiple, comps: ratios.length, fallback: true });
    }
  }
  return { byCategory, globalMultiple, globalComps: allRatios.length };
}

/** The multiple one category gets: its own median, or the global median where it has too few comps. */
export function multipleFor(category: string | null, calibration: Calibration): { multiple: number; comps: number; fallback: boolean } {
  const entry = calibration.byCategory.get(category ?? 'Other');
  if (entry !== undefined) return entry;
  return { multiple: calibration.globalMultiple, comps: 0, fallback: true };
}

/** The three multipliers, the category multiple and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: Calibration,
): {
  implied: number;
  multiple: number;
  comps: number;
  fallback: boolean;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, comps, fallback } = multipleFor(protocol.category, calibration);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  // A log curve: surviving the first year is most of the evidence; later years add less.
  const maturityMult =
    model.maturity_floor + (Math.log(1 + cappedAge) / Math.log(1 + model.maturity_days)) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, comps, fallback, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whatever else the rule says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Everything else that passes the same cleanliness rule, above or below the floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isCleanPreToken(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, calibration);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      // Full precision, unrounded: the page recomputes this row from the same
      // figures and must land on the same implied value board.json carries.
      category_multiple: s.v.multiple,
      comps: s.v.comps,
      fallback_multiple: s.v.fallback,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for its points.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Chains where one transaction costs cents rather than dollars. */
const CHEAP_CHAINS = new Set([
  'Solana', 'Sui', 'Aptos', 'TON', 'Near', 'Avalanche', 'Fantom', 'Celo', 'Sei', 'Injective',
  'Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Mantle', 'Ink', 'Linea', 'Scroll',
  'Blast', 'Mode', 'Starknet', 'BOB', 'Unichain', 'World Chain', 'Berachain', 'Monad', 'MegaETH',
]);

/** What one transaction on this chain costs, in the words a farmer can budget. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $8 of gas a transaction';
  if (CHEAP_CHAINS.has(chain)) return 'under $0.50 of gas a transaction';
  return 'about $1 of gas a transaction';
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator'))
    return `Deposit $${capital} into a ${name} curator vault on ${chain} and keep the vault shares in the farming wallet.`;
  if (c.includes('lend') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} as a lender, then borrow a small amount against it so the position shows both sides.`;
  if (c.includes('dex') || c.includes('liquidity manager'))
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position without withdrawing.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged'))
    return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the receipt tokens in the wallet.`;
  if (c.includes('cdp') || c.includes('stablecoin wrapper') || c.includes('dual-token'))
    return `Lock $${capital} of collateral in ${name} on ${chain} and mint a small amount of its stable asset, keeping the ratio healthy.`;
  if (c.includes('derivative') || c.includes('interest rate'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it after a week.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and take one position in its most liquid market, then hold it to resolution.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active through the whole hold.`;
  if (c.includes('basis'))
    return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the position through one full funding cycle.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds in its own app the same week.`;
  if (c.includes('restak') || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('payment') || c.includes('card'))
    return `Load $${capital} onto ${name} and make one real payment a week from the farming wallet.`;
  if (c.includes('index'))
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it through the qualifying window.`;
  if (c.includes('governance'))
    return `Lock $${capital} in ${name}'s incentive program on ${chain} and vote once in each proposal cycle.`;
  if (c.includes('otc'))
    return `Place one $${capital} order through ${name} and complete the trade from the farming wallet.`;
  if (c.includes('chain'))
    return `Move $${capital} onto ${name} and make one on-chain action a week: a swap, a stake, or a contract call.`;
  if (c.includes('btc') || c.includes('bitcoin'))
    return `Deposit $${capital} of BTC through ${name} on ${chain} and hold the receipt asset in the farming wallet.`;
  if (c.includes('cedefi'))
    return `Deposit $${capital} into ${name}'s managed account on ${chain} and keep the balance staked.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different move from the main one, done weekly. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('collateral') || c.includes('cdp')) return 'a borrow, a repay, or a fresh supply';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'a swap through the pool, or a small add and remove of liquidity';
  if (c.includes('derivative') || c.includes('interest rate')) return 'one small trade, opened and closed in the same week';
  if (c.includes('prediction')) return 'one position in a new market, or an add to an open one';
  if (c.includes('governance')) return 'a vote, or a comment in the protocol forum';
  if (c.includes('bridge')) return 'one more bridge of any size';
  if (c.includes('payment') || c.includes('card')) return 'one real payment';
  return 'a deposit, a swap, a vote, or a small top-up';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and open the protocol only from its own listing page.`,
      cost: 'no capital, and never pay anyone for access',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as ${weeklyFor(p)}, so the wallet stays active between snapshots.`,
      cost: gas + ' a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not empty the wallet in between.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; a claim that asks you to pay or to connect first is a scam.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then unwind in two tranches a week apart and keep a small position in case of later snapshots.`,
      cost: gas + ' per tranche',
      time: '5 minutes to log, a week to unwind',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comps: row.model.comps,
    fallback_multiple: row.model.fallback_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const aboveFloorExtra = board.filter((r) => !watchlist.has(r.slug) && r.tvl_usd >= snapshot.floor_usd).length;
  const setAside = snapshot.protocols.filter((p) => !isCleanPreToken(p)).length;
  const usedCategories = new Set(board.map((r) => r.category ?? 'Other'));
  const calibrationTable: CalibrationEntry[] = [...usedCategories]
    .map((category) => {
      const entry = calibration.byCategory.get(category);
      return {
        category,
        multiple: round4(entry?.multiple ?? calibration.globalMultiple),
        comps: entry?.comps ?? 0,
        fallback: entry?.fallback ?? true,
      };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    above_floor_extra: aboveFloorExtra,
    live_size: live.length,
    set_aside: setAside,
    global_multiple: round4(calibration.globalMultiple),
    global_comps: calibration.globalComps,
    calibration: calibrationTable,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
