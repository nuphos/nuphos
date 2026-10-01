import { D1SchemaExplorer } from '../D1SchemaExplorer'
import { MongoDatabaseChanges } from '../MongoDatabaseChanges'
import { MongoDatabaseMonitoring } from '../MongoDatabaseMonitoring'
import { MongoQueryConsole } from '../MongoQueryConsole'
import { MongoSchemaExplorer } from '../MongoSchemaExplorer'

import { ComingSoon } from './ConnectionBits'

import type { DatabaseConnection, TeamMember } from '../../types'

export function CollectionsSection({
  teamId,
  connection,
}: {
  teamId: string
  connection: DatabaseConnection
}) {
  return (
    <div className="border-t border-zGray-800/60 px-6 py-4">
      {connection.engine === 'mongodb' ? (
        <MongoSchemaExplorer teamId={teamId} connection={connection} />
      ) : connection.engine === 'cloudflare-d1' ? (
        <D1SchemaExplorer teamId={teamId} connection={connection} />
      ) : (
        <ComingSoon
          title="PostgreSQL schema inventory"
          body="MongoDB metadata browsing is available first. PostgreSQL schemas and tables will follow the same backend credential boundary."
        />
      )}
    </div>
  )
}

export function QuerySection({
  teamId,
  connection,
  visible,
}: {
  teamId: string
  connection: DatabaseConnection
  visible: boolean
}) {
  return (
    <div className={visible ? 'border-t border-zGray-800/60 px-6 py-4' : 'hidden'}>
      {connection.engine === 'mongodb' ? (
        <MongoQueryConsole key={connection.id} teamId={teamId} connection={connection} />
      ) : connection.engine === 'cloudflare-d1' ? (
        <ComingSoon
          title="Cloudflare D1 Query Console"
          body="This linked resource deliberately does not reuse the provider page's unrestricted SQL endpoint. A bounded read-only D1 gateway must be added before queries are enabled here."
        />
      ) : (
        <ComingSoon
          title="PostgreSQL Query Console"
          body="The shared gateway is live for MongoDB first. PostgreSQL read-only transactions will follow in the same gateway."
        />
      )}
    </div>
  )
}

export function ChangesSection({
  teamId,
  currentUserId,
  connection,
  members,
  onOpenPlanInChat,
}: {
  teamId: string
  currentUserId: string
  connection: DatabaseConnection
  members: TeamMember[]
  onOpenPlanInChat?: (planId: string) => void
}) {
  return (
    <div className="border-t border-zGray-800/60 px-6 py-4">
      {connection.engine === 'mongodb' ? (
        <MongoDatabaseChanges
          teamId={teamId}
          currentUserId={currentUserId}
          connection={connection}
          members={members}
          onOpenPlanInChat={onOpenPlanInChat}
        />
      ) : (
        <ComingSoon
          title={
            connection.engine === 'cloudflare-d1'
              ? 'Cloudflare D1 changes unavailable'
              : 'PostgreSQL change requests'
          }
          body={
            connection.engine === 'cloudflare-d1'
              ? 'This provider-linked resource is metadata-only beyond catalog discovery. D1 mutations are not routed through the MongoDB approval gateway.'
              : 'The governed DML and DDL workflow is available for MongoDB first. PostgreSQL will follow after the MongoDB demo path is complete.'
          }
        />
      )}
    </div>
  )
}

export function MonitoringSection({
  teamId,
  connection,
}: {
  teamId: string
  connection: DatabaseConnection
}) {
  return (
    <div className="border-t border-zGray-800/60 px-6 py-4">
      {connection.engine === 'mongodb' ? (
        <MongoDatabaseMonitoring teamId={teamId} connection={connection} />
      ) : (
        <ComingSoon
          title={
            connection.engine === 'cloudflare-d1'
              ? 'Cloudflare D1 monitoring unavailable'
              : 'PostgreSQL performance monitoring'
          }
          body={
            connection.engine === 'cloudflare-d1'
              ? 'The active Cloudflare connector does not currently expose D1 performance samples to the shared monitoring store.'
              : 'The performance dashboard is being shaped around MongoDB first. PostgreSQL metrics and query insights will follow later.'
          }
        />
      )}
    </div>
  )
}
