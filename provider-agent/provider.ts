// ============================================================
// A.T.L.A.S. — Agente PROVEEDOR (Provider Agent)
// ============================================================
// ============================================================

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { createProviderWallet, getUsdtAddress } from "./wallet.ts";
import {
    sleep,
    pollUntil,
    AtlasWallet,
} from "../shared/atlas-wallet.ts";
import type {
    Marketplace,
    ServiceListing,
    InvoiceRequest,
    Invoice,
    Settlement,
    Fulfillment,
} from "../shared/protocol.ts";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MARKETPLACE_PATH = path.join(ROOT, "marketplace.json");
const INVOICE_REQ_PATH = path.join(ROOT, "invoice_request.json");
const INVOICE_PATH = path.join(ROOT, "invoice.json");
const SETTLEMENT_PATH = path.join(ROOT, "settlement.json");
const FULFILLMENT_PATH = path.join(ROOT, "fulfillment.json");

const SERVICE_ID = "xaut-data-001";
const SERVICE_PRICE_RAW = "100000"; // 0.10 USDt
const SERVICE_PRICE_USDT = "0.10";

// ── UTILIDADES ────────────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch { return null; }
}

function writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function fetchXautMarketData(): Promise<any> {
    try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true");
        const json: any = await res.json();
        return {
            price: json["tether-gold"].usd,
            change: json["tether-gold"].usd_24h_change
        };
    } catch {
        return { price: 2750.0, change: 0.1 };
    }
}

// ── FASES ─────────────────────────────────────────────────────

function registerService(address: string) {
    console.log("📋 FASE 1: REGISTRO");
    const m: Marketplace = readJson<Marketplace>(MARKETPLACE_PATH) || { version: "1.0", services: [], last_updated: Date.now() };
    const s: ServiceListing = {
        id: SERVICE_ID,
        name: "XAU₮ Financial Feed",
        description: "Datos reales de Tether Gold vía CoinGecko.",
        provider_address: address,
        price_usdt: SERVICE_PRICE_USDT,
        price_raw: SERVICE_PRICE_RAW,
        tags: ["gold", "finance"],
        registered_at: Date.now()
    };
    const i = m.services.findIndex(x => x.id === SERVICE_ID);
    if (i >= 0) m.services[i] = s; else m.services.push(s);
    writeJson(MARKETPLACE_PATH, m);
    console.log("✅ Servicio publicado.");
}

async function waitForInvoice(providerAddr: string, usdtAddr: string) {
    console.log("📩 FASE 2: INVOICE — Esperando pedido...");
    
    // Limpieza
    [INVOICE_REQ_PATH, INVOICE_PATH, SETTLEMENT_PATH, FULFILLMENT_PATH].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

    const req = await pollUntil<InvoiceRequest>(async () => readJson<InvoiceRequest>(INVOICE_REQ_PATH), 3000, 300000);
    const inv: Invoice = {
        service_id: req.service_id,
        provider_address: providerAddr,
        client_address: req.client_address,
        amount_raw: SERVICE_PRICE_RAW,
        token_address: usdtAddr,
        expires_at: Date.now() + 900000,
        timestamp: Date.now()
    };
    writeJson(INVOICE_PATH, inv);
    console.log("✅ Factura enviada.");
}

async function verifyPayment(wallet: AtlasWallet) {
    console.log("🔍 FASE 3: VERIFICACIÓN");
    const set = await pollUntil<Settlement>(async () => readJson<Settlement>(SETTLEMENT_PATH), 3000, 300000);
    console.log(`💳 TX recibida: ${set.tx_hash}. Esperando confirmación on-chain...`);
    
    const receipt = await wallet.waitForReceipt(set.tx_hash, 50);
    if (!receipt || receipt.status !== 1) throw new Error("Pago no verificado.");
    
    console.log("✅ PAGO CONFIRMADO ON-CHAIN.");
    return set;
}

async function splitService(wallet: AtlasWallet, usdtAddr: string) {
    const treasury = process.env.TREASURY_ADDRESS || "";
    if (!treasury) return;
    const tax = BigInt(SERVICE_PRICE_RAW) / 10n; // 10% comision Erika
    console.log(`💸 Split automático: Enviando ${wallet.formatUsdt(tax)} USDt a tesorería...`);
    try {
        await wallet.sendUsdt(treasury, tax, usdtAddr);
        console.log("✅ Regalías enviadas.");
    } catch (e: any) {
        console.log(`⚠️ Fallo royalty: ${e.message}`);
    }
}

async function deliver(set: Settlement) {
    const m = await fetchXautMarketData();
    const ful: Fulfillment = {
        service_id: set.service_id,
        status: "delivered",
        data: { price: m.price, change: m.change, ts: new Date().toISOString() },
        message: "Fulfillment completed.",
        timestamp: Date.now()
    };
    writeJson(FULFILLMENT_PATH, ful);
    console.log("🏆 SERVICIO ENTREGADO.");
}

// ── MAIN ──────────────────────────────────────────────────────

async function main() {
    console.log("🤖 A.T.L.A.S. PROVIDER — READY");
    const wallet = createProviderWallet();
    await wallet.init();
    const addr = await wallet.getAddress();
    const usdt = getUsdtAddress();

    while (true) {
        try {
            registerService(addr);
            await waitForInvoice(addr, usdt);
            const set = await verifyPayment(wallet);
            await splitService(wallet, usdt);
            await deliver(set);
            console.log("\n🎊 Ciclo completado. Reiniciando...\n");
        } catch (e: any) {
            console.log(`❌ Error: ${e.message}`);
            await sleep(5000);
        }
    }
}

main().catch(console.error);
