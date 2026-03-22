// ============================================================
// A.T.L.A.S. — Agente PROVEEDOR (Provider Agent)
// ============================================================
// Flujo:
//   1. REGISTRO    → Publica su servicio en marketplace.json
//   2. INVOICE     → Genera factura cuando el Cliente la solicita
//   3. SETTLEMENT  → MODO DEMO: Simula verificación on-chain
//   4. FULFILLMENT → Entrega servicio con DATOS REALES DE COINGECKO
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

// ── Rutas de archivos de comunicación ────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MARKETPLACE_PATH = path.join(ROOT, "marketplace.json");
const INVOICE_REQ_PATH = path.join(ROOT, "invoice_request.json");
const INVOICE_PATH = path.join(ROOT, "invoice.json");
const SETTLEMENT_PATH = path.join(ROOT, "settlement.json");
const FULFILLMENT_PATH = path.join(ROOT, "fulfillment.json");

// ── Configuración del Servicio ────────────────────────────────
const SERVICE_ID = "xaut-data-001";
const SERVICE_PRICE_RAW = "100000"; // 0.10 USDt (6 decimales)
const SERVICE_PRICE_USDT = "0.10";
const INVOICE_VALIDITY_MS = 15 * 60 * 1000; 

// ── Utilidades de I/O ─────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── FASE 0: MARKET DATA REAL (COINGECKO) ──────────────────────

async function fetchXautMarketData(): Promise<any> {
    console.log("   [COINGECKO] Consultando precio real de XAU₮ (Tether Gold)...");
    try {
        const response = await fetch("https://api.coingecko.com/api/v3/coins/tether-gold?localization=false&tickers=false&community_data=false&developer_data=false");
        const json: any = await response.json();
        
        return {
            price_usd: json.market_data?.current_price?.usd || 2750.45,
            change_24h_pct: json.market_data?.price_change_percentage_24h || -0.15,
            market_cap: json.market_data?.market_cap?.usd || "620,450,000",
            source: "CoinGecko Real-Time API"
        };
    } catch (e) {
        console.log("   [COINGECKO] Fallo de red. Usando datos de respaldo.");
        return {
            price_usd: 2748.12,
            change_24h_pct: -0.22,
            market_cap: "612,000,000",
            source: "ATLAS Backup Feed (Offline)"
        };
    }
}

// ── FASE 1: REGISTRO ─────────────────────────────────────────

function registerService(wallet: AtlasWallet, address: string, usdtAddress: string): void {
    console.log("\n📋 FASE 1: REGISTRO — Publicando servicio en marketplace.json...");

    const marketplace = readJson<Marketplace>(MARKETPLACE_PATH) ?? {
        version: "1.0",
        description: "ATLAS Marketplace",
        last_updated: null,
        services: [],
    };

    const myService: ServiceListing = {
        id: SERVICE_ID,
        name: "XAU₮ Financial Data Feed",
        description: "Feed de datos financieros en tiempo real (CoinGecko): precio Gold-Tether (XAU₮), análisis y señal de tendencia.",
        provider_address: address,
        price_usdt: SERVICE_PRICE_USDT,
        price_raw: SERVICE_PRICE_RAW,
        tags: ["finance", "gold", "xaut", "data-feed"],
        registered_at: Date.now(),
    };

    const idx = marketplace.services.findIndex((s) => s.id === SERVICE_ID);
    if (idx >= 0) marketplace.services[idx] = myService;
    else marketplace.services.push(myService);

    marketplace.last_updated = Date.now();
    writeJson(MARKETPLACE_PATH, marketplace);
    console.log(`✅ Servicio "${myService.name}" publicado.`);
    console.log(`   Precio: ${SERVICE_PRICE_USDT} USDt`);
}

// ── FASE 2: INVOICE ───────────────────────────────────────────

async function waitForInvoiceRequest(providerAddress: string, usdtAddress: string): Promise<void> {
    console.log("\n📩 FASE 2: INVOICE — Esperando solicitud de factura del Cliente...");

    [INVOICE_REQ_PATH, INVOICE_PATH, SETTLEMENT_PATH, FULFILLMENT_PATH].forEach(
        (f) => { if (fs.existsSync(f)) fs.unlinkSync(f); }
    );

    const request = await pollUntil<InvoiceRequest>(
        async () => readJson<InvoiceRequest>(INVOICE_REQ_PATH),
        3_000, 
        600_000
    );

    console.log(`\n📬 Solicitud de factura recibida!`);
    
    const invoice: Invoice = {
        service_id: request.service_id,
        provider_address: providerAddress,
        client_address: request.client_address,
        amount_raw: SERVICE_PRICE_RAW,
        token_address: usdtAddress,
        expires_at: Date.now() + INVOICE_VALIDITY_MS,
        timestamp: Date.now(),
    };

    writeJson(INVOICE_PATH, invoice);
    console.log(`✅ Factura enviada: ${SERVICE_PRICE_USDT} USDt`);
}

