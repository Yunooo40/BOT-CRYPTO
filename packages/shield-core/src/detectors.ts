import { asHex } from "@bot/dex-adapters";
import type { Address, RiskFactor } from "@bot/domain";
import { erc20Abi, getOwnerAbi, ownerAbi, uintGetterAbi } from "./abi";
import {
  hasAnySelector,
  hasDelegateCall,
  LIMIT_SIGNATURES,
  MINT_SIGNATURES,
  PAUSE_BLACKLIST_SIGNATURES,
  TAX_SIGNATURES,
} from "./bytecode";
import type { Detector, ShieldClient } from "./detector";

type Factor = Omit<RiskFactor, "detector" | "weight">;

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
// EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1.
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Known LP lockers on Base (extend as needed). Lowercased for `===`. */
export const KNOWN_LOCKERS: readonly Address[] = [
  "0x71b5759d73262fbb223956913ecf4ecc51057641", // UNCX
  "0xdba68f07d1b7ca219f78ae8582c213d975c25caf", // team.finance
] as unknown as Address[];

async function balanceOf(client: ShieldClient, token: Address, holder: Address): Promise<bigint> {
  return client.readContract({
    address: asHex(token),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [asHex(holder)],
  });
}

async function totalSupply(client: ShieldClient, token: Address): Promise<bigint> {
  return client.readContract({ address: asHex(token), abi: erc20Abi, functionName: "totalSupply" });
}

/** #1 — reference-token liquidity in the pool, by tiers (needs a pool). */
export const liquidityDetector: Detector = {
  name: "liquidity",
  weight: 0.15,
  // In the gate: one balanceOf read. Whether real liquidity exists is a
  // top-tier rug signal — never buy without it.
  fast: true,
  async detect(ctx): Promise<Factor> {
    if (ctx.pool === undefined) {
      return { score: 50, detail: "no pool provided; liquidity not assessed" };
    }
    const reserve = await balanceOf(ctx.client, ctx.quoteToken, ctx.pool.address);
    // WETH-denominated tiers (18 decimals). Thin liquidity = easy rug.
    const eth = Number(reserve) / 1e18;
    if (eth >= 5) return { score: 5, detail: `deep liquidity (~${eth.toFixed(2)} WETH)` };
    if (eth >= 1) return { score: 25, detail: `moderate liquidity (~${eth.toFixed(2)} WETH)` };
    if (eth >= 0.2) return { score: 60, detail: `thin liquidity (~${eth.toFixed(3)} WETH)` };
    return { score: 90, detail: `negligible liquidity (~${eth.toFixed(4)} WETH)` };
  },
};

/** #2 — LP token security: burned or locked share (V2-style pools only). */
export const lpSecurityDetector: Detector = {
  name: "lp-security",
  weight: 0.15,
  // In the gate: the single strongest anti-rug signal (is the LP locked/burned).
  // Reads run in parallel so it stays fast enough for the pre-trade path.
  fast: true,
  async detect(ctx): Promise<Factor> {
    if (ctx.pool === undefined) {
      return { score: 50, detail: "no pool provided; LP security not assessed" };
    }
    if (ctx.pool.dex === "uniswap-v3") {
      return {
        score: 40,
        detail: "V3 concentrated liquidity: LP-burn not applicable, not evaluable",
      };
    }
    const lp = ctx.pool.address;
    const supply = await totalSupply(ctx.client, lp);
    if (supply === 0n) {
      return { score: 60, detail: "no LP supply yet" };
    }
    const holders = [ZERO, DEAD, ...KNOWN_LOCKERS] as Address[];
    const balances = await Promise.all(holders.map((holder) => balanceOf(ctx.client, lp, holder)));
    const secured = balances.reduce((sum, balance) => sum + balance, 0n);
    const pct = Number((secured * 10_000n) / supply) / 100;
    if (pct >= 95) return { score: 5, detail: `${pct.toFixed(1)}% of LP burned/locked` };
    if (pct >= 50) return { score: 35, detail: `${pct.toFixed(1)}% of LP burned/locked` };
    return { score: 85, detail: `only ${pct.toFixed(1)}% of LP burned/locked — rug risk` };
  },
};

