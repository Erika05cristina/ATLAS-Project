// ============================================================
// A.T.L.A.S. — Client Wallet
// Inicializa AtlasWallet con la semilla del Cliente desde .env
// ============================================================

import "dotenv/config";
import { AtlasWallet } from "../shared/atlas-wallet.ts";

function getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value || value.includes("word1")) {
        throw new Error(
            `❌ Variable de entorno "${key}" no configurada. ` +
            `Edita el archivo .env con tu frase semilla real.`
        );
    }
    return value;
}

export function createClientWallet(): AtlasWallet {
    const seed = getRequiredEnv("CLIENT_SEED");
    return new AtlasWallet(seed);
}

export function getUsdtAddress(): string {
    // USDT ERC-4337 Sepolia testnet address from docs
    return "0xd077a400968890eacc75cdc901f0356c943e4fdb";
}
