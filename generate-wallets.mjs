// Genera dos Smart Accounts (ERC-4337) completas para ATLAS y muestra sus direcciones
import WDK from "@tetherto/wdk";
import WalletManagerEvmErc4337 from "@tetherto/wdk-wallet-evm-erc-4337";

const ER4337_SEPOLIA_CONFIG = {
  chainId: 11155111,
  provider: 'https://sepolia.drpc.org',
  bundlerUrl: 'https://public.pimlico.io/v2/11155111/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/11155111/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xd077a400968890eacc75cdc901f0356c943e4fdb'
  }, 
  transferMaxFee: 100000 
};

async function generateWallet(label, seed) {
  const wdk = new WDK(seed).registerWallet("ethereum", WalletManagerEvmErc4337, ER4337_SEPOLIA_CONFIG);
  const account = await wdk.getAccount("ethereum");
  const address = await account.getAddress();
  wdk.dispose();
  return { label, seed, address };
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  🔑 A.T.L.A.S. — Generador de Smart Accounts ERC-4337");
  console.log("══════════════════════════════════════════════════════\n");

  const clientSeed   = WDK.getRandomSeedPhrase();
  const providerSeed = WDK.getRandomSeedPhrase();

  console.log("⏳ Derivando direcciones de Smart Contracts (Safe)...\n");

  const client   = await generateWallet("CLIENTE",   clientSeed);
  const provider = await generateWallet("PROVEEDOR", providerSeed);

  console.log("══════════════════════════════════════════════════════");
  console.log("  SMART ACCOUNT DEL CLIENTE");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  📍 Dirección (Safe): ${client.address}`);
  console.log(`  🔑 Semilla EOA:      ${client.seed}`);

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  SMART ACCOUNT DEL PROVEEDOR");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  📍 Dirección (Safe): ${provider.address}`);
  console.log(`  🔑 Semilla EOA:      ${provider.seed}`);

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  📋 COPIA ESTO EN TU ARCHIVO .env");
  console.log("══════════════════════════════════════════════════════\n");
  console.log(`CLIENT_SEED="${client.seed}"`);
  console.log(`PROVIDER_SEED="${provider.seed}"`);

  console.log("\n⚠️ ATENCIÓN: Al cambiar a ERC-4337, tus direcciones cambiaron a Smart Accounts.");
  console.log("Debes fondear la nueva dirección del cliente con el USDT mock de Sepolia.");
}

main().catch(console.error);
