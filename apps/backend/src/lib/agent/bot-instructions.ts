import { z } from 'zod'

/** A Bot's standing instructions, as the Bot writes them with `update_self` and its owner in Bot details. */
export const botInstructions = z.string().trim().max(8000)
