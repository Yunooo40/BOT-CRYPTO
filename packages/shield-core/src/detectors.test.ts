import { toAddress, type Pool } from "@bot/domain";
import { toFunctionSelector } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { DetectorContext, ShieldClient } from "./detector";
import {
  concentrationDetector,
  defaultDetectors,
  honeypotDetector,
  limitsDetector,
  liquidityDetector,
  lpSecurityDetector,
  mintDetector,
  ownershipDetector,
  pauseBlacklistDetector,
  proxyDetector,
  taxesDetector,
  tokenShapeDetector,
} from "./detectors";

const TOKEN = toAddress("0x9999999999999999999999999999999999999999");
const WETH = toAddress("0x4200000000000000000000000000000000000006");
const POOL_ADDR = toAddress("0x1111111111111111111111111111111111111111");
const OWNER = toAddress("0x2222222222222222222222222222222222222222");
const ZERO = "0x0000000000000000000000000000000000000000";

const v2Pool: Pool = {
  chainId: 8453,
  address: POOL_ADDR,
  dex: "uniswap-v2",
  token0: WETH,
  token1: TOKEN,
};

/** Build bytecode that embeds the selectors of the given signatures. */
function codeWith(...signatures: string[]): `0x${string}` {
  const body = signatures.map((sig) => toFunctionSelector(sig).slice(2)).join("00");
  return `0x60806040${body}` as `0x${string}`;
}

function ctx(overrides: Partial<DetectorContext> & { client: ShieldClient }): DetectorContext {
  return {
    chainId: 8453,
    token: TOKEN,
    quoteToken: WETH,
    pool: v2Pool,
    bytecode: "0x60806040",
    ...overrides,
  };
}

describe("pre-trade gate composition", () => {
  const gate = defaultDetectors().filter((detector) => detector.fast);
  const gateNames = gate.map((detector) => detector.name);

  it("includes the rug-defining detectors so the gate never buys blind", () => {
    // These are the signals that separate a memecoin from a scam; a buy must
    // not fire without them. Regression guard for the pre-trade gate.
    expect(gateNames).toEqual(
      expect.arrayContaining(["liquidity", "lp-security", "honeypot-sell", "taxes"]),
    );
  });

  it("covers the overwhelming majority of the total risk weight", () => {
    const total = defaultDetectors().reduce((sum, d) => sum + d.weight, 0);
    const gateWeight = gate.reduce((sum, d) => sum + d.weight, 0);
    expect(gateWeight / total).toBeGreaterThan(0.9);
  });
});

describe("liquidity detector", () => {
  it("scores by reference-token reserve tier", async () => {
    const deep = {
      readContract: vi.fn().mockResolvedValue(6n * 10n ** 18n),
    } as unknown as ShieldClient;
    await expect(liquidityDetector.detect(ctx({ client: deep }))).resolves.toMatchObject({
      score: 5,
    });
    const thin = {
      readContract: vi.fn().mockResolvedValue(3n * 10n ** 17n),
    } as unknown as ShieldClient;
    await expect(liquidityDetector.detect(ctx({ client: thin }))).resolves.toMatchObject({
      score: 60,
    });
  });

  it("is indeterminate without a pool", async () => {
    const client = { readContract: vi.fn() } as unknown as ShieldClient;
    const factor = await liquidityDetector.detect(ctx({ client, pool: undefined }));
    expect(factor.score).toBe(50);
  });
});

describe("lp-security detector", () => {
  it("rewards a burned/locked LP supply", async () => {
    const supply = 1_000n;
    const client = {
      readContract: vi.fn(
        async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
          if (functionName === "totalSupply") return supply;
          const holder = (args?.[0] as string)?.toLowerCase();
          return holder === "0x000000000000000000000000000000000000dead" ? 970n : 0n;
        },
      ),
    } as unknown as ShieldClient;
    const factor = await lpSecurityDetector.detect(ctx({ client }));
    expect(factor.score).toBe(5);
  });

  it("flags an unlocked LP supply as rug risk", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "totalSupply" ? 1_000n : 0n,
      ),
    } as unknown as ShieldClient;
    const factor = await lpSecurityDetector.detect(ctx({ client }));
    expect(factor.score).toBe(85);
  });

  it("reports V3 pools as not evaluable", async () => {
    const client = { readContract: vi.fn() } as unknown as ShieldClient;
    const factor = await lpSecurityDetector.detect(
      ctx({ client, pool: { ...v2Pool, dex: "uniswap-v3", feeTier: 3_000 } }),
    );
    expect(factor.detail).toMatch(/not applicable|not evaluable/);
  });
});

describe("ownership detector", () => {
  it("rewards a renounced owner", async () => {
    const client = {
      readContract: vi.fn().mockResolvedValue(ZERO),
      getCode: vi.fn(),
    } as unknown as ShieldClient;
    await expect(ownershipDetector.detect(ctx({ client }))).resolves.toMatchObject({ score: 5 });
  });

  it("distinguishes an EOA owner from a contract owner", async () => {
    const eoa = {
      readContract: vi.fn().mockResolvedValue(OWNER),
      getCode: vi.fn().mockResolvedValue("0x"),
    } as unknown as ShieldClient;
    await expect(ownershipDetector.detect(ctx({ client: eoa }))).resolves.toMatchObject({
      score: 45,
    });
    const contract = {
      readContract: vi.fn().mockResolvedValue(OWNER),
      getCode: vi.fn().mockResolvedValue("0x6080"),
    } as unknown as ShieldClient;
    await expect(ownershipDetector.detect(ctx({ client: contract }))).resolves.toMatchObject({
      score: 55,
    });
  });

  it("treats a missing owner() as likely ownerless", async () => {
    const client = {
      readContract: vi.fn().mockRejectedValue(new Error("no method")),
      getCode: vi.fn(),
    } as unknown as ShieldClient;
    const factor = await ownershipDetector.detect(ctx({ client }));
    expect(factor.score).toBe(20);
  });
});

