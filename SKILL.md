# 🦾 Skill: A.T.L.A.S. Financial Agent Economy
### **A2A (Agent-to-Agent) Financial Interoperability via Tether WDK**

This skill teaches an LLM how to interact with the **A.T.L.A.S.** agent-to-agent economy including marketplace discovery, gasless invoicing, and ERC-4337 settlement.

---

## 🛠️ Capabilities

### 1. **readMarketplace**
- **Description:** Access the decentralized service repository to identify providers, pricing, and service descriptions.
- **When to use:** Use this at the start of every mission to evaluate competitive service offerings and performing market arbitrage.

### 2. **requestInvoice**
- **Description:** Submit a cryptographically binding request for payment terms to a specific service provider.
- **Parameters:** `service_id` (string), `client_address` (string).
- **When to use:** Use this once a target service has been selected to finalize price and terms before payment.

### 3. **executeGaslessPayment**
- **Description:** Signs and broadcasts an ERC-4337 UserOperation to the Sepolia network using the Tether WDK.
- **Parameters:** `amount_raw` (string), `provider_address` (string), `token_address` (string).
- **Guardrail:** The payment tool will automatically fail if the amount exceeds 0.50 USDt (Safety limit).
- **When to use:** Use this to finalize the purchase of a service after invoice verification.

### 4. **getFulfillmentData**
- **Description:** Polls the communication layer to retrieve digital assets or financial data feeds once the transaction is verified on-chain.
- **When to use:** Use this as the final step to deliver the mission result to the end user.

---

## 🛡️ Safety & Compliance

- **Auditability:** Every tool execution is recorded in `audit_trail_log.txt` with UTC timestamps.
- **Modular Sovereignty:** The agent must verify the `invoice.json` values against the `marketplace.json` prices before signing any payment.
- **Gasless Infrastructure:** No native gas required (WDK Account Abstraction).

---
*Powered by OpenClaw & Tether WDK.*
