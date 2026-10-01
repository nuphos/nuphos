import clsx from 'clsx'

import { awsSteps, azureSteps, gcpSteps } from '../../lib/cloudBindSteps'

import { ALIYUN_STEPS, HUAWEI_STEPS, TENCENT_STEPS, VOLC_STEPS } from './steps'

import type { BindState } from './use-bind-state'

const backButtonClass =
  'h-8 px-3 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-zGray-800 disabled:opacity-50'
const nextButtonClass =
  'h-8 px-3 rounded-md text-[12.5px] font-medium bg-zViolet-500 hover:bg-zViolet-400 text-white transition-colors'

export function BindDialogFooter({
  st,
  valid,
  onSubmit,
  onCloseRequest,
}: {
  st: BindState
  valid: boolean
  onSubmit: () => void
  onCloseRequest: () => void
}) {
  const {
    provider,
    purpose,
    submitting,
    awsStep,
    setAwsStep,
    gcpStep,
    setGcpStep,
    volcengineStep,
    setVolcengineStep,
    huaweiStep,
    setHuaweiStep,
    aliyunStep,
    setAliyunStep,
    tencentStep,
    setTencentStep,
    azureStep,
    setAzureStep,
  } = st

  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3 bg-zGray-900/60">
      <div className="flex items-center gap-2">
        {provider === 'aws' && (
          <button
            onClick={() => (awsStep === 0 ? onCloseRequest() : setAwsStep((s) => s - 1))}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'gcp' && (
          <button
            onClick={() => {
              if (gcpStep > 0) setGcpStep((s) => s - 1)
              else onCloseRequest()
            }}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'volcengine' && volcengineStep > 0 && (
          <button
            onClick={() => setVolcengineStep((s) => s - 1)}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'huawei' && huaweiStep > 0 && (
          <button
            onClick={() => setHuaweiStep((s) => s - 1)}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'aliyun' && aliyunStep > 0 && (
          <button
            onClick={() => setAliyunStep((s) => s - 1)}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'tencent' && tencentStep > 0 && (
          <button
            onClick={() => setTencentStep((s) => s - 1)}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'azure' && (
          <button
            onClick={() => (azureStep === 0 ? onCloseRequest() : setAzureStep((s) => s - 1))}
            disabled={submitting}
            className={backButtonClass}
          >
            Back
          </button>
        )}
        {provider === 'gcp' && gcpStep < gcpSteps(purpose).length - 1 ? (
          <button onClick={() => setGcpStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : provider === 'aws' && awsStep < awsSteps(purpose).length - 1 ? (
          <button onClick={() => setAwsStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : provider === 'volcengine' && volcengineStep < VOLC_STEPS.length - 1 ? (
          <button onClick={() => setVolcengineStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : provider === 'huawei' && huaweiStep < HUAWEI_STEPS.length - 1 ? (
          <button onClick={() => setHuaweiStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : provider === 'aliyun' && aliyunStep < ALIYUN_STEPS.length - 1 ? (
          <button onClick={() => setAliyunStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : provider === 'tencent' && tencentStep < TENCENT_STEPS.length - 1 ? (
          <button onClick={() => setTencentStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : provider === 'azure' && azureStep < azureSteps(purpose).length - 1 ? (
          <button onClick={() => setAzureStep((s) => s + 1)} className={nextButtonClass}>
            Next
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!valid || submitting}
            className={clsx(
              'h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors',
              valid && !submitting
                ? 'bg-zViolet-500 hover:bg-zViolet-400 text-white'
                : 'bg-zGray-800 text-tertiary cursor-not-allowed',
            )}
          >
            {submitting ? 'Binding…' : 'Bind'}
          </button>
        )}
      </div>
    </div>
  )
}
