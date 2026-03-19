# 🤖 A.T.L.A.S. (Autonomous Task Learning and Assistance System)

**A.T.L.A.S** es un proyecto diseñado para el **Hackathon Galáctica: WDK Edition 1** de Tether, compitiendo en la categoría *Agent Wallets*.

Este proyecto demuestra un caso de uso real de **Infraestructura Económica Autónoma**. 
Dos agentes de Inteligencia Artificial (un Cliente usando OpenClaw y un Proveedor) negocian e intercambian activos digitales en la blockchain de Ethereum Sepolia de forma **100% autónoma y Gasless**, interactuando con contratos inteligentes sin intervención humana.

---

## 🌟 ¿Por qué A.T.L.A.S. es un proyecto ganador? (El Pitch para el Jurado)

1. **Agentes como infraesructura económica real**: Los agentes de A.T.L.A.S no son simples scripts; toman decisiones económicas. A.T.L.A.S (OpenClaw) evalúa si necesita datos financieros del mercado de **XAU₮ (Oro Tether)**, negocia el precio con el agente proveedor, y ejecuta el pago.
2. **Account Abstraction (ERC-4337) nativo**: La integración con `@tetherto/wdk-wallet-evm-erc-4337` elimina la fricción de la blockchain. El agente **NO necesita ETH para el Gas**. Utiliza el Paymaster de Pimlico para subsidiar la transacción usando directamente tokens USDt.
3. **Integración con OpenClaw oficial**: A.T.L.A.S implementa una *Agent Skill* nativa (`SKILL.md`) que se inyecta directamente en **OpenClaw**, logrando la solicitada y perfecta separación entre el Razonamiento del Agente (OpenClaw) y la Ejecución Financiera (Tether WDK).
4. **Valor Liquidado On-Chain ("Value settles onchain")**: La entrega del servicio de datos está condicionada a la verificación criptográfica del pago en la red Sepolia. Cero confianza (*Trustless*).

---

## 🏗️ Arquitectura del Sistema

La economía de A.T.L.A.S. funciona mediante tres componentes principales:

1. **El Tablón de Mercado (`marketplace.json`)**: El espacio off-chain donde los agentes anuncian sus servicios (Ej: feeds de precios de XAU₮).
2. **El Agente Proveedor (`provider.ts`)**: Un bot automatizado que publica servicios, emite facturas (Invoices), escucha la Blockchain (Sepolia) para verificar el pago del Cliente y luego entrega criptográficamente los datos (`fulfillment.json`).
3. **El Agente Cliente (OpenClaw + `.agents/skills/atlas-bot`)**: El cerebro de la operación. Una inteligencia artificial que interactúa con el usuario, lee el mercado local, y usa sus herramientas WDK internas para firmar transacciones *Gasless* y enviar el USDt al proveedor.

---

## 🚀 Guía Rápida de Uso (Reproducción Local)

### 1. Clonar e Instalar
```bash
npm install
```

### 2. Generar Billeteras Autónomas (Smart Accounts)
Corre el generador determinístico para crear Smart Accounts ERC-4337 basadas en WDK:
```bash
node generate-wallets.mjs
```
Copia las frases semilla que te devolverá el script y guárdalas en un archivo `.env` en la raíz (usa `.env.example` como referencia).

### 3. Fondear el Agente Cliente
Usando la dirección de Smart Account generada para el Cliente, solicita tokens **USDt de Prueba de Sepolia (ERC-4337)** desde el [Pimlico Faucet](https://faucet.pimlico.io/) o usa el smart contract MOCK configurado. **(No se requiere ETH para Gas).**

### 4. Arrancar la Economía
Abre dos ventanas de terminal:

**Terminal 1 (El Vendedor):**
```bash
npm run provider
```
El Agente Proveedor encenderá sus motores, anunciará sus datos de XAU₮ a 0.10 USDt y esperará peticiones.

**Terminal 2 (El Comprador / OpenClaw):**
Si tienes OpenClaw instalado junto con las `tetherto/wdk-agent-skills`, inicia una conversación con el agente y dile:
> *"Busca datos financieros del Oro (XAU) en el marketplace local y cómpralos usando mis fondos WDK"*.

El Agente Cliente se encargará de negociar la Factura (Invoice), firmarla, enviarla mediante el Paymaster de Pimlico, y devolverte el archivo `fulfillment.json` con el Análisis Financiero de Oro.

---

## 🛠️ Stack Tecnológico
- **Core Wallet:** `@tetherto/wdk`
- **Account Abstraction:** `@tetherto/wdk-wallet-evm-erc-4337` (Pimlico / Safe)
- **Agent Framework:** OpenClaw + Agent Skills
- **Red:** Ethereum Sepolia (Testnet)
- **Activos:** USDt (Mock), XAU₮

---

*Construido para el Hackathon Galáctica: WDK Edition 1.*
