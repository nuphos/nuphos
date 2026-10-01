import { faFolder } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { LayoutDashboard, MessageSquare } from 'lucide-react'

import { activeNavItemFor, activeNavItemsFor } from '../../../app/navItems'
import { CloudLogo } from '../../../components/CloudLogo'
import { CLOUDFLARE_DETAIL_ACTIVE } from '../../../lib/appRoutes'
import { isSettingsNavigation, isTeamIntegrationsActive } from '../../../lib/connectorScopeCrumb'
import { planNumberFromFilter } from '../../../lib/planRoute'
import { canonicalTeamOverviewKey } from '../../../lib/teamOverviewNav'

import type { BreadcrumbContext } from './breadcrumbContext'
import type { BreadcrumbSegment } from '../../../components/Toolbar'

export function pushNavPickerCrumbs(ctx: BreadcrumbContext, out: BreadcrumbSegment[]): void {
  const {
    scope,
    active,
    filter,
    s3Detail,
    architectureDetail,
    nuphosDashboard,
    nuphosDashboards,
    connectorDetail,
    triggerDetail,
    triggerForm,
    agentSessionTitle,
    agentSessionId,
    awsDetail,
    cloudflareDetail,
    updateActiveTab,
    onSidebarSelect,
  } = ctx

  const navItems = activeNavItemsFor(scope, active)
  const currentNavItem = activeNavItemFor(scope, active)

  if (
    currentNavItem &&
    // Connector-settings pages (AWS roles, GCP service accounts, Cloudflare
    // IAM) end at the account segment — aligned with the connector info
    // pages, whose crumb ends at the connector name.
    !isSettingsNavigation(scope, active)
  ) {
    const inS3Detail = active === 'aws.s3' && Boolean(s3Detail)
    const inAwsDetail =
      awsDetail !== null &&
      ((active === 'aws.lambda' && awsDetail.kind === 'lambda') ||
        (active === 'aws.cloudwatch' && awsDetail.kind === 'logGroup') ||
        (active === 'aws.cloudwatch-alarms' && awsDetail.kind === 'alarm'))
    const inCloudflareDetail =
      cloudflareDetail !== null && active === CLOUDFLARE_DETAIL_ACTIVE[cloudflareDetail.kind]
    const inArchitectureDetail =
      scope.kind === 'team' && active === 'team.architecture' && Boolean(architectureDetail)
    const inNuphosDashboardDetail =
      scope.kind === 'team' && active === 'team.dashboards' && Boolean(nuphosDashboard)
    const inConnectorDetail =
      scope.kind === 'team' && isTeamIntegrationsActive(active) && Boolean(connectorDetail)
    const inTriggerForm =
      scope.kind === 'team' && active === 'team.triggers' && Boolean(triggerForm)
    // A form supersedes the runs page: both are inside the Triggers list, and
    // only the innermost one gets the resource crumb.
    const inTriggerDetail =
      scope.kind === 'team' &&
      active === 'team.triggers' &&
      Boolean(triggerDetail) &&
      !inTriggerForm
    // Chats sits under Agent, not beside Plans and Skills, so it gets no
    // sibling picker — the trail already says where it hangs. It is in the
    // nav-item list at all only so the crumb has a label and an icon.
    // A conversation is a level below Agent, so the Agent crumb becomes
    // clickable — back to Agent home — and the chat's title trails it.
    const inAgentConversation =
      scope.kind === 'team' && active === 'team.agent' && Boolean(agentSessionId)
    const planNumber = planNumberFromFilter(filter)
    const inPlanDetail = scope.kind === 'team' && active === 'team.plans' && Boolean(planNumber)
    const activeNavKey = canonicalTeamOverviewKey(active)

    out.push({
      label: currentNavItem.label,
      icon: currentNavItem.icon,
      // The picker stays put inside a drill-down. It used to be dropped there
      // so the crumb could be clicked back to the list instead — the toolbar
      // rendered a crumb with a menu as the menu trigger and nothing else, so
      // it was one or the other. A crumb is a split button now: the label goes
      // back to the list, the chevron still offers the siblings.
      options: navItems
        // Connector-settings pages (AWS roles, GCP service accounts,
        // Cloudflare IAM, …) are reached from the Connectors page and are
        // deliberately absent from the resource sidebar — so keep them out
        // of this picker too, or the breadcrumb would offer a jump the
        // sidebar doesn't, and the two nav surfaces disagree.
        .filter((item) => !isSettingsNavigation(scope, item.key))
        .map((item) => ({
          key: item.key,
          label: item.label,
          group: item.group,
          icon: item.icon,
          selected: item.key === activeNavKey,
          onPick: () => onSidebarSelect(item.key),
        })),
      onClick: inS3Detail
        ? () => updateActiveTab((tab) => ({ ...tab, s3Detail: null }))
        : inAwsDetail
          ? () => updateActiveTab((tab) => ({ ...tab, awsDetail: null }))
          : inCloudflareDetail
            ? () => updateActiveTab((tab) => ({ ...tab, cloudflareDetail: null }))
            : inArchitectureDetail
              ? () => updateActiveTab((tab) => ({ ...tab, architectureDetail: null }))
              : inNuphosDashboardDetail
                ? () => updateActiveTab((tab) => ({ ...tab, nuphosDashboard: null }))
                : inConnectorDetail
                  ? () => updateActiveTab((tab) => ({ ...tab, connectorDetail: null }))
                  : inTriggerForm
                    ? () =>
                        updateActiveTab((tab) => ({
                          ...tab,
                          triggerForm: null,
                          triggerDetail: null,
                        }))
                    : inTriggerDetail
                      ? () => updateActiveTab((tab) => ({ ...tab, triggerDetail: null }))
                      : inAgentConversation
                        ? () => updateActiveTab((tab) => ({ ...tab, agentSessionId: null }))
                        : inPlanDetail
                          ? () => updateActiveTab((tab) => ({ ...tab, filter: '' }))
                          : undefined,
    })
    if (inTriggerForm && triggerForm) {
      out.push({
        label: triggerForm.kind === 'create' ? 'New trigger' : triggerForm.name,
        isResource: true,
        icon: currentNavItem.icon,
      })
    }
    if (inTriggerDetail && triggerDetail) {
      out.push({
        label: triggerDetail.triggerName,
        isResource: true,
        icon: currentNavItem.icon,
      })
    }
    if (inArchitectureDetail && architectureDetail) {
      out.push({
        label: architectureDetail.diagramName,
        isResource: true,
        icon: currentNavItem.icon,
      })
    }
    if (inNuphosDashboardDetail && nuphosDashboard) {
      out.push({
        label: nuphosDashboard.dashboardName,
        isResource: true,
        icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        // Sibling switcher, like the breadcrumb cluster picker: jump between
        // dashboards without going back through the list page.
        options: (nuphosDashboards ?? []).map((d) => ({
          key: d.id,
          label: d.name,
          icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
          selected: d.id === nuphosDashboard.dashboardId,
          onPick: () =>
            updateActiveTab((tab) => ({
              ...tab,
              nuphosDashboard: { dashboardId: d.id, dashboardName: d.name },
            })),
        })),
      })
    }
    if (inAgentConversation) {
      out.push({
        label: agentSessionTitle || 'Chat',
        isResource: true,
        icon: <MessageSquare className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      })
    }
    if (inPlanDetail && planNumber) {
      out.push({
        label: `Plan #${planNumber}`,
        isResource: true,
        icon: currentNavItem.icon,
      })
    }
    if (inConnectorDetail && connectorDetail) {
      out.push({
        label: connectorDetail.name,
        isResource: true,
        icon: <CloudLogo provider={connectorDetail.provider} size={14} />,
      })
    }
    if (inAwsDetail && awsDetail) {
      out.push({
        label: awsDetail.name,
        isResource: true,
        icon: currentNavItem.icon,
      })
    }
    // Cloudflare leaf(s). R2 adds bucket + object-prefix segments like S3;
    // the others are a single resource leaf.
    if (inCloudflareDetail && cloudflareDetail) {
      if (cloudflareDetail.kind === 'r2') {
        const setR2 = (prefix: string | null) =>
          updateActiveTab((tab) => ({
            ...tab,
            cloudflareDetail: prefix === null ? null : { ...cloudflareDetail, prefix },
          }))

        out.push({
          label: cloudflareDetail.name,
          isResource: true,
          icon: currentNavItem.icon,
          onClick: () => setR2(''),
        })
        const segments = cloudflareDetail.prefix
          ? cloudflareDetail.prefix.replace(/\/$/, '').split('/')
          : []

        segments.forEach((seg, i) => {
          const next = `${segments.slice(0, i + 1).join('/')}/`

          out.push({
            label: seg,
            isResource: true,
            icon: <FontAwesomeIcon icon={faFolder} className="w-3.5 h-3.5 text-tertiary" />,
            onClick: i === segments.length - 1 ? undefined : () => setR2(next),
          })
        })
      } else {
        out.push({
          label: cloudflareDetail.name,
          isResource: true,
          icon: currentNavItem.icon,
        })
      }
    }
  }
}
