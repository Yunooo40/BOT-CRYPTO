import { loadEnv } from "@bot/config";
import { DrizzleWalletRepository, WalletService } from "@bot/wallet-core";

/**
 * One-off operator tool: generate a fresh wallet via the Wallet Service and
 * print its public address so it can be funded. The private key never leaves
 * `WalletService` — this script never sees or prints it.
 *
 * Usage: pnpm --filter @bot/worker exec tsx scripts/create-wallet.ts <label>
 */
async function main(): Promise<void> {
  const label = process.argv[2];
  if (label === undefined || label.trim().length === 0) {
    console.error("Usage: tsx scripts/create-wallet.ts <label>");
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  if (env.WALLET_MASTER_KEY === undefined) {
    console.error("WALLET_MASTER_KEY must be set in the environment.");
    process.exitCode = 1;
    return;
  }

  const { repository, close } = DrizzleWalletRepository.connect(env.DATABASE_URL);
  try {
    const service = new WalletService({ repository, masterKey: env.WALLET_MASTER_KEY });
    const wallet = await service.createWallet(label);
    console.log(`Wallet id:      ${wallet.id}`);
    console.log(`Wallet address: ${wallet.address}`);
    console.log("\nFund this address, then set WORKER_WALLET_ID to the id above.");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
