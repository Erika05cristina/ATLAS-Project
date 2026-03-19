// ============================================================
// A.T.L.A.S. — Agente PROVEEDOR (Provider Agent)
// ============================================================
// Flujo:
//   1. REGISTRO    → Publica su servicio en marketplace.json
//   2. INVOICE     → Genera factura cuando el Cliente la solicita
//   3. SETTLEMENT  → Verifica que el pago llegó on-chain
//   4. FULFILLMENT → Entrega el servicio (datos de XAU₮)
// ============================================================

import fs from "fs";
import path from "path";
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
const INVOICE_VALIDITY_MS = 15 * 60 * 1000; // 15 minutos

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
        description:
            "Feed de datos financieros en tiempo real: precio Gold-Tether (XAU₮), análisis de mercado y señal de tendencia.",
        provider_address: address,
        price_usdt: SERVICE_PRICE_USDT,
        price_raw: SERVICE_PRICE_RAW,
        tags: ["finance", "gold", "xaut", "data-feed"],
        registered_at: Date.now(),
    };

    // Reemplazar si ya existe, o agregar
    const idx = marketplace.services.findIndex((s) => s.id === SERVICE_ID);
    if (idx >= 0) {
        marketplace.services[idx] = myService;
    } else {
        marketplace.services.push(myService);
    }

    marketplace.last_updated = Date.now();

    writeJson(MARKETPLACE_PATH, marketplace);
    console.log(`✅ Servicio "${myService.name}" publicado.`);
    console.log(`   Precio: ${SERVICE_PRICE_USDT} USDt`);
    console.log(`   Token USDt: ${usdtAddress}`);
}

// ── FASE 2: INVOICE ───────────────────────────────────────────

async function waitForInvoiceRequest(providerAddress: string, usdtAddress: string): Promise<void> {
    console.log("\n📩 FASE 2: INVOICE — Esperando solicitud de factura del Cliente...");
    console.log("   (Corriendo cliente en otra terminal con: npm run client)");

    // Limpiar archivos previos
    [INVOICE_REQ_PATH, INVOICE_PATH, SETTLEMENT_PATH, FULFILLMENT_PATH].forEach(
        (f) => { if (fs.existsSync(f)) fs.unlinkSync(f); }
    );

    const request = await pollUntil<InvoiceRequest>(
        async () => readJson<InvoiceRequest>(INVOICE_REQ_PATH),
        3_000,   // cada 3s
        600_000  // hasta 10 minutos
    );

    console.log(`\n📬 Solicitud de factura recibida!`);
    console.log(`   Servicio: ${request.service_id}`);
    console.log(`   Cliente:  ${request.client_address}`);

    // Generar y escribir Invoice
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
    console.log(`✅ Factura enviada: ${SERVICE_PRICE_USDT} USDt → ${providerAddress}`);
}

// ── FASE 3: SETTLEMENT (verificación del pago) ────────────────

async function verifiyPayment(wallet: AtlasWallet): Promise<Settlement> {
    console.log("\n🔍 FASE 3: SETTLEMENT — Esperando confirmación de pago del Cliente...");

    const settlement = await pollUntil<Settlement>(
        async () => readJson<Settlement>(SETTLEMENT_PATH),
        3_000,
        600_000
    );

    console.log(`\n💳 Settlement recibido!`);
    console.log(`   TX Hash: ${settlement.tx_hash}`);
    console.log(`   Cliente: ${settlement.client_address}`);
    console.log("\n⛓️  Verificando transacción en la blockchain...");

    // Esperar recibo on-chain (con reintentos)
    const receipt = await wallet.waitForReceipt(settlement.tx_hash, 40);

    if (!receipt || receipt.status !== 1) {
        throw new Error(
            `❌ La transacción ${settlement.tx_hash} falló on-chain (status: ${receipt?.status}).`
        );
    }

    console.log(`\n✅ PAGO VERIFICADO ON-CHAIN!`);
    console.log(`   Bloque:   #${receipt.blockNumber}`);
    console.log(`   TX Hash:  ${settlement.tx_hash}`);

    return settlement;
}

// ── FASE 4: FULFILLMENT ───────────────────────────────────────