/** #3 — ownership: renounced, EOA, or a contract. */
export const ownershipDetector: Detector = {
  name: "ownership",
  weight: 0.1,
  fast: true,
  async detect(ctx): Promise<Factor> {
    let owner: string | undefined;
    try {
      owner = await ctx.client.readContract({
        address: asHex(ctx.token),
        abi: ownerAbi,
        functionName: "owner",
      });
    } catch {
      try {
        owner = await ctx.client.readContract({
          address: asHex(ctx.token),
          abi: getOwnerAbi,
          functionName: "getOwner",
        });
      } catch {
        return { score: 20, detail: "no owner()/getOwner() — likely ownerless" };
      }
    }
    if (owner.toLowerCase() === ZERO || owner.toLowerCase() === DEAD) {
      return { score: 5, detail: "ownership renounced" };
    }
    const ownerCode = await ctx.client
      .getCode({ address: owner as `0x${string}` })
      .catch(() => undefined);
    const isContract = ownerCode !== undefined && ownerCode !== "0x";
    return isContract
      ? { score: 55, detail: `owned by a contract (${owner}) — powers depend on it` }
      : { score: 45, detail: `owned by an EOA (${owner}) — retains privileges` };
  },
};

function bytecodeDetector(
  name: string,
  weight: number,
  signatures: readonly string[],
  hit: string,
  clear: string,
): Detector {
  return {
    name,
    weight,
    fast: true,
    async detect(ctx): Promise<Factor> {
      const found = hasAnySelector(ctx.bytecode, signatures);
      return found.length > 0
        ? { score: 70, detail: `${hit}: ${found.join(", ")}` }
        : { score: 10, detail: clear };
    },
  };
}

/** #4 — mint capability. */
export const mintDetector = bytecodeDetector(
  "mint",
  0.1,
  MINT_SIGNATURES,
  "mint function present — supply can inflate",
  "no mint selector found",
);

/** #5 — pause / blacklist / freeze. */
export const pauseBlacklistDetector = bytecodeDetector(
  "pause-blacklist",
  0.1,
  PAUSE_BLACKLIST_SIGNATURES,
  "pause/blacklist function present — trading can be blocked",
  "no pause/blacklist selector found",
);

/** #6 — proxy: EIP-1967 implementation slot (decisive) and/or delegatecall. */
export const proxyDetector: Detector = {
  name: "proxy",
  weight: 0.08,
  fast: true,
  async detect(ctx): Promise<Factor> {
    const slot = await ctx.client
      .getStorageAt({ address: asHex(ctx.token), slot: EIP1967_IMPL_SLOT })
      .catch(() => undefined);
    if (slot !== undefined && /[1-9a-f]/.test(slot.slice(2))) {
      const impl = `0x${slot.slice(-40)}`;
      return { score: 60, detail: `EIP-1967 proxy — logic at ${impl}, upgradeable` };
    }
    return hasDelegateCall(ctx.bytecode)
      ? { score: 40, detail: "delegatecall present — upgradeable/proxy logic possible" }
      : { score: 10, detail: "no proxy tell (no EIP-1967 slot, no delegatecall)" };
  },
};

/** #7 — max tx / max wallet limits. */
export const limitsDetector = bytecodeDetector(
  "limits",
  0.06,
  LIMIT_SIGNATURES,
  "max tx/wallet limits present — position size may be capped",
  "no tx/wallet limit selector found",
);

/** #8 — trading taxes. */
export const taxesDetector: Detector = {
  name: "taxes",
  weight: 0.08,
  // In the gate: a bytecode scan plus a couple of getter reads. Punitive taxes
  // silently eat the whole position, so it belongs before the buy.
  fast: true,
  async detect(ctx): Promise<Factor> {
    const found = hasAnySelector(ctx.bytecode, TAX_SIGNATURES);
    if (found.length === 0) {
      return { score: 10, detail: "no tax selector found" };
    }
    // Try to read an actual rate; many expose buyTax()/sellTax() as percents.
    for (const getter of ["buyTax", "sellTax", "totalFees"]) {
      try {
        const value = await ctx.client.readContract({
          address: asHex(ctx.token),
          abi: uintGetterAbi(getter),
          functionName: getter,
        });
        const pct = Number(value);
        if (pct > 25) return { score: 90, detail: `${getter}=${pct}% — punitive tax` };
        if (pct > 10) return { score: 60, detail: `${getter}=${pct}% — high tax` };
        return { score: 30, detail: `${getter}=${pct}%` };
      } catch {
        // try the next getter
      }
    }
    return { score: 45, detail: `tax functions present (${found.join(", ")}), rate unreadable` };
  },
};

