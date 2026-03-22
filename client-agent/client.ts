// ============================================================
// A.T.L.A.S. — Agente CLIENTE (AI Financial Agent)
// ============================================================
// Flujo ReAct:
//   1. Recibe misión desde Dashboard (Gemini 1.5 Pro)
//   2. Revisa Marketplace 
//   3. Pide Factura (Invoice)
//   4. PAGA (Modo Demo: Simula Firma ERC-4337 + Delay Blockchain)
//   5. Recibe Datos (Fulfillment)
// ============================================================

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { createClientWallet, getUsdtAddress } from "./wallet.ts";
import {
    sleep,
    pollUntil,
    AtlasWallet,
} from "../shared/atlas-wallet.ts";
import type {
    Marketplace,
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

// Configuración de Agente IA (Gemini vía OpenAI Protocol)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const client = new OpenAI({
    apiKey: GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export class OpenAIFinancialAgent {
    private wallet: AtlasWallet;
    private clientAddress: string = "";
    private logs: string[] = [];
    private onLog?: (msg: string, type: string) => void;

    constructor(onLog?: (msg: string, type: string) => void) {
        this.wallet = createClientWallet();
        this.onLog = onLog;
    }

    private log(msg: string, type: string = 'info') {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
        console.log(formatted);
        this.logs.push(formatted);
        if (this.onLog) this.onLog(msg, type);
    }

    async init() {
        this.log("🔑 Inicializando Agente Financiero con Smart Account ERC-4337...");
        await this.wallet.init();
        this.clientAddress = await this.wallet.getAddress();
        this.log(`📍 Mi dirección (SCA): ${this.clientAddress}`, 'success');
    }

    async executeMission(prompt: string) {
        this.log(`🎯 [NUEVA MISIÓN ASIGNADA VÍA PROMPT]`, 'action');
        this.log(`"${prompt}"`, 'info');

        let attempts = 0;
        const maxAttempts = 15;

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: `Eres A.T.L.A.S. (Autonomous Task Learning and Assistance System).
            Tienes acceso a herramientas financieras on-chain mediante una Smart Account ERC-4337 (Gasless).
            Tu objetivo es cumplir la misión económica delegada de la forma más racional posible.
            
            REGLAS:
            1. Analiza el marketplace antes de comprar.
            2. Si vas a comprar un servicio, primero pide la factura con 'requestInvoice'.
            3. Si la factura es correcta, procede con 'executeGaslessPayment'.
            4. Finalmente, obtén los datos comprados con 'getFulfillmentData'.
            
            SEGURIDAD:
            - Tenemos un límite de presupuesto interno de 0.50 USDt por transacción.
            `},
            { role: "user", content: prompt }
        ];

        while (attempts < maxAttempts) {
            this.log(`🧠 [LLM REASONING]: Pensando siguiente paso...`, 'thought');
            
            try {
                const response = await client.chat.completions.create({
                    model: "gemini-1.5-pro",
                    messages,
                    tools: [
                        { type: "function", function: { name: "readMarketplace", description: "Ver todos los servicios disponibles en el mercado A2A." } },
                        { type: "function", function: { 
                            name: "requestInvoice", 
                            description: "Solicitar una factura de pago a un proveedor específico.",
                            parameters: { type: "object", properties: { service_id: {type: "string"}, provider_address: {type: "string"} } }
                        } },
                        { type: "function", function: { 
                            name: "executeGaslessPayment", 
                            description: "Firmar y enviar el pago on-chain (ERC-20 USDt) mediante Account Abstraction.",
                            parameters: { type: "object", properties: { 
                                service_id: {type: "string"}, 
                                provider_address: {type: "string"}, 
                                amount_raw: {type: "string"},
                                token_address: {type: "string"}
                            } }
                        } },
                        { type: "function", function: { name: "getFulfillmentData", description: "Recibir los datos o servicios digitales una vez verificado el pago." } }
                    ]
                });

                const choice = response.choices[0];
                const msg = choice.message;

                if (msg.content) {
                    this.log(`🤖💭 "${msg.content}"`, 'thought');
                    messages.push({ role: "assistant", content: msg.content });
                }

                if (!msg.tool_calls) {
                   this.log(`✅ [RESPUESTA FINAL AUTÓNOMA DEL AGENTE A.T.L.A.S]:`, 'success');
                   this.log(`🤖💭 "${msg.content}"`, 'thought');
                   break;
                }

                for (const toolCall of msg.tool_calls) {
                    const name = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    this.log(`🛠️ [TOOL CALLED BY AI]: Ejecutando herramienta '${name}'...`, 'action');
                    const toolResult = await this.handleToolCall(name, args);
                    this.log(`📥 [TOOL RESPONSE]: Recibido dato de vuelta para la IA.`, 'observation');
                    
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: toolResult
                    });
                }

            } catch (err: any) {
                if (err.status === 429) {
                    this.log(`⚠️ Límite de Google alcanzado (429). El Agente tomará aire 5 segundos y retomará...`, 'thought');
                    await sleep(5000);
                    continue;
                }
                throw err;
            }
            attempts++;
        }
    }

    private async handleToolCall(name: string, args: any): Promise<string> {
        switch (name) {
          case "readMarketplace":
            if (!fs.existsSync(MARKETPLACE_PATH)) return "Marketplace vacío.";
            return fs.readFileSync(MARKETPLACE_PATH, "utf-8");

          case "requestInvoice":
            const ir: InvoiceRequest = {
                service_id: args.service_id,
                client_address: this.clientAddress,
                timestamp: Date.now(),
            };
            fs.writeFileSync(INVOICE_REQ_PATH, JSON.stringify(ir, null, 2));
            
            try {
              const inv = await pollUntil(async () => {
                if (!fs.existsSync(INVOICE_PATH)) return null;
                const temp = JSON.parse(fs.readFileSync(INVOICE_PATH, "utf-8"));
                if (temp.client_address.toLowerCase() === this.clientAddress.toLowerCase()) return temp;
                return null;
              }, 3000, 120000); // 2 min timeout
              return JSON.stringify(inv);
            } catch (e) {
                return JSON.stringify({ error: "Timeout esperando factura del proveedor." });
            }

          case "executeGaslessPayment":
            try {
                const amountRaw = BigInt(args.amount_raw);
                
                // 🔥 IA SAFETY GUARDRAIL: Limite 0.50 USDt
                const maxSpendLimitRaw = BigInt(500000); 
                if (amountRaw > maxSpendLimitRaw) {
                    this.log(`🛡️ [GUARDRAIL]: Gasto de ${this.wallet.formatUsdt(amountRaw)} USDt denegado por exceso de riesgo (>0.50).`, 'error');
                    return JSON.stringify({ error: "SEGURIDAD: Transacción bloqueada por el Guardrail (Límite 0.50 USDt excedido)." });
                }

                this.log(`\n💸 [WDK ACCOUNT ABSTRACTION] Firmando y enviando transacción ERC-4337 a Sepolia...`, 'action');
                
                // 🎬 MODO DEMO: Simula firma on-chain
                await sleep(5000);
                const txHash = "0x" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
                
                fs.writeFileSync(SETTLEMENT_PATH, JSON.stringify({
                  service_id: args.service_id,
                  client_address: this.clientAddress,
                  tx_hash: txHash,
                  timestamp: Date.now(),
                }, null, 2));

                this.log(`✅ [TRANSACCIÓN ENVIADA]: Hash ${txHash}`, 'success');
                return JSON.stringify({ success: true, tx_hash: txHash, message: "Transacción asimilada exitosamente (Modo Demo)." });
            } catch(e: any) {
                return JSON.stringify({ error: `Fallo on-chain: ${e.message}` });
            }

          case "getFulfillmentData":
            try {
                const fulfillment = await pollUntil(async () => {
                  if (!fs.existsSync(FULFILLMENT_PATH)) return null;
                  return JSON.parse(fs.readFileSync(FULFILLMENT_PATH, "utf-8"));
                }, 5000, 90000); // 90s timeout
                return JSON.stringify(fulfillment);
            } catch (e) {
                return JSON.stringify({ error: "Fulfillment timeout." });
            }

          default:
            return "Herramienta desconocida.";
        }
    }
}

// ── SERVIDOR WEB Y LOGICA DE CONTROL ─────────────────────────
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

async function main() {
    const agent = new OpenAIFinancialAgent((msg, type) => {
        io.emit('agent_log', { msg, type });
    });
    
    await agent.init();
    
    console.log("══════════════════════════════════════════════════════");
    console.log("✅ Esperando conexión del Dashboard React (puerto 5173)...");
    console.log("══════════════════════════════════════════════════════");

    io.on("connection", (socket) => {
        console.log(`🔌 Dashboard Conectado (ID: ${socket.id})`);
        socket.emit('agent_log', { msg: `Frontend conectado al Cerebro A.T.L.A.S. ID: ${socket.id}`, type: 'system' });

        socket.on("deploy_agent", async (data) => {
            try {
                await agent.executeMission(data.prompt);
            } catch (error: any) {
                io.emit('agent_log', { msg: `Error en la misión: ${error.message}`, type: 'error' });
            }
        });

        socket.on("disconnect", () => {
            console.log("❌ Dashboard Desconectado");
        });
    });

    const PORT = 3000;
    httpServer.listen(PORT, () => {
        console.log(`📡 Backend A.T.L.A.S. escuchando en http://localhost:${PORT}`);
    });
}

main().catch(console.error);
