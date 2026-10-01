import { Modal } from '../../components/Modal'
import { AppSelect } from '../../components/ui/select'

import { LOG_RETENTION_OPTIONS } from './log-helpers'

import type { AwsLogGroup } from '../../types'

export function LogRetentionModal({
  group,
  value,
  onValueChange,
  saving,
  onCancel,
  onSave,
}: {
  group: AwsLogGroup
  value: string
  onValueChange: (value: string) => void
  saving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <Modal open onClose={onCancel} title="Set log retention" description={group.name} width={380}>
      <div className="px-5 py-4 text-[13px]">
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Retention period</div>
          <AppSelect
            value={value}
            onValueChange={onValueChange}
            triggerClassName="h-8 border-zGray-800 px-2 text-[13px]"
            options={[...LOG_RETENTION_OPTIONS]}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
