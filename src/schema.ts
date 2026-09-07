import * as z from 'zod/v4'

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
    ctx.addIssue({ code: 'custom', path: ['currency'], message: 'currency is required when amountMinor is supplied' })
  }
})

export const verifyActionInput = z.object({
  mandate: z.record(z.string(), z.unknown()),
  action: actionSchema.optional(),
  actions: z.array(actionSchema).min(1).max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.action === undefined) === (value.actions === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'supply exactly one of action or actions' })
  }
})

const violationSchema = z.object({
  code: z.string(),
  detail: z.string(),
  grantIndex: z.number().int().optional(),
}).passthrough()

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
}).passthrough()

export const verifyActionOutput = z.object({
  count: z.number().int().nonnegative(),
  receipts: z.array(receiptSchema),
}).passthrough()

export type VerifyActionInput = z.infer<typeof verifyActionInput>
export type VerifyActionOutput = z.infer<typeof verifyActionOutput>

