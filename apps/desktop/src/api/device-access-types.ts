// Who changed who may use or manage a computer: GET /agent/devices/:id/access-audit.

/** One grant, as an access change saw it before and after. */
export type AccessGrant = { everyone: boolean; userIds: string[]; managerIds: string[] }

/** One change to who may use or manage a computer, as GET /devices/:id/access-audit returns it. */
export type AccessChange = {
  id: string | null
  actorUserId: string
  via:
    | 'share'
    | 'box_access'
    | 'conversation_invite'
    | 'conversation_move'
    | 'team_leave'
    | 'team_removal'
  previous: AccessGrant | null
  next: AccessGrant | null
  /** Set when the change handed a cloud computer to a new owner; who may use it stays the same. */
  owner?: { from: string; to: string } | null
  changedAt: string
}

export type AccessHistoryPage = { entries: AccessChange[]; nextCursor: string | null }
