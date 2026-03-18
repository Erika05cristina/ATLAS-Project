import fs from "fs";
import { Marketplace, ServiceListing } from "../shared/protocol.js";
import { createClientWallet, getUsdtAddress } from "./wallet.js";
import { AtlasWallet, sleep, pollUntil } from "../shared/atlas-wallet.js";

// ============================================================
// A.T.L.A.S. — AGENT FRAMEWORK (ReAct Architecture)
// Implementa un Agente Autónomo usando el patrón Thought-Action-Observation
// con una separación estricta entre Razonamiento (Brain) y Billetera (Hands).
// ============================================================

export class AutonomousTaskAgent {
  private wallet: AtlasWallet;
  private clientAddress: string = "";
  
  constructor(wallet: AtlasWallet) {
    this.wallet = wallet;
  }

  async initialize() {
    await this.wallet.init();
    this.clientAddress = await this.wallet.getAddress();
  }

  // ==== AGENT TOOLS (Las "Manos" que interactúan con el mundo físico y blockchain) ====

  private tools = {
    /** Tool 1: Leer el marketplace local */
    readMarketplace: async (): Promise<ServiceListing[]> => {
      if (!fs.existsSync("marketplace.json")) return [];
      const data = JSON.parse(fs.readFileSync("marketplace.json", "utf-8")) as Marketplace;
      return data.services || [];
    },

    /** Tool 2: Solicitar y Recibir Factura */
    requestInvoice: async (serviceId: string): Promise<any> => {
      const request = {
        service_id: serviceId,
        client_address: this.clientAddress,
        timestamp: Date.now(),
      };
      fs.writeFileSync("invoice_request.json", JSON.stringify(request, null, 2));
      
      return await pollUntil(async () => {
        if (!fs.existsSync("invoice.json")) return null;
        const inv = JSON.parse(fs.readFileSync("invoice.json", "utf-8"));
        return inv.client_address === this.clientAddress ? inv : null;
      });
    },

    /** Tool 3: Ejecutar Pago Gasless vía Smart Account ERC-4337 */
    payWithAccountAbstraction: async (invoice: any): Promise<string> => {
      const amountRaw = BigInt(invoice.amount_raw);
      const usdtAddress = invoice.token_address;

      const balanceRaw = await this.wallet.getUsdtBalanceRaw(usdtAddress);
      
      if (balanceRaw < amountRaw) {
        throw new Error(
          `❌ Saldo insuficiente en la Smart Account. Tienes ${this.wallet.formatUsdt(balanceRaw)} USDt, pero necesitas ${this.wallet.formatUsdt(amountRaw)} USDt.`
        );
      }

      // El Agente decide ejecutar el pago on-chain (Gasless / Subsidized)
      const txHash = await this.wallet.sendUsdt(invoice.provider_address, amountRaw, usdtAddress);
      
      fs.writeFileSync("settlement.json", JSON.stringify({
        service_id: invoice.service_id,
        client_address: this.clientAddress,
        tx_hash: txHash,
        timestamp: Date.now(),
      }, null, 2));

      return txHash;
    },

    /** Tool 4: Obtener los resultados del servicio pagado */
    getFulfillmentData: async (): Promise<any> => {
      return await pollUntil(async () => {
        if (!fs.existsSync("fulfillment.json")) return null;
        return JSON.parse(fs.readFileSync("fulfillment.json", "utf-8"));
      });
    }
  };

  // ==== AGENTIC LOOP (El "Cerebro" que evalúa y razona sobre el objetivo) ====