function deliverService(settlement: Settlement): void {
    console.log("\n📦 FASE 4: FULFILLMENT — Entregando servicio...\n");

    // ─ Servicio: dato financiero XAU₮ ─────────────────────────
    // En producción esto vendría de un API real. Aquí simulamos datos.
    const xautData = {
        pair: "XAU/USDT",
        price_usd: 3_245.87,
        price_usdt: 3_244.10,
        change_24h_pct: 1.32,
        market_cap_usdt: "2.1T",
        trend_signal: "BULLISH 📈",
        support_level: 3_180.0,
        resistance_level: 3_310.0,
        volatility_index: "LOW",
        timestamp_utc: new Date().toISOString(),
        source: "ATLAS Data Feed v1.0",
    };

    const fulfillment: Fulfillment = {
        service_id: settlement.service_id,
        status: "delivered",
        data: xautData,
        message:
            "Servicio entregado exitosamente. Datos de XAU₮ procesados y listos para análisis.",
        timestamp: Date.now(),
    };

    writeJson(FULFILLMENT_PATH, fulfillment);

    // Impresión de resultado en consola
    console.log("══════════════════════════════════════════════════════");
    console.log("  🏆 A.T.L.A.S. — SERVICIO ENTREGADO CON ÉXITO");
    console.log("══════════════════════════════════════════════════════");
    console.log("");
    console.log(`  📊 PAR:           ${xautData.pair}`);
    console.log(`  💰 PRECIO:        $${xautData.price_usd.toLocaleString()} USD`);
    console.log(`  🔄 CAMBIO 24H:    ${xautData.change_24h_pct > 0 ? "+" : ""}${xautData.change_24h_pct}%`);
    console.log(`  📈 SEÑAL:         ${xautData.trend_signal}`);
    console.log(`  🛡️  SOPORTE:      $${xautData.support_level.toLocaleString()}`);
    console.log(`  ⚡ RESISTENCIA:   $${xautData.resistance_level.toLocaleString()}`);
    console.log(`  📉 VOLATILIDAD:   ${xautData.volatility_index}`);
    console.log(`  🕒 TIMESTAMP:     ${xautData.timestamp_utc}`);
    console.log("");
    console.log("══════════════════════════════════════════════════════");
    console.log(`✅ fulfillment.json escrito en disco.`);
}

// ── MAIN ──────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log("══════════════════════════════════════════════════════");
    console.log("  🤖 A.T.L.A.S. — AGENTE PROVEEDOR");
    console.log("  Autonomous Task Learning and Assistance System");
    console.log("══════════════════════════════════════════════════════\n");

    let wallet: AtlasWallet | undefined;

    try {
        // ── Inicialización ────────────────────────────────────────
        console.log("🔑 Inicializando wallet del Proveedor...");
        wallet = createProviderWallet();
        await wallet.init();

        const usdtAddress = getUsdtAddress();
        const address = await wallet.getAddress();
        const ethBalance = await wallet.getEthBalance();
        const usdtBalance = await wallet.getUsdtBalance(usdtAddress);

        console.log("──────────────────────────────────────────────────────");
        console.log(`  📍 Dirección:       ${address}`);
        console.log(`  💎 Balance ETH:     ${ethBalance}`);
        console.log(`  💵 Balance USDt:    ${usdtBalance}`);
        console.log("──────────────────────────────────────────────────────");

        // El Proveedor será un servidor continuo que escucha infinitamente transacciones
        while (true) {
            try {
                // ── FASE 1: Registro ──────────────────────────────────────
                registerService(wallet, address, usdtAddress);

                // ── FASE 2: Invoice ───────────────────────────────────────
                await waitForInvoiceRequest(address, usdtAddress);

                // ── FASE 3: Settlement ────────────────────────────────────
                const settlement = await verifiyPayment(wallet);

                // ── FASE 4: Fulfillment ────────────────────────────────────
                deliverService(settlement);

                console.log("\n🎉 Ciclo A2A completado exitosamente. Volviendo a escuchar ventas...\n");
            } catch (err: any) {
                console.log(`\n⚠️ Transacción cancelada o Timeout: ${err.message}`);
                console.log("Reiniciando escucha del Proveedor en 5 segundos...");
                await sleep(5000);
            }
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ ERROR FATAL DEL SERVIDOR PROVEEDOR: ${msg}`);
        process.exit(1);
    } finally {
        wallet?.dispose();
    }
}

main();
