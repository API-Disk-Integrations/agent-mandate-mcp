import { verifyActionInput, verifyActionOutput } from './schema.js';
const VERIFY_URL = 'https://agentmandate-api.com/v1/verify';
const MAX_SERIALIZED_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BODY_BYTES = 1_048_576;
const ERROR_CODES = new Set([
    'invalid_api_key', 'missing_api_key', 'quota_exceeded', 'rate_limited',
    'invalid_request', 'not_found', 'method_not_allowed', 'payload_too_large',
    'conflict', 'internal_error',
]);
export class SafeApiError extends Error {
    status;
    code;
    constructor(status, code) {
        const safeCode = ERROR_CODES.has(code) ? code : 'unknown';
        super(`Agent Mandate request failed (${safeCode})`);
        this.name = 'SafeApiError';
        this.status = status;
        this.code = safeCode;
    }
}
async function cancelResponseBody(response) {
    if (response.body === null)
        return;
    try {
        await response.body.cancel();
    }
    catch {
        // The response is already being rejected. A failed best-effort cancel must
        // not replace the bounded caller-safe error.
    }
}
async function boundedJson(response) {
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
        if (!/^\d+$/.test(declaredLength)) {
            await cancelResponseBody(response);
            throw new SafeApiError(response.status, 'unknown');
        }
        const declaredBytes = Number(declaredLength);
        if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_RESPONSE_BODY_BYTES) {
            await cancelResponseBody(response);
            throw new SafeApiError(response.status, 'payload_too_large');
        }
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let totalBytes = 0;
    if (reader !== undefined) {
        while (true) {
            const result = await reader.read();
            if (result.done)
                break;
            totalBytes += result.value.byteLength;
            if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
                try {
                    await reader.cancel();
                }
                catch {
                    // Preserve the bounded error even if stream cancellation itself fails.
                }
                throw new SafeApiError(response.status, 'payload_too_large');
            }
            chunks.push(result.value);
        }
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text);
}
export async function verifyAction(rawInput, options) {
    const input = verifyActionInput.parse(rawInput);
    const requestBody = JSON.stringify(input);
    if (new TextEncoder().encode(requestBody).byteLength > MAX_SERIALIZED_REQUEST_BYTES) {
        throw new SafeApiError(413, 'payload_too_large');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    try {
        const response = await (options.fetchImpl ?? fetch)(VERIFY_URL, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${options.apiKey}`,
                'content-type': 'application/json',
            },
            body: requestBody,
        });
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
            await cancelResponseBody(response);
            throw new SafeApiError(response.status, 'unknown');
        }
        let body;
        try {
            body = await boundedJson(response);
        }
        catch (error) {
            if (error instanceof SafeApiError)
                throw error;
            throw new SafeApiError(response.status, 'unknown');
        }
        if (!response.ok) {
            const error = typeof body === 'object' && body !== null && 'error' in body
                ? body.error
                : undefined;
            const safe = typeof error === 'object' && error !== null ? error : {};
            // Never surface provider-controlled free-form strings. An upstream
            // message or requestId could reflect the Authorization header or carry
            // terminal/control content. Status and allowlisted code are sufficient
            // for a caller-safe error boundary.
            throw new SafeApiError(response.status, typeof safe.code === 'string' ? safe.code : 'unknown');
        }
        return verifyActionOutput.parse(body);
    }
    finally {
        clearTimeout(timeout);
    }
}