describe("bytecode detectors", () => {
  const client = { readContract: vi.fn() } as unknown as ShieldClient;

  it("mint: flags a mint selector, clears without one", async () => {
    await expect(
      mintDetector.detect(ctx({ client, bytecode: codeWith("mint(address,uint256)") })),
    ).resolves.toMatchObject({ score: 70 });
    await expect(mintDetector.detect(ctx({ client }))).resolves.toMatchObject({ score: 10 });
  });

  it("pause-blacklist: flags a blacklist selector", async () => {
    await expect(
      pauseBlacklistDetector.detect(ctx({ client, bytecode: codeWith("blacklist(address)") })),
    ).resolves.toMatchObject({ score: 70 });
  });

  it("limits: flags a maxWallet selector", async () => {
    await expect(
      limitsDetector.detect(ctx({ client, bytecode: codeWith("maxWallet()") })),
    ).resolves.toMatchObject({ score: 70 });
  });
});

describe("proxy detector", () => {
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

  it("flags an EIP-1967 proxy from its implementation slot", async () => {
    const client = {
      getStorageAt: vi.fn(async ({ slot }: { slot: string }) =>
        slot === IMPL_SLOT
          ? "0x000000000000000000000000abcabcabcabcabcabcabcabcabcabcabcabcabca"
          : `0x${"0".repeat(64)}`,
      ),
    } as unknown as ShieldClient;
    await expect(proxyDetector.detect(ctx({ client }))).resolves.toMatchObject({ score: 60 });
  });

  it("falls back to a delegatecall tell, else clears", async () => {
    const empty = {
      getStorageAt: vi.fn(async () => `0x${"0".repeat(64)}`),
    } as unknown as ShieldClient;
    await expect(
      proxyDetector.detect(ctx({ client: empty, bytecode: "0x60806040" })),
    ).resolves.toMatchObject({ score: 10 });
    await expect(
      proxyDetector.detect(ctx({ client: empty, bytecode: "0x6080f460" })),
    ).resolves.toMatchObject({ score: 40 });
  });
});

describe("taxes detector", () => {
  it("reads a punitive tax rate when exposed", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "buyTax") return 40n;
        throw new Error("no");
      }),
    } as unknown as ShieldClient;
    const factor = await taxesDetector.detect(ctx({ client, bytecode: codeWith("buyTax()") }));
    expect(factor.score).toBe(90);
  });

  it("clears when no tax selector is present", async () => {
    const client = { readContract: vi.fn() } as unknown as ShieldClient;
    await expect(taxesDetector.detect(ctx({ client }))).resolves.toMatchObject({ score: 10 });
  });
});

describe("honeypot detector", () => {
  it("flags a token with no balance in its own pool", async () => {
    const client = { readContract: vi.fn().mockResolvedValue(0n) } as unknown as ShieldClient;
    const factor = await honeypotDetector.detect(ctx({ client }));
    expect(factor.score).toBe(55);
  });

  it("flags a reverting balanceOf", async () => {
    const client = {
      readContract: vi.fn().mockRejectedValue(new Error("revert")),
    } as unknown as ShieldClient;
    const factor = await honeypotDetector.detect(ctx({ client }));
    expect(factor.score).toBe(70);
  });
});

describe("supply-concentration detector", () => {
  it("rewards supply mostly held in the pool", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "totalSupply" ? 1_000n : 600n,
      ),
    } as unknown as ShieldClient;
    await expect(concentrationDetector.detect(ctx({ client }))).resolves.toMatchObject({
      score: 10,
    });
  });

  it("flags supply concentrated outside the pool", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "totalSupply" ? 1_000n : 50n,
      ),
    } as unknown as ShieldClient;
    await expect(concentrationDetector.detect(ctx({ client }))).resolves.toMatchObject({
      score: 70,
    });
  });
});

describe("token-shape detector", () => {
  it("rejects an address with no code", async () => {
    const client = { readContract: vi.fn() } as unknown as ShieldClient;
    const factor = await tokenShapeDetector.detect(ctx({ client, bytecode: "0x" }));
    expect(factor.score).toBe(100);
  });

  it("passes a well-formed ERC-20", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "totalSupply" ? 10n ** 24n : 18,
      ),
    } as unknown as ShieldClient;
    await expect(tokenShapeDetector.detect(ctx({ client }))).resolves.toMatchObject({ score: 5 });
  });

  it("flags a zero-supply token", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "totalSupply" ? 0n : 18,
      ),
    } as unknown as ShieldClient;
    const factor = await tokenShapeDetector.detect(ctx({ client }));
    expect(factor.score).toBe(75);
  });
});
