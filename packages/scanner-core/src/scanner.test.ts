import { toAddress } from "@bot/domain";
import { InMemoryEventBus, type DomainEvent } from "@bot/events";
import { createLogger } from "@bot/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryScanState } from "./in-memory";
import type { ScannerClient } from "./ports";
import { Scanner, type ScannerOptions } from "./scanner";
import { defaultVenueSources, type VenueSource } from "./sources";

const silent = createLogger({ destination: { write: () => {} } });

const WETH = toAddress("0x4200000000000000000000000000000000000006");
const MEME = toAddress("0x9999999999999999999999999999999999999999");
const OTHER = toAddress("0x8888888888888888888888888888888888888888");
const POOL = toAddress("0x1111111111111111111111111111111111111111");

type FakeLog = { args: Record<string, unknown> };

const wethMemeLog: FakeLog = { args: { token0: WETH, token1: MEME, pair: POOL } };

interface HarnessOptions {
  head?: bigint;
  logs?: (fromBlock: bigint, toBlock: bigint) => FakeLog[];
  balance?: bigint;
  metadata?: "ok" | "broken";
  scanner?: Partial<ScannerOptions>;
  state?: InMemoryScanState;
}

function harness(options: HarnessOptions = {}) {
  const head = { value: options.head ?? 101n };
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const logs = options.logs ?? (() => []);

  const readContract = async (call: {
    abi: readonly { outputs: readonly { type: string }[] }[];
    functionName: string;
  }): Promise<unknown> => {
    const output = call.abi[0]?.outputs[0]?.type;
    if (call.functionName === "balanceOf") {
      return options.balance ?? 10n ** 18n;
    }
    if (options.metadata === "broken") {
      if (call.functionName === "symbol" && output === "bytes32") {
        return `0x${Buffer.from("MEME").toString("hex").padEnd(64, "0")}`;
      }
      throw new Error("execution reverted");
    }
    if (call.functionName === "symbol") return "MEME";
    if (call.functionName === "name") return "Meme Coin";
    if (call.functionName === "decimals") return 18;
    throw new Error(`unexpected read: ${call.functionName}`);
  };

  const client = {
    getBlockNumber: vi.fn(async () => head.value),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ fromBlock, toBlock });
      return logs(fromBlock, toBlock);
    }),
    readContract: vi.fn(readContract),
  } as unknown as ScannerClient;

  const bus = new InMemoryEventBus({ logger: silent });
  const published: DomainEvent[] = [];
  const state = options.state ?? new InMemoryScanState();
  const v2 = defaultVenueSources().find((source) => source.dex === "uniswap-v2") as VenueSource;

  const scanner = new Scanner({
    client,
    bus,
    cursors: state,
    seen: state,
    sources: [v2],
    logger: silent,
    confirmations: 0,
    ...options.scanner,
  });

  const ready = Promise.all([
    bus.subscribe("pool.created", (event) => void published.push(event), { group: "test" }),
    bus.subscribe("token.detected", (event) => void published.push(event), { group: "test" }),
  ]);

  return { scanner, client, state, head, ranges, published, ready };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Scanner", () => {
  it("publishes pool.created and a correlated token.detected for a new pool", async () => {
    const { scanner, state, published, ready } = harness({
      logs: () => [wethMemeLog],
    });
    await ready;
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();

    expect(published.map((event) => event.type)).toEqual(["pool.created", "token.detected"]);
    const [poolEvent, tokenEvent] = published;
    expect(poolEvent?.payload).toMatchObject({
      pool: { dex: "uniswap-v2", address: POOL, token0: WETH, token1: MEME },
    });
    expect(tokenEvent?.payload).toMatchObject({
      token: { address: MEME, symbol: "MEME", name: "Meme Coin", decimals: 18 },
    });
    expect(tokenEvent?.correlationId).toBe(poolEvent?.correlationId);
    expect(poolEvent?.source).toBe("scanner");
    await expect(state.get("uniswap-v2")).resolves.toBe(101n);
    expect(scanner.stats()).toMatchObject({ poolsSeen: 1, poolsPublished: 1 });
  });

  it("initializes the cursor at the head on first run, publishing nothing", async () => {
    const { scanner, client, state, published } = harness({ head: 500n });
    await scanner.tickOnce();
    await expect(state.get("uniswap-v2")).resolves.toBe(500n);
    expect(client.getLogs).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it("dedupes a pool replayed across ranges", async () => {
    const { scanner, state, published, ready } = harness({ logs: () => [wethMemeLog] });
    await ready;
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();
    // Force a replay of the same range (as a reorg/crash recovery would).
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();
    expect(published).toHaveLength(2);
    expect(scanner.stats().poolsPublished).toBe(1);
  });

  it("paginates by maxBlockRange and chews through the backlog", async () => {
    const { scanner, state, ranges } = harness({
      head: 5_000n,
      scanner: { maxBlockRange: 1_000 },
    });
    await state.set("uniswap-v2", 0n);
    await scanner.tickOnce();
    await scanner.tickOnce();
    expect(ranges).toEqual([
      { fromBlock: 1n, toBlock: 1_000n },
      { fromBlock: 1_001n, toBlock: 2_000n },
    ]);
  });

  it("resumes from the persisted cursor after a restart", async () => {
    const state = new InMemoryScanState();
    const first = harness({ state, head: 200n });
    await first.scanner.tickOnce(); // initializes at 200
    const second = harness({ state, head: 260n });
    await second.scanner.tickOnce();
    expect(second.ranges).toEqual([{ fromBlock: 201n, toBlock: 260n }]);
  });

  it("silently skips pools without a reference token, once", async () => {
    const irrelevant: FakeLog = { args: { token0: OTHER, token1: MEME, pair: POOL } };
    const { scanner, state, published, client } = harness({ logs: () => [irrelevant] });
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();
    expect(published).toHaveLength(0);
    await expect(state.has(POOL)).resolves.toBe(true);
    // No metadata reads for noise.
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("publishes everything when the quote filter is disabled", async () => {
    const irrelevant: FakeLog = { args: { token0: OTHER, token1: MEME, pair: POOL } };
    const { scanner, state, published, ready } = harness({
      logs: () => [irrelevant],
      scanner: { quoteTokens: [] },
    });
    await ready;
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();
    expect(published.map((event) => event.type)).toEqual(["pool.created", "token.detected"]);
  });

  it("survives broken token metadata with fallbacks", async () => {
    const { scanner, state, published, ready } = harness({
      logs: () => [wethMemeLog],
      metadata: "broken",
    });
    await ready;
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();
    const tokenEvent = published.find((event) => event.type === "token.detected");
    expect(tokenEvent?.payload).toMatchObject({
      token: { symbol: "MEME", name: "", decimals: 18 },
    });
  });

  it("applies the optional minimum-liquidity filter without marking seen", async () => {
    const { scanner, state, published } = harness({
      logs: () => [wethMemeLog],
      balance: 1n,
      scanner: { minQuoteLiquidity: 10n },
    });
    await state.set("uniswap-v2", 99n);
    await scanner.tickOnce();
    expect(published).toHaveLength(0);
    await expect(state.has(POOL)).resolves.toBe(false);
  });

  it("start()/stop() drive the polling loop", async () => {
    vi.useFakeTimers();
    const { scanner, client } = harness({ scanner: { pollIntervalMs: 1_000 } });
    scanner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(3);
    scanner.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(3);
  });

  it("backs off on RPC errors and recovers", async () => {
    vi.useFakeTimers();
    const { scanner, client } = harness({ scanner: { pollIntervalMs: 1_000 } });
    (client.getBlockNumber as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("all endpoints down"),
    );
    scanner.start();
    await vi.advanceTimersByTimeAsync(0); // first tick fails
    expect(scanner.stats().errors).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000); // backoff (2×1000) elapses, retry succeeds
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
    scanner.stop();
  });
});
