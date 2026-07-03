import { toAddress, type Pool } from "@bot/domain";
import { ValidationError } from "@bot/errors";
import { describe, expect, it, vi } from "vitest";
import { counterToken, nonZeroAddress, requirePool, sortTokens, type DexAdapter } from "./adapter";
import { PoolNotFoundError } from "./errors";

const A = toAddress("0x4200000000000000000000000000000000000006");
const B = toAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const POOL = toAddress("0x1111111111111111111111111111111111111111");

const pool: Pool = { chainId: 8453, address: POOL, dex: "uniswap-v2", token0: A, token1: B };

describe("sortTokens", () => {
  it("orders by address, lowest first", () => {
    expect(sortTokens(A, B)).toEqual([A, B]);
    expect(sortTokens(B, A)).toEqual([A, B]);
  });

  it("rejects identical tokens", () => {
    expect(() => sortTokens(A, A)).toThrow(ValidationError);
  });
});

describe("counterToken", () => {
  it("returns the other side of the pool", () => {
    expect(counterToken(pool, A)).toBe(B);
    expect(counterToken(pool, B)).toBe(A);
  });

  it("rejects a token that is not in the pool", () => {
    expect(() => counterToken(pool, POOL)).toThrow(ValidationError);
  });
});

describe("nonZeroAddress", () => {
  it("maps the zero address to undefined", () => {
    expect(nonZeroAddress("0x0000000000000000000000000000000000000000")).toBeUndefined();
    expect(nonZeroAddress("0x4200000000000000000000000000000000000006")).toBe(A);
  });
});

describe("requirePool", () => {
  it("returns the pool when it exists", async () => {
    const adapter = { dex: "uniswap-v2", getPool: vi.fn().mockResolvedValue(pool) };
    await expect(
      requirePool(adapter as unknown as DexAdapter, { tokenA: A, tokenB: B }),
    ).resolves.toBe(pool);
  });

  it("throws PoolNotFoundError (a DomainError) when it does not", async () => {
    const adapter = { dex: "uniswap-v2", getPool: vi.fn().mockResolvedValue(undefined) };
    await expect(
      requirePool(adapter as unknown as DexAdapter, { tokenA: A, tokenB: B }),
    ).rejects.toThrow(PoolNotFoundError);
  });
});
