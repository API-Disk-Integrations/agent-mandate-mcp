import * as z from 'zod/v4';
const actionSchema = z.object({
    agent: z.string().min(1).optional(),
    action: z.string().min(1),
    resource: z.string().min(1).optional(),
    amountMinor: z.number().int().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    priorSpendMinor: z.number().int().nonnegative().optional(),
    priorCount: z.number().int().nonnegative().optional(),
    approvalToken: z.string().min(1).optional(),
    at: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((action, ctx) => {
    if (action.amountMinor !== undefined && action.currency === undefined) {
        ctx.addIssue({ code: 'custom', path: ['currency'], message: 'currency is required when amountMinor is supplied' });
    }
});
export const verifyActionInput = z.object({
    // The SIGNED ENVELOPE returned by POST /v1/mandates, not a bare claims object.
    //
    // This was `z.record(z.string(), z.unknown())`, which accepted anything. The
    // free demo route POST /v1/demo/verify takes bare claims and works, so the
    // landing page, the playground and the published Postman example all teach
    // that shape. A developer who followed them and called this tool got an
    // HTTP 400 naming an internal field path, with no route to a signed mandate.
    //
    // Requiring the envelope here means the tool refuses locally with a message
    // that names the actual cause, instead of forwarding a request that cannot
    // succeed.
    mandate: z.object({
        mandate: z.record(z.string(), z.unknown()),
        signature: z.string().min(1),
    }).passthrough(),
    action: actionSchema.optional(),
    actions: z.array(actionSchema).min(1).max(500).optional(),
}).strict().superRefine((value, ctx) => {
    if ((value.action === undefined) === (value.actions === undefined)) {
        ctx.addIssue({ code: 'custom', message: 'supply exactly one of action or actions' });
    }
});
const violationSchema = z.object({
    code: z.string(),
    detail: z.string(),
    grantIndex: z.number().int().optional(),
}).passthrough();
const receiptSchema = z.object({
    decision: z.enum(['allow', 'deny', 'requires_approval']),
    mandateId: z.string().optional(),
    agent: z.string().optional(),
    principal: z.string().optional(),
    action: z.string().optional(),
    matchedGrant: z.unknown().optional(),
    matchedGrantIndex: z.number().int().nullable().optional(),
    violations: z.array(violationSchema).optional(),
    remainingSpendMinor: z.number().int().nullable().optional(),
    evaluatedAt: z.string().optional(),
    digest: z.string().optional(),
}).passthrough();
export const verifyActionOutput = z.object({
    count: z.number().int().nonnegative(),
    receipts: z.array(receiptSchema),
}).passthrough();
