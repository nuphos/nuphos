/** A chat's: the Triggers a new Bot was set up with, named above that Bot's first post here. */
export type CreatedTriggersState = {
  pendingCreatedTriggers?: { botSessionId: string; triggers: { id: string; name: string }[] }
}
