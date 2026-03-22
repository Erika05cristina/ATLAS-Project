// ============================================================
// A.T.L.A.S. — Agente CLIENTE (AI Financial Agent)
// ============================================================

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MARKETPLACE_PATH = path.join(ROOT, "marketplace.json");
const INVOICE_REQ_PATH = path.join(ROOT, "invoice_request.json");
const INVOICE_PATH = path.join(ROOT, "invoice.json");
const SETTLEMENT_PATH = path.join(ROOT, "settlement.json");
const FULFILLMENT_PATH = path.join(ROOT, "fulfillment.json");
const AUDIT_LOG_PATH = path.join(ROOT, "audit_trail_log.txt");

// Agente de IA Real (Google Gemini 1.5 Flash)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    tools: [{
        functionDeclarations: [
            { name: "readMarketplace", description: "Ver servicios financieros en el marketplace." },
            { name: "requestInvoice", description: "Solicitar factura de pago.", parameters: { type: "OBJECT", properties: { service_id: {type: "STRING"} }, required: ["service_id"] } },
            { name: "executeGaslessPayment", description: "Firmar y pagar on-chain mediante Account Abstraction.", parameters: { type: "OBJECT", properties: { amount_raw: {type: "STRING"}, provider_address: {type: "STRING"}, token_address: {type: "STRING"} }, required: ["amount_raw", "provider_address"] } },
            { name: "getFulfillmentData", description: "Recibir el servicio tras el pago." }
        ]
    }]
});

export class OpenAIFinancialAgent {
    private wallet: AtlasWallet;
    private clientAddress: string = "";
    private onLog?: (msg: string, type: string) => void;

    constructor(onLog?: (msg: string, type: string) => void) {
        this.wallet = createClientWallet();
        this.onLog = onLog;
    }

    private log(msg: string, type: string = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${msg}\n`;
        fs.appendFileSync(AUDIT_LOG_PATH, logEntry);
        if (this.onLog) this.onLog(msg, type);
    }

    async init() {
        await this.wallet.init();
        this.clientAddress = await this.wallet.getAddress();
        this.log(`📍 Smart Account (SCA) Iniciada: ${this.clientAddress}`, 'success');
    }

    async getStatus() {
        const addr = await this.wallet.getAddress();
        const bal = await this.wallet.getUsdtBalance(getUsdtAddress());
        return { address: addr, balance: bal };
    }

    async executeMission(prompt: string) {
        this.log(`🎯 [NUEVA MISIÓN]`, 'action');
        this.log(`${prompt}`, 'info');

        const chat = model.startChat();
        let result = await chat.sendMessage(prompt);
        
        let attempts = 0;
        while (attempts < 10) {
            const response = result.response;
            const calls = response.functionCalls();

            if (response.text()) {
                this.log(`🤖💭 "${response.text()}"`, 'thought');
            }

            if (!calls || calls.length === 0) break;

            const toolResults: any[] = [];
            for (const call of calls) {
                this.log(`🛠️ [ACTION]: Ejecutando herramienta '${call.name}'...`, 'action');
                const out = await this.handleToolCall(call.name, call.args);
                this.log(`📥 [OBSERVATION]: Datos recibidos.`, 'observation');
                toolResults.push({ functionResponse: { name: call.name, response: { content: out } } });
            }

            result = await chat.sendMessage(toolResults);
            attempts++;
        }
        this.log(`✅ [ESTADO FINAL]: Misión Concluida.`, 'success');
    }

    private async handleToolCall(name: string, args: any): Promise<string> {
        switch (name) {
            case "readMarketplace":
                return fs.readFileSync(MARKETPLACE_PATH, "utf-8");
            
            case "requestInvoice":
                fs.writeFileSync(INVOICE_REQ_PATH, JSON.stringify({ service_id: args.service_id, client_address: this.clientAddress, timestamp: Date.now() }));
                const inv = await pollUntil(async () => fs.existsSync(INVOICE_PATH) ? JSON.parse(fs.readFileSync(INVOICE_PATH, "utf-8")) : null, 3000, 60000);
                return JSON.stringify(inv);
            
            case "executeGaslessPayment":
                try {
                    const amountRaw = BigInt(args.amount_raw);
                    const token = args.token_address || getUsdtAddress();
                    
                    this.log(`💸 [WDK] Firmando Transacción ERC-4337 a Sepolia...`, 'action');
                    const hash = await this.wallet.sendUsdt(args.provider_address, amountRaw, token);
                    
                    fs.writeFileSync(SETTLEMENT_PATH, JSON.stringify({ tx_hash: hash, client_address: this.clientAddress, timestamp: Date.now() }));
                    this.log(`✅ [BLOCKCHAIN]: Pago enviado. Hash ${hash}`, 'success');
                    return JSON.stringify({ success: true, tx_hash: hash });
                } catch (e: any) {
                    this.log(`🚨 [FALLO BLOCKCHAIN]: ${e.message}`, 'error');
                    return JSON.stringify({ error: `On-chain fail: ${e.message}` });
                }

            case "getFulfillmentData":
                const f = await pollUntil(async () => fs.existsSync(FULFILLMENT_PATH) ? JSON.parse(fs.readFileSync(FULFILLMENT_PATH, "utf-8")) : null, 3000, 60000);
                return JSON.stringify(f);
            
            default: return "Method not found";
        }
    }
}

// ── SERVIDOR WEB ─────────────────────────────────────────────
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

async function main() {
    const agent = new OpenAIFinancialAgent((text, type) => {
        io.emit('agent_log', { text, type, timestamp: Date.now() });
    });
    await agent.init();

    app.get('/api/status', async (req, res) => {
        res.json(await agent.getStatus());
    });

    io.on("connection", async (socket) => {
        const status = await agent.getStatus();
        socket.emit('wallet_status', status);
        socket.on("start_mission", async (data) => {
            try {
                await agent.executeMission(data.prompt);
            } catch (e: any) {
                io.emit('agent_log', { text: `Runtime Error: ${e.message}`, type: 'error' });
            }
        });
    });

    httpServer.listen(3000, () => console.log(`📡 A.T.L.A.S. Core Online (Port 3000)`));
}
main().catch(console.error);
