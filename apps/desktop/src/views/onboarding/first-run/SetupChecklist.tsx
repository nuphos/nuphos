import { motion } from 'framer-motion'

import { WizardExampleImage } from '../../../components/ConnectorWizard'
import { setupScreenshotsFor } from '../../../lib/cloudBindScreenshots'
import { awsContentStep } from '../../../lib/cloudBindSteps'
import {
  AwsWizardStepContent,
  AzureWizardStepContent,
  GcpWizardStepContent,
} from '../../BindAccountDialog'

import { EASE_OUT, setupTitles } from './progress'

import type { Purpose } from './progress'
import type { FirstRunProvider } from '../../../lib/firstRunConnect'
import type { AzureOidcInfo, GcpWifInfo } from '../../../types'

// Every shot in the strip is drawn in this one box, whatever its source page's
// proportions — between the tallest console page we show and the shortest, near
// enough that neither loses much to the crop.
const STRIP_SHOT_RATIO = '640 / 700'

// ---------------------------------------------------------------------------

// One objective at a time. The pinned journey ring already says the setup is
// finite, so the content does not repeat that progress as a second numeric bar.
export function SetupChecklist({
  provider,
  purpose,
  step,
  teamId,
  roleArn,
  onRoleArnChange,
  saEmail,
  onSaEmailChange,
  projectId,
  onProjectIdChange,
  azureOidc,
  gcpWif,
  azureLabel,
  onAzureLabelChange,
  azureTenantId,
  onAzureTenantIdChange,
  azureClientId,
  onAzureClientIdChange,
  azureSubscriptionId,
  onAzureSubscriptionIdChange,
}: {
  provider: FirstRunProvider
  purpose: Purpose
  step: number
  teamId: string
  roleArn: string
  onRoleArnChange: (v: string) => void
  saEmail: string
  onSaEmailChange: (v: string) => void
  projectId: string
  onProjectIdChange: (v: string) => void
  azureOidc: AzureOidcInfo | null
  gcpWif: GcpWifInfo | null
  azureLabel: string
  onAzureLabelChange: (v: string) => void
  azureTenantId: string
  onAzureTenantIdChange: (v: string) => void
  azureClientId: string
  onAzureClientIdChange: (v: string) => void
  azureSubscriptionId: string
  onAzureSubscriptionIdChange: (v: string) => void
}) {
  const titles = setupTitles(provider, purpose)
  const title = titles[step] ?? titles[0]
  const screenshots = setupScreenshotsFor(provider, title, purpose)

  return (
    <div className="pt-3">
      <motion.div
        key={`${provider}-${purpose}-${String(step)}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
      >
        <h3 className="mb-3 text-[15px] font-semibold text-main">{title}</h3>
        {screenshots.length > 0 && (
          // Pinned under the objective, before the instructions: "which page am
          // I looking for?" is asked before any instruction is read, not after.
          // One caption for the whole block whatever it holds — the pictures are
          // the same kind of thing every time, and naming each one separately
          // just gives the eye more to sort before it can look.
          <div className="mb-3.5">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-tertiary">
              What this looks like
            </div>
            {/* A strip that scrolls sideways rather than a grid that wraps. A
                step can carry one shot or four, and a wrapping grid answers that
                by changing shape — a lone shot spanning the panel is big enough
                to push the instructions off screen, while a third one lands
                alone in a half-empty row. Here the box never changes: every shot
                is the same size, so the block is the same height on every step,
                and the count only changes how far it scrolls.

                Sized so the next shot is half-visible. That peek is the whole
                affordance — there is no arrow and no scrollbar, so a strip that
                ended flush at the edge would read as "that's all of them".
                Full-bleed for the same reason: a shot has to run out under the
                panel's edge, not stop 12px short of it, with `scroll-px-3`
                putting the snapped shot back in line with the text. */}
            <div className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-3 px-3 scrollbar-none">
              {screenshots.map((shot) => (
                <WizardExampleImage
                  key={shot.src}
                  layout="block"
                  label={null}
                  src={shot.src}
                  alt={shot.alt}
                  // The shots come off console pages of different heights, so
                  // they crop into one shared box — a ragged strip reads as a
                  // layout bug rather than as several different screenshots.
                  fit="cover"
                  aspectRatio={STRIP_SHOT_RATIO}
                  className="w-[65%] flex-shrink-0 snap-start"
                />
              ))}
            </div>
          </div>
        )}
        {provider === 'aws' ? (
          <AwsWizardStepContent
            step={awsContentStep(purpose, step)}
            teamId={teamId}
            roleArn={roleArn}
            onRoleArnChange={onRoleArnChange}
            purpose={purpose}
            firstRun
          />
        ) : provider === 'gcp' ? (
          <GcpWizardStepContent
            step={step}
            purpose={purpose}
            firstRun
            wif={gcpWif}
            saEmail={saEmail}
            onSaEmailChange={onSaEmailChange}
            projectId={projectId}
            onProjectIdChange={onProjectIdChange}
          />
        ) : (
          <AzureWizardStepContent
            step={step}
            oidc={azureOidc}
            purpose={purpose}
            firstRun
            label={azureLabel}
            onLabelChange={onAzureLabelChange}
            tenantId={azureTenantId}
            onTenantIdChange={onAzureTenantIdChange}
            clientId={azureClientId}
            onClientIdChange={onAzureClientIdChange}
            subscriptionId={azureSubscriptionId}
            onSubscriptionIdChange={onAzureSubscriptionIdChange}
          />
        )}
      </motion.div>
    </div>
  )
}