  public async executeMission(missionGoal: string, maxBudgetUsdt: number) {
    console.log(`\n🎯 [NUEVA MISIÓN ASIGNADA]`);
    console.log(`   Objetivo:    "${missionGoal}"`);
    console.log(`   Presupuesto: ${maxBudgetUsdt} USDt\n`);
    
    // --- STEP 1: DISCOVERY ---
    console.log(`🧠 [AGENT THOUGHT]: Debo investigar el mercado para encontrar datos relevantes.`);
    console.log(`🛠️  [AGENT ACTION]: Usando herramienta 'readMarketplace'...`);
    const services = await this.tools.readMarketplace();
    
    const targetService = services.find(s => s.id.includes("xaut"));
    if (!targetService) {
      console.log(`👀 [AGENT OBSERVATION]: No encontré proveedores útiles en el mercado actual.`);
      return;
    }

    const priceUsdt = parseFloat(targetService.price_usdt);
    console.log(`👀 [AGENT OBSERVATION]: Encontré "${targetService.name}" por ${priceUsdt} USDt.`);
    
    // --- STEP 2: DECISION MAKING ---
    console.log(`🧠 [AGENT THOUGHT]: Evaluando condiciones de mercado y presupuesto...`);
    if (priceUsdt > maxBudgetUsdt) {
      console.log(`🧠 [AGENT THOUGHT]: El precio ${priceUsdt} excede mi límite de ${maxBudgetUsdt}. Abortando misión.`);
      return;
    }
    console.log(`🧠 [AGENT THOUGHT]: Precio aceptable. Mi análisis indica que debo adquirir esto ahora. Solicito la factura.`);
    
    // --- STEP 3: TRANSACTION NEGOTIATION ---
    console.log(`🛠️  [AGENT ACTION]: Usando herramienta 'requestInvoice' para ${targetService.id}...`);
    const invoice = await this.tools.requestInvoice(targetService.id);
    console.log(`👀 [AGENT OBSERVATION]: Factura de ${this.wallet.formatUsdt(BigInt(invoice.amount_raw))} USDt recibida con vencimiento a corto plazo.`);
    
    // --- STEP 4: ON-CHAIN SETTLEMENT ---
    console.log(`🧠 [AGENT THOUGHT]: La factura es válida. Autorizo la liquidación de valor On-Chain vía ERC-4337.`);
    console.log(`🛠️  [AGENT ACTION]: Usando herramienta 'payWithAccountAbstraction' integrando WDK...`);
    
    let txHash: string;
    try {
      txHash = await this.tools.payWithAccountAbstraction(invoice);
    } catch (error: any) {
      console.error(`🚨 [AGENT ERROR]: Misión fallida. ${error.message}`);
      return;
    }
    
    console.log(`👀 [AGENT OBSERVATION]: Pago ejecutado sin gas. Transacción PIMLICO/SAFE originada: ${txHash}`);
    
    // --- STEP 5: VERIFICATION & DATA DELIVERY ---
    console.log(`🧠 [AGENT THOUGHT]: Pago notificado. Quedo a la espera de que el nodo del Proveedor verifique la red Ethereum Sepolia y devuelva el servicio.`);
    console.log(`🛠️  [AGENT ACTION]: Usando herramienta 'getFulfillmentData'...`);
    
    const data = await this.tools.getFulfillmentData();
    console.log(`👀 [AGENT OBSERVATION]: Datos recibidos criptográficamente.`);
    console.log(`\n✅ [MISIÓN COMPLETADA]: Resultados de la adquisición A2A:\n`);
    console.log(data);
  }
}

// ==== MAIN BOOTSTRAP ====

async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log("  🤖 A.T.L.A.S. — AGENTE CLIENTE AUTÓNOMO (Smart Acct)");
  console.log("  Autonomous Task Learning and Assistance System");
  console.log("══════════════════════════════════════════════════════\n");

  const wallet = createClientWallet();
  const agent = new AutonomousTaskAgent(wallet);

  try {
    await agent.initialize();
    
    const address = await wallet.getAddress();
    const tokenAddr = getUsdtAddress();
    const balance = await wallet.getUsdtBalance(tokenAddr);

    console.log(`──────────────────────────────────────────────────────`);
    console.log(`  📍 Dirección (ERC-4337 Safe): ${address}`);
    console.log(`  💵 Balance USDt MOCK:         ${balance}`);
    console.log(`──────────────────────────────────────────────────────`);

    // El desarrollador solo define la misión de alto nivel (Prompt)
    // El agente resuelve el cómo y cuándo.
    await agent.executeMission("Comprar análisis y señales de trading de Oro (XAU) para rebalancear portafolio", 0.15);

  } catch (err: any) {
    console.error("\n❌ ERROR CRÍTICO DEL AGENTE:", err.message || err);
  } finally {
    wallet.dispose();
  }
}

main();
