/** Minimal read ABIs shared by the detectors. */

export const erc20Abi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ownerAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const getOwnerAbi = [
  {
    type: "function",
    name: "getOwner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const uintGetterAbi = (name: string) =>
  [
    { type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;
