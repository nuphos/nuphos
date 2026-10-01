import { useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { SearchBox } from '../../components/Toolbar'
import { ArchivedChatsView } from '../ArchivedChatsView'

export function ArchivedChatsSection({
  teamId,
  onOpenConversation,
}: {
  teamId: string | undefined
  onOpenConversation: (sessionId: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [count, setCount] = useState(0)

  if (!teamId) {
    return (
      <div className="max-w-[640px] mx-auto py-10 px-8 text-[13px] text-tertiary">
        No workspace selected.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-main">
      <PageHeader
        title="Archived chats"
        subtitle="Your chats in this team that you archived or that sat idle for a week"
      />
      <div className="flex h-[42px] flex-shrink-0 items-center gap-2 border-b border-zGray-800/60 px-6">
        <SearchBox filter={filter} onFilterChange={setFilter} count={count} />
      </div>
      <ArchivedChatsView
        teamId={teamId}
        filter={filter}
        refreshKey={0}
        onCount={setCount}
        onOpenConversation={onOpenConversation}
      />
    </div>
  )
}
