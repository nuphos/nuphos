import { api } from '../../../api'
import { t } from '../../../i18n'
import { toast } from '../../ui/toast'

type ImageSource = {
  teamId: string
  channelId?: string
  groupId: string
  fileId: string
  fileName: string
  contentType?: string | null
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000

let latestCopy = 0

async function clipboardPng({ fileName, contentType, ...source }: ImageSource): Promise<Blob> {
  const bytes = await api.fileTransferReadOne({ ...source, maxBytes: MAX_IMAGE_BYTES })

  if (!bytes) throw new Error('Image unavailable')
  const extensionType = /\.svg$/i.test(fileName) ? 'image/svg+xml' : ''
  const type = contentType?.startsWith('image/') ? contentType : extensionType
  const url = URL.createObjectURL(new Blob([bytes], { type }))

  try {
    const image = new Image()

    image.src = url
    await image.decode()
    const { naturalWidth: width, naturalHeight: height } = image

    if (width * height > MAX_IMAGE_PIXELS) throw new Error('Image too large to copy')
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')

    if (!context) throw new Error('Image clipboard unavailable')
    context.drawImage(image, 0, 0)

    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function copyTransferImage(source: ImageSource): Promise<void> {
  const failure = t('Could not copy image')
  const copy = ++latestCopy

  try {
    if (typeof navigator.clipboard === 'undefined' || typeof ClipboardItem === 'undefined') {
      toast.error(failure)

      return
    }
    // Give Chromium the write while the menu or button still has user activation.
    const png = clipboardPng(source).then((blob) => {
      if (copy !== latestCopy) throw new Error('Image copy superseded')

      return blob
    })

    // If the clipboard refuses immediately, the pending image read can still fail.
    await Promise.all([navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]), png])
    if (copy === latestCopy) toast.success(t('Copied'))
  } catch (error) {
    if (copy === latestCopy) toast.apiError(failure, error, { fallback: '' })
  }
}