/** #9 — honeypot sell simulation via eth_call. */
export const honeypotDetector: Detector = {
  name: "honeypot-sell",
  weight: 0.2,
  // In the gate: the highest-weighted detector. Buying a token you cannot sell
  // is the worst outcome, so this must run before the buy — one balanceOf read.
  fast: true,
  async detect(ctx): Promise<Factor> {
    // A faithful sell simulation needs a state override to grant the caller a
    // balance, and the token's balance storage slot — which varies per token.
    // Without a reliable slot we report honestly rather than guess a `safe`.
    if (ctx.pool === undefined) {
      return { score: 50, detail: "no pool; sell simulation not attempted" };
    }
    try {
      // Probe: can a holder's balance even be read back? A token that reverts
      // balanceOf on the pool is already deeply suspicious.
      const poolBalance = await balanceOf(ctx.client, ctx.token, ctx.pool.address);
      if (poolBalance === 0n) {
        return { score: 55, detail: "token has no balance in its own pool — cannot sell" };
      }
      return {
        score: 40,
        detail:
          "sell path present; full honeypot simulation requires slot override (indeterminate)",
      };
    } catch {
      return { score: 70, detail: "balanceOf reverted — likely non-standard/honeypot behaviour" };
    }
  },
};

/** #10 — supply concentration outside the pool. */
export const concentrationDetector: Detector = {
  name: "supply-concentration",
  weight: 0.05,
  fast: false,
  async detect(ctx): Promise<Factor> {
    const supply = await totalSupply(ctx.client, ctx.token);
    if (supply === 0n) {
      return { score: 80, detail: "zero total supply" };
    }
    if (ctx.pool === undefined) {
      return { score: 50, detail: "no pool; concentration not assessed" };
    }
    const inPool = await balanceOf(ctx.client, ctx.token, ctx.pool.address);
    const circulatingPct = Number((inPool * 10_000n) / supply) / 100;
    if (circulatingPct >= 50)
      return { score: 10, detail: `${circulatingPct.toFixed(1)}% of supply in the pool` };
    if (circulatingPct >= 20)
      return { score: 35, detail: `${circulatingPct.toFixed(1)}% of supply in the pool` };
    return {
      score: 70,
      detail: `only ${circulatingPct.toFixed(1)}% of supply in the pool — concentrated elsewhere`,
    };
  },
};

/** #11 — token shape sanity. */
export const tokenShapeDetector: Detector = {
  name: "token-shape",
  weight: 0.03,
  fast: true,
  async detect(ctx): Promise<Factor> {
    if (ctx.bytecode === "0x" || ctx.bytecode.length <= 2) {
      return { score: 100, detail: "no contract code at token address — not an ERC-20" };
    }
    try {
      const [supply, decimals] = await Promise.all([
        totalSupply(ctx.client, ctx.token),
        ctx.client.readContract({
          address: asHex(ctx.token),
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
      const problems: string[] = [];
      if (supply === 0n) problems.push("zero supply");
      if (Number(decimals) > 36) problems.push(`implausible decimals (${decimals})`);
      return problems.length > 0
        ? { score: 75, detail: `malformed ERC-20: ${problems.join(", ")}` }
        : { score: 5, detail: "well-formed ERC-20 (code, supply, decimals ok)" };
    } catch {
      return { score: 70, detail: "totalSupply()/decimals() reverted — non-standard token" };
    }
  },
};

/** The 11 detectors, in reporting order. */
export function defaultDetectors(): Detector[] {
  return [
    liquidityDetector,
    lpSecurityDetector,
    ownershipDetector,
    mintDetector,
    pauseBlacklistDetector,
    proxyDetector,
    limitsDetector,
    taxesDetector,
    honeypotDetector,
    concentrationDetector,
    tokenShapeDetector,
  ];
}
