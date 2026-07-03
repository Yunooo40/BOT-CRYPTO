import { HttpRequestError, InternalRpcError, InvalidParamsRpcError, RpcRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { isEndpointFailure } from "./classify";

const url = "https://node.example";

function rpcRequestError(code: number, message: string) {
  return new RpcRequestError({ body: {}, error: { code, message }, url });
}

describe("isEndpointFailure", () => {
  it("condemns network-level failures", () => {
    expect(isEndpointFailure(new Error("ECONNREFUSED"))).toBe(true);
    expect(isEndpointFailure(new HttpRequestError({ url, details: "socket hang up" }))).toBe(true);
  });

  it("condemns node faults reported over JSON-RPC", () => {
    expect(isEndpointFailure(rpcRequestError(-32603, "internal error"))).toBe(true);
    expect(isEndpointFailure(rpcRequestError(-32005, "limit exceeded"))).toBe(true);
    expect(isEndpointFailure(new InternalRpcError(new Error("boom")))).toBe(true);
  });

  it("passes application-level JSON-RPC errors through", () => {
    expect(isEndpointFailure(rpcRequestError(3, "execution reverted"))).toBe(false);
    expect(isEndpointFailure(new InvalidParamsRpcError(new Error("bad params")))).toBe(false);
  });
});
