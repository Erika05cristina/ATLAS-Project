// ============================================================
// A.T.L.A.S. — Protocolo de Negociación A2A (Agent-to-Agent)
// Define todos los tipos JSON intercambiados entre los agentes
// ============================================================

/**
 * Una entrada de servicio publicada por el Proveedor en marketplace.json
 */
export interface ServiceListing {
    id: string;
    name: string;
    description: string;
    /** Dirección de wallet del Proveedor para recibir pagos */
    provider_address: string;
    /** Precio legible (ej: "0.10") */
    price_usdt: string;
    /** Precio en la unidad base del token (USDT tiene 6 decimales → "100000" = 0.10 USDT) */
    price_raw: string;
    /** Tags para búsqueda por el Cliente */
    tags: string[];
    /** Timestamp Unix (ms) de cuando el Proveedor se registró */
    registered_at: number;
}

/**
 * El archivo marketplace.json completo
 */
export interface Marketplace {
    version: string;
    description: string;
    last_updated: number | null;
    services: ServiceListing[];
}

/**
 * Fase 2 — INVOICE
 * El Cliente escribe esto en invoice_request.json para solicitar una factura
 */
export interface InvoiceRequest {
    service_id: string;
    client_address: string;
    timestamp: number;
}

/**
 * Fase 2 — INVOICE
 * El Proveedor responde con esto en invoice.json
 */
export interface Invoice {
    service_id: string;
    provider_address: string;
    /** Monto exacto en unidades base del token */
    amount_raw: string;
    /** Dirección del contrato del token de pago */
    token_address: string;
    /** El invoice expira en timestamp (ms) */
    expires_at: number;
    timestamp: number;
}

/**
 * Fase 3 — SETTLEMENT
 * El Cliente escribe esto en settlement.json tras enviar el pago
 */
export interface Settlement {
    service_id: string;
    tx_hash: string;
    client_address: string;
    timestamp: number;
}

/**
 * Fase 4 — FULFILLMENT
 * El Proveedor escribe esto en fulfillment.json tras verificar el pago
 */
export interface Fulfillment {
    service_id: string;
    status: "delivered" | "failed";
    /** El dato/servicio entregado */
    data: Record<string, unknown>;
    message: string;
    timestamp: number;
}
