import { toFunctionSelector } from "viem";

/**
 * Heuristic bytecode scan: does the deployed code contain the 4-byte selector
 * of any of these function signatures? A present selector is strong evidence
 * the function exists; its absence is weaker (a proxy or obfuscated contract
 * can hide it), which is why these detectors score suspicion, not certainty.
 */
export function hasAnySelector(bytecode: string, signatures: readonly string[]): string[] {
  const code = bytecode.toLowerCase();
  const found: string[] = [];
  for (const signature of signatures) {
    const selector = toFunctionSelector(signature).slice(2).toLowerCase();
    if (code.includes(selector)) {
      found.push(signature);
    }
  }
  return found;
}

/** `delegatecall` opcode (0xf4) — a cheap proxy tell alongside the EIP-1967 slot. */
export function hasDelegateCall(bytecode: string): boolean {
  return bytecode.toLowerCase().includes("f4");
}

export const MINT_SIGNATURES = [
  "mint(address,uint256)",
  "mint(uint256)",
  "_mint(address,uint256)",
] as const;

export const PAUSE_BLACKLIST_SIGNATURES = [
  "pause()",
  "unpause()",
  "setPaused(bool)",
  "blacklist(address)",
  "setBlacklist(address,bool)",
  "addBlacklist(address)",
  "setBots(address,bool)",
  "freeze(address)",
] as const;

export const LIMIT_SIGNATURES = [
  "maxTxAmount()",
  "maxTransactionAmount()",
  "maxWallet()",
  "maxWalletAmount()",
  "setMaxTxAmount(uint256)",
  "setMaxWallet(uint256)",
] as const;

export const TAX_SIGNATURES = [
  "buyTax()",
  "sellTax()",
  "totalFees()",
  "setFees(uint256,uint256)",
  "setTaxes(uint256,uint256)",
  "_taxFee()",
] as const;
