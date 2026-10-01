import { faPostgresql } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Database, Leaf } from 'lucide-react'

import { databaseEngineLabel } from '../lib/databaseEngine'

type Props = {
  /** Omitted while the binding is still loading or has gone away — both fall
   *  through to the neutral glyph rather than borrowing another engine's mark. */
  engine?: string
  className?: string
}

/**
 * Engine-specific glyph shared by resource cards, details, and navigation.
 * MongoDB has no icon in our installed Font Awesome set, so a leaf is used as
 * its recognizable product cue instead of incorrectly using the unrelated MDB
 * brand icon.
 */
export function DatabaseEngineGlyph({ engine, className = 'h-4 w-4' }: Props) {
  if (engine === 'mongodb') {
    return <Leaf aria-hidden="true" className={`${className} text-[#47A248]`} strokeWidth={2} />
  }
  if (engine === 'postgresql') {
    return (
      <FontAwesomeIcon
        aria-hidden="true"
        icon={faPostgresql}
        className={`${className} text-[#4169E1]`}
      />
    )
  }
  if (engine === 'cloudflare-d1') {
    return <Database aria-hidden="true" className={`${className} text-[#F38020]`} />
  }

  return <Database aria-hidden="true" className={`${className} text-zViolet-accent`} />
}

export function DatabaseEngineIcon({ engine, className }: Props) {
  return (
    <div
      title={databaseEngineLabel(engine)}
      className={`${className ?? 'h-8 w-8'} flex shrink-0 items-center justify-center rounded-lg bg-zGray-800/70`}
    >
      <DatabaseEngineGlyph
        engine={engine}
        className={className === 'h-10 w-10' ? 'h-5 w-5' : 'h-4 w-4'}
      />
    </div>
  )
}
