// ============================================================
// A.T.L.A.S. — AtlasWallet
// Clase base de billetera con soporte ERC-4337 (Smart Accounts)
// ============================================================

import WDK from "@tetherto/wdk";
import WalletManagerEvmErc4337 from "@tetherto/wdk-wallet-evm-erc-4337";

// USDT tiene 6 decimales
const USDT_DECIMALS = 6n;
const USDT_DIVISOR = 10n ** USDT_DECIMALS; // 1_000_000n

const POLL_INTERVAL_MS = 5_000;
const RECEIPT_POLL_INTERVAL_MS = 8_000;

// Configuración recomendada para Sepolia con Paymaster Pimlico
const ER4337_SEPOLIA_CONFIG = {
  chainId: 11155111,
  provider: 'https://sepolia.drpc.org',
  bundlerUrl: 'https://public.pimlico.io/v2/11155111/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/11155111/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xd077a400968890eacc75cdc901f0356c943e4fdb' // USDT Sepolia ERC-4337 testnet
  }, 
  transferMaxFee: 100000 // 0.1 USDT
};

export class AtlasWallet {
  private wdk: InstanceType<typeof WDK>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private account: any | null = null;

  /**
   * @param seed  - Frase semilla BIP-39
   */
  constructor(seed: string) {
    if (!seed || seed.trim().split(" ").length < 12) {
      throw new Error(
        "❌ Semilla inválida. Debe ser una frase BIP-39 de al menos 12 palabras."
      );
    }
    
    // Registramos el Wallet manager ERC-4337 con WDK
    this.wdk = new WDK(seed.trim()).registerWallet(
      "ethereum",
      WalletManagerEvmErc4337,
      ER4337_SEPOLIA_CONFIG
    );
  }

  /**
   * Inicializa la cuenta Smart Account (ERC-4337).
   */
  async init(): Promise<void> {
    this.account = await this.wdk.getAccount("ethereum");
  }

  private ensureInit(): void {
    if (!this.account) {
      throw new Error("❌ Wallet no inicializada. Llama a init() primero.");
    }
  }

  /**
   * Devuelve la dirección del Smart Contract (Wallet Account).
   */
  async getAddress(): Promise<string> {
    this.ensureInit();
    return await this.account.getAddress();
  }

  async getEthBalance(): Promise<string> {
    this.ensureInit();
    const balanceWei: bigint = await this.account.getBalance();
    const whole = balanceWei / (10n ** 18n);
    const fraction = (balanceWei % (10n ** 18n)) / (10n ** 14n);
    return `${whole}.${fraction.toString().padStart(4, "0")} ETH`;
  }

  async getUsdtBalance(tokenAddress: string): Promise<string> {
    this.ensureInit();
    const rawBalance: bigint = await this.account.getTokenBalance(tokenAddress);
    const whole = rawBalance / USDT_DIVISOR;
    const fraction = rawBalance % USDT_DIVISOR;
    return `${whole}.${fraction.toString().padStart(6, "0")} USDt`;
  }

  async getUsdtBalanceRaw(tokenAddress: string): Promise<bigint> {
    this.ensureInit();
    return await this.account.getTokenBalance(tokenAddress);
  }

  async sendUsdt(
    recipient: string,
    amountRaw: bigint,
    tokenAddress: string
  ): Promise<string> {
    this.ensureInit();

    console.log(
      `\n💸 Enviando ${this.formatUsdt(amountRaw)} USDt a ${recipient} usando Account Abstraction...`
    );

    const result = await this.account.transfer({
      token: tokenAddress,
      recipient,
      amount: amountRaw,
    });

    const { hash } = result;
    console.log(`✅ UserOperation/Transacción enviada!`);
    console.log(`   TX Hash: ${hash}`);

    return hash as string;
  }

  async waitForReceipt(
    hash: string,
    maxAttempts = 30
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    this.ensureInit();
    console.log(`\n⏳ Esperando confirmación on-chain para ${hash}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const receipt = await this.account.getTransactionReceipt(hash);

      if (receipt) {
        console.log(
          `✅ Confirmada en bloque #${receipt.blockNumber} (intento ${attempt}/${maxAttempts})`
        );
        return receipt;
      }

      process.stdout.write(
        `   Intento ${attempt}/${maxAttempts} — pendiente...\r`
      );
      await sleep(RECEIPT_POLL_INTERVAL_MS);
    }

    throw new Error(
      `❌ Timeout: La transacción ${hash} no fue confirmada tras ${maxAttempts} intentos.`
    );
  }

  formatUsdt(raw: bigint): string {
    const whole = raw / USDT_DIVISOR;
    const fraction = raw % USDT_DIVISOR;
    return `${whole}.${fraction.toString().padStart(6, "0")}`;
  }

  dispose(): void {
    if (this.wdk) this.wdk.dispose();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number = POLL_INTERVAL_MS,
  timeoutMs: number = 300_000 // 5 minutos
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error(`❌ Timeout: La condición no se cumplió en ${timeoutMs / 1000}s.`);
}