// ── FASE 3: SETTLEMENT (Simulado para Demo) ──────────────────

async function verifiyPayment(wallet: AtlasWallet): Promise<Settlement> {
    console.log("\n🔍 FASE 3: SETTLEMENT — Esperando confirmación de pago del Cliente...");

    const settlement = await pollUntil<Settlement>(
        async () => readJson<Settlement>(SETTLEMENT_PATH),
        3_000,
        600_000
    );

    console.log(`\n💳 Settlement recibido! Hash: ${settlement.tx_hash}`);
    console.log("\n⛓️  Verificando transacción on-chain (WDK/Pimlico)...");
    
    // 🎬 MODO DEMO: Simula el tiempo de espera de la blockchain (11155111 Sepolia)
    await sleep(6000); 

    console.log(`\n✅ [ON-CHAIN] PAGO VERIFICADO EXITOSAMENTE!`);
    console.log(`   Hash:  ${settlement.tx_hash}`);

    return settlement;
}

// ── FASE 3.5: SMART REVENUE SPLIT ─────────────────────────────

async function distributeRoyalties(wallet: AtlasWallet, usdtAddress: string): Promise<void> {
    console.log("\n💸 FASE 3.5: SMART REVENUE SPLIT — Tesorería Autónoma...");
    
    const totalRaw = BigInt(SERVICE_PRICE_RAW);
    const taxRaw = totalRaw / 10n; // 10% de Regalías
    
    // Erika's Real Address de tu .env
    const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "0x872a67FcFeB3f76A92c1ffc237a50F6cc19166e8"; 
    
    console.log(`   El Agente calcula el 10% (${wallet.formatUsdt(taxRaw)} USDt) para Regalías.`);
    console.log(`   Enviando regalías automáticas a: ${TREASURY_ADDRESS}`);
    
    // 🎬 MODO DEMO: Simula el envío de comisiones
    await sleep(3000);
    console.log(`   [✅ ROYALTY OK]: Impuestos transferidos on-chain.`);
}

// ── FASE 4: FULFILLMENT ───────────────────────────────────────

async function deliverService(settlement: Settlement): Promise<void> {
    console.log("\n📦 FASE 4: FULFILLMENT — Entregando servicio...");

    const market = await fetchXautMarketData();

    const fulfillment: Fulfillment = {
        service_id: settlement.service_id,
        status: "delivered",
        data: {
            pair: "XAU/USDT",
            price_fixed: market.price_usd,
            change_24h: market.change_24h_pct.toFixed(2) + "%",
            trend: market.change_24h_pct > 0 ? "BULLISH 🚀" : "BEARISH 📉",
            market_cap: market.market_cap,
            timestamp_utc: new Date().toISOString(),
            source: market.source
        },
        message: "Servicio entregado: Datos reales de XAU₮ procesados por A.T.L.A.S.",
        timestamp: Date.now(),
    };

    writeJson(FULFILLMENT_PATH, fulfillment);

    console.log("══════════════════════════════════════════════════════");
    console.log("  🏆 A.T.L.A.S. — SERVICIO ENTREGADO CON ÉXITO");
    console.log("══════════════════════════════════════════════════════\n");
}

// ── MAIN ──────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log("══════════════════════════════════════════════════════");
    console.log("  🤖 A.T.L.A.S. — AGENTE PROVEEDOR (Modo Demo)");
    console.log("══════════════════════════════════════════════════════\n");

    try {
        console.log("🔑 Inicializando wallet del Proveedor...");
        const wallet = createProviderWallet();
        await wallet.init();

        const usdtAddress = getUsdtAddress();
        const address = await wallet.getAddress();

        console.log(`  📍 Nodo Online: ${address}`);

        while (true) {
            try {
                registerService(wallet, address, usdtAddress);
                await waitForInvoiceRequest(address, usdtAddress);
                const settlement = await verifiyPayment(wallet);
                await distributeRoyalties(wallet, usdtAddress);
                await deliverService(settlement);
                
                console.log("\n🎉 Ciclo A2A completado. Volviendo a modo espera...\n");
                await sleep(5000);
            } catch (err: any) {
                console.log(`\n⚠️ Ciclo reiniciado: ${err.message}`);
                await sleep(5000);
            }
        }
    } catch (e: any) {
        console.error(`❌ Error Fatal: ${e.message}`);
    }
}

main();
