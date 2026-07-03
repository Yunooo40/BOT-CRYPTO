import { ValidationError } from "@bot/errors";
import { describe, expect, it } from "vitest";
import { parseRpcEndpoints, rpcEndpointsFromEnv } from "./config";

describe("parseRpcEndpoints", () => {
  it("parses a single URL with default weight", () => {
    expect(parseRpcEndpoints("https://mainnet.base.org")).toEqual([
      { url: "https://mainnet.base.org", weight: 1 },
    ]);
  });

  it("parses weight and wsUrl segments", () => {
    expect(parseRpcEndpoints("https://node.example|3|wss://node.example")).toEqual([
      { url: "https://node.example", weight: 3, wsUrl: "wss://node.example" },
    ]);
  });

  it("parses several entries and tolerates whitespace", () => {
    const endpoints = parseRpcEndpoints(" https://a.example , https://b.example|2 ");
    expect(endpoints.map((endpoint) => endpoint.url)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(endpoints[1]?.weight).toBe(2);
  });

  it("rejects an empty list", () => {
    expect(() => parseRpcEndpoints("  ,  ")).toThrow(ValidationError);
  });

  it("rejects a non-http(s) endpoint URL", () => {
    expect(() => parseRpcEndpoints("wss://node.example")).toThrow(ValidationError);
  });

  it("rejects a malformed weight", () => {
    expect(() => parseRpcEndpoints("https://a.example|heavy")).toThrow(ValidationError);
    expect(() => parseRpcEndpoints("https://a.example|0")).toThrow(ValidationError);
  });

  it("rejects a non-ws(s) wsUrl", () => {
    expect(() => parseRpcEndpoints("https://a.example|1|https://a.example")).toThrow(
      ValidationError,
    );
  });

  it("rejects duplicate endpoint URLs", () => {
    expect(() => parseRpcEndpoints("https://a.example,https://a.example|2")).toThrow(/duplicate/);
  });

  it("reports every invalid entry at once", () => {
    let caught: unknown;
    try {
      parseRpcEndpoints("not-a-url,https://ok.example,ftp://nope.example");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).toMatch(/entry 1/);
    expect((caught as ValidationError).message).toMatch(/entry 3/);
  });
});

describe("rpcEndpointsFromEnv", () => {
  it("reads BASE_RPC_URLS from a validated env slice", () => {
    const endpoints = rpcEndpointsFromEnv({ BASE_RPC_URLS: "https://mainnet.base.org|2" });
    expect(endpoints).toEqual([{ url: "https://mainnet.base.org", weight: 2 }]);
  });
});
