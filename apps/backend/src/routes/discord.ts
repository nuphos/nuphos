import { Hono } from 'hono'

import { handleDiscordInteraction } from '@/routes/discord/interactions'

export const discordRoutes = new Hono()

discordRoutes.post('/interactions', handleDiscordInteraction)
