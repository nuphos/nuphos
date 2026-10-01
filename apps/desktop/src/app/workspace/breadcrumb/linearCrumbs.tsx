import { LinearMark } from '../../../components/LinearMark'
import { LINEAR_PAGE_KEY, linearCrumbs, linearNavOf, withLinearNav } from '../../../lib/linearNav'

import type { BreadcrumbSection } from './breadcrumbContext'

export const pushLinearCrumbs: BreadcrumbSection = (ctx, out) => {
  if (ctx.scope.kind !== 'team' || ctx.active !== LINEAR_PAGE_KEY) return
  for (const crumb of linearCrumbs(linearNavOf(ctx.linearNav))) {
    const { target } = crumb

    out.push({
      label: crumb.label,
      isResource: crumb.kind !== 'root',
      icon: crumb.kind === 'root' ? <LinearMark size={14} className="text-tertiary" /> : undefined,
      onClick: target ? () => ctx.updateActiveTab((tab) => withLinearNav(tab, target)) : undefined,
    })
  }
}
