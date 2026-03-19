import fs from "fs";
import { OpenAI } from "openai";
import 'dotenv/config'; 
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

import { Marketplace, ServiceListing } from "../shared/protocol.js";
import { createClientWallet, getUsdtAddress } from "./wallet.js";
import { AtlasWallet, sleep, pollUntil } from "../shared/atlas-wallet.js";

// ============================================================
// A.T.L.A.S. — OPENAI AGENT FRAMEWORK
// Un Agente LLM Real que utiliza OpenAI Function Calling
// para interactuar autónomamente con la Billetera WDK ERC-4337.
// ============================================================

export class OpenAIFinancialAgent {
  private wallet: AtlasWallet;
  private clientAddress: string = "";
  private openai: OpenAI;
  public io: Server | null = null;
  
  constructor(wallet: AtlasWallet) {
    this.wallet = wallet;
    if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.includes("AIzaSy")) {
        throw new Error("❌ Faltan credenciales: Consigue un GEMINI_API_KEY gratis en https://aistudio.google.com/app/apikey y ponlo en tu .env");
    }
    // Usamos el SDK de OpenAI pero apuntamos directo a Google Gemini que es a prueba de balas y gratis
    this.openai = new OpenAI({ 
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }

  // ==== WEBSOCKET & FILE LOGGER (ENTERPRISE AUDIT) ====
  public log(text: string, type: 'thought' | 'action' | 'observation' | 'system' | 'error' | 'success' = 'system') {
    const timestamp = new Date().toISOString();
    console.log(text);
    
    if (this.io) {
      this.io.emit("agent_log", { text, type, timestamp: Date.now() });
    }

    // Escribir el pensamiento irreversible (Audit Trail de la IA)
    const logLine = `[${timestamp}] [${type.toUpperCase()}] ${text.replace(/\n, " "/g, "")}\n`;
    fs.appendFileSync("audit_trail_log.txt", logLine, "utf-8");
  }

  async initialize() {
    await this.wallet.init();
    this.clientAddress = await this.wallet.getAddress();
  }

  // ==== DEFINICIÓN DE HERRAMIENTAS PARA OPENAI ====
  private tools = [
    {
      type: "function" as const,
      function: {
        name: "readMarketplace",
        description: "Lee el archivo marketplace.json local para encontrar los servicios disponibles, sus IDs y sus precios.",
        parameters: { type: "object", properties: {}, required: [] },
      }
    },
    {
      type: "function" as const,
      function: {
        name: "requestInvoice",
        description: "Solicita una factura para comprar un servicio específico. Devuelve los detalles de pago (invoice).",
        parameters: {
          type: "object",
          properties: {
            service_id: { type: "string", description: "El ID del servicio a comprar" }
          },
          required: ["service_id"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "executeGaslessPayment",
        description: "Usa Account Abstraction (ERC-4337) WDK para firmar criptográficamente y enviar el token solicitado a la dirección del proveedor de forma autónoma.",
        parameters: {
          type: "object",
          properties: {
            service_id: { type: "string", description: "El ID del servicio" },
            provider_address: { type: "string", description: "La dirección del proveedor a pagar" },
            amount_raw: { type: "string", description: "El precio exacto crudo (raw) a pagar" },
            token_address: { type: "string", description: "La dirección del token ERC20 (mock USDT)" }
          },
          required: ["service_id", "provider_address", "amount_raw", "token_address"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "getFulfillmentData",
        description: "Lee el archivo fulfillment.json para recibir los datos del servicio comprado después de haber pagado.",
        parameters: { type: "object", properties: {}, required: [] },
      }
    }
  ];

  // ==== IMPLEMENTACIÓN FÍSICA DE LAS HERRAMIENTAS ====
  private async executeTool(name: string, args: any): Promise<string> {
    this.log(`\n🛠️  [TOOL CALLED BY AI]: Ejecutando herramienta '${name}'...`, 'action');
    
    switch (name) {
      case "readMarketplace":
        if (!fs.existsSync("marketplace.json")) return JSON.stringify({ error: "Marketplace no encontrado localmente." });
        const data = fs.readFileSync("marketplace.json", "utf-8");
        return data;

      case "requestInvoice":
        // Limpiar archivos viejos para no leer caché
        if (fs.existsSync("invoice.json")) fs.unlinkSync("invoice.json");
        if (fs.existsSync("settlement.json")) fs.unlinkSync("settlement.json");
        if (fs.existsSync("fulfillment.json")) fs.unlinkSync("fulfillment.json");
        
        fs.writeFileSync("invoice_request.json", JSON.stringify({
          service_id: args.service_id,
          client_address: this.clientAddress,
          timestamp: Date.now(),
        }, null, 2));
        
        try {
          const inv = await pollUntil(async () => {
            if (!fs.existsSync("invoice.json")) {
                console.log("   [DEBUG] invoice.json no existe aún.");
                return null;
            }
            try {
               const raw = fs.readFileSync("invoice.json", "utf-8");
               console.log("   [DEBUG] invoice.json encontrado. Contenido bruto:", raw);
               const temp = JSON.parse(raw);
               console.log("   [DEBUG] Mi clientAddress =", this.clientAddress);
               console.log("   [DEBUG] Invoice client_address =", temp.client_address);
               
               if (temp.client_address && temp.client_address.toLowerCase() === this.clientAddress.toLowerCase()) {
                   console.log("   [DEBUG] Matches! Aceptando factura.");
                   return temp;
               } else {
                   console.log("   [DEBUG] Direcciones no coinciden o no existe el campo.");
               }
            } catch (err: any) {
                console.log("   [DEBUG] Error leyendo JSON:", err.message);
            }
            return null;
          }, 3000, 30000);
          return JSON.stringify(inv);
        } catch (e) {
            return JSON.stringify({ error: "Timeout esperando factura del proveedor. Reasigne por favor." });
        }

      case "executeGaslessPayment":
        try {
            const amountRaw = BigInt(args.amount_raw);
            const balanceRaw = await this.wallet.getUsdtBalanceRaw(args.token_address);
            
            // 🔥 IA SAFETY GUARDRAIL: Limite máximo de gasto por transacción (0.50 USDt)
            const maxSpendLimitRaw = BigInt(500000); // 0.50 USDt en formato crudo (6 decimales)
            
            if (amountRaw > maxSpendLimitRaw) {
                this.log(`🛡️ [GUARDRAIL ACTIVADO]: La IA intentó gastar ${this.wallet.formatUsdt(amountRaw)} USDt, excediendo el límite de seguridad de 0.50 USDt.`, 'error');
                return JSON.stringify({ error: "🚨 GUARDRAIL DE SEGURIDAD BLOCKCHAIN: Transacción rechazada. La factura excede el presupuesto máximo tolerado de 0.50 USDt para transacciones autónomas." });
            }

            if (balanceRaw < amountRaw) {
                return JSON.stringify({ error: `Saldo insuficiente. Tienes ${this.wallet.formatUsdt(balanceRaw)} USDt, pero la factura es de ${this.wallet.formatUsdt(amountRaw)} USDt.` });
            }

            this.log(`\n💸 [WDK ACCOUNT ABSTRACTION] Firmando y enviando transacción ERC-4337 a Sepolia...`, 'action');
            const txHash = await this.wallet.sendUsdt(args.provider_address, amountRaw, args.token_address);
            
            fs.writeFileSync("settlement.json", JSON.stringify({
              service_id: args.service_id,
              client_address: this.clientAddress,
              tx_hash: txHash,
              timestamp: Date.now(),
            }, null, 2));

            this.log(`✅ [TRANSACCIÓN ENVIADA]: Hash ${txHash}`, 'success');
            return JSON.stringify({ success: true, tx_hash: txHash, message: "Trasancción asimilada en Blockchain exitosamente." });
        } catch(e: any) {
            return JSON.stringify({ error: `Fallo on-chain: ${e.message}` });
        }

      case "getFulfillmentData":
        try {
            const fulfillment = await pollUntil(async () => {
              if (!fs.existsSync("fulfillment.json")) return null;
              return JSON.parse(fs.readFileSync("fulfillment.json", "utf-8"));
            }, 5000, 60000); // Wait up to 60s for provider to verify TX on-chain
            return JSON.stringify(fulfillment);
        } catch (e) {
            return JSON.stringify({ error: "El proveedor nunca entregó o hubo timeout de red." });
        }

      default:
        return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
    }
  }

  // ==== AGENTIC LOOP INTERACTIVO CON OPENAI ====

  public async executeMission(missionGoal: string) {
    this.log(`\n🎯 [NUEVA MISIÓN ASIGNADA VÍA PROMPT]`, 'system');
    this.log(`   "${missionGoal}"\n`, 'system');
    
    const messages: any[] = [
      { role: "system", content: "Eres A.T.L.A.S, un Agente Financiero de IA Autónomo. Tienes el control de una wallet Smart Account (WDK) conectada a Sepolia y puedes gastar fondos en servicios útiles que te pida el usuario. Para lograr tu objetivo debes usar siempre las Tools que tienes disponibles: 1. readMarketplace para buscar precios. 2. requestInvoice para pedir cobrar. 3. executeGaslessPayment para firmar y liquidar el valor on-chain (OBLIGATORIO para pagar). 4. getFulfillmentData para obtener los datos comprados. Si una herramienta lanza un error de saldo, debes reportarlo al usuario y detenerte. Tu respuesta final al usuario debe incluir todos los datos financieros que compraste analizados brevemente." },
      { role: "user", content: missionGoal }
    ];

    try {
      while (true) {
        this.log(`🧠 [LLM REASONING]: Pensando siguiente paso...`, 'thought');
        
        let response;
        try {
          response = await this.openai.chat.completions.create({
            model: "gemini-2.5-flash", // Modelo increíblemente rápido, gratis, y no tira 429
            messages: messages,
            tools: this.tools as any,
            tool_choice: "auto",
          });
        } catch (apiErr: any) {
          if (apiErr.status === 429 || (apiErr.message && apiErr.message.includes("429"))) {
            this.log(`⚠️ Límite de Google alcanzado (429). El Agente tomará aire 5 segundos y retomará...`, 'thought');
            await sleep(5000);
            continue; // Volver a intentar la misma petición sin perder el contexto!
          }
          throw apiErr; // Si es otro error de red, abortar
        }

        const choice = response.choices[0].message;
        messages.push(choice);

        // Si la IA decide llamar a una herramienta (Tool Calling)
        if (choice.tool_calls && choice.tool_calls.length > 0) {
          for (const toolCall of choice.tool_calls) {
            const toolCallAny = toolCall as any;
            const args = JSON.parse(toolCallAny.function.arguments);
            
            // Ejecutamos el poder físico/blockchain asociado a la llamada del LLM
            const toolResult = await this.executeTool(toolCallAny.function.name, args);
            this.log(`📥 [TOOL RESPONSE]: Recibido dato de vuelta para la IA.`, 'observation');
            
            messages.push({
              tool_call_id: toolCallAny.id,
              role: "tool",
              name: toolCallAny.function.name,
              content: toolResult,
            });
          }
        } else {
          // Si no hay más herramientas que llamar, esta es la respuesta final de la IA
          this.log(`\n✅ [RESPUESTA FINAL AUTÓNOMA DEL AGENTE A.T.L.A.S]:`, 'success');
          this.log(`\n🤖💭 "${choice.content}"\n`, 'system');
          break; // Salimos del loop
        }
      }
    } catch (error: any) {
        this.log(`🚨 [OPENAI ERROR]: ${error.message}`, 'error');
    }
  }
}

// ==== MAIN BOOTSTRAP ====

async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log("  🧠 A.T.L.A.S. — SERVIDOR DE INTELIGENCIA REAL-TIME");
  console.log("  Iniciando servidor Express y WebSockets en puerto 3000");
  console.log("══════════════════════════════════════════════════════");

  const app = express();
  app.use(cors());
  app.use(express.json());
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  const wallet = createClientWallet();
  let agent: OpenAIFinancialAgent;

  try {
      agent = new OpenAIFinancialAgent(wallet);
      agent.io = io; // Inject WebSocket server into agent
      await agent.initialize();
      
      const address = await wallet.getAddress();
      const tokenAddr = getUsdtAddress();
      let balance = await wallet.getUsdtBalance(tokenAddr);

      io.on("connection", async (socket) => {
          agent.log(`[SYSTEM] Frontend conectado al Cerebro LLM. ID: ${socket.id}`, 'system');
          
          // Enviar estado inicial
          balance = await wallet.getUsdtBalance(tokenAddr);
          socket.emit("wallet_status", { address, balance });

          socket.on("start_mission", async (data: { prompt: string }) => {
              agent.log(`[SYSTEM] Nueva misión recibida desde el Dashboard UI`, 'system');
              await agent.executeMission(data.prompt);
          });
      });

      // Simple health endpoint
      app.get("/api/status", async (req, res) => {
          const bal = await wallet.getUsdtBalance(tokenAddr);
          res.json({ address, balance: bal, status: "online", agentMode: "Groq LLaMa-3" });
      });

      httpServer.listen(3000, () => {
          console.log(`\n🚀 [SERVER READY] Backend de A.T.L.A.S. escuchando en http://localhost:3000`);
          console.log(`✅ Esperando conexión del Dashboard React (puerto 5173)...`);
      });

  } catch (err: any) {
    console.error("\n❌ ERROR CRÍTICO DEL AGENTE:", err.message || err);
    wallet.dispose();
  }
}

main();
