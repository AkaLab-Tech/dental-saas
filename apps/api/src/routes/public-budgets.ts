import { Router, type IRouter } from 'express'
import { rateLimit } from 'express-rate-limit'
import { getBudgetByPublicToken } from '../services/budget.service.js'

const publicBudgetsRouter: IRouter = Router()

// Unauthenticated endpoint reachable by anyone with a share link: keep it tight.
const publicBudgetsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
})

publicBudgetsRouter.use(publicBudgetsRateLimit)

/**
 * GET /api/public/budgets/:token
 * Read-only, unauthenticated lookup of a budget by its public share token.
 * Never exposes tenantId or other internal fields.
 */
publicBudgetsRouter.get('/:token', async (req, res, next) => {
  try {
    const result = await getBudgetByPublicToken(req.params.token)
    if (!result.success) {
      return res.status(404).json({ success: false, error: 'Budget not found' })
    }
    res.json({ success: true, data: result.data })
  } catch (e) {
    next(e)
  }
})

export { publicBudgetsRouter }
