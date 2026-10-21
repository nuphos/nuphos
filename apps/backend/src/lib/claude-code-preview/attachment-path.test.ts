import { expect, test } from 'bun:test'

import { attachmentFileUrl } from './attachment-path'

test('POSIX and Windows absolute attachment paths use their own platform semantics', () => {
  expect(attachmentFileUrl('/runtime/image space.png')).toBe('file:///runtime/image%20space.png')
  expect(attachmentFileUrl('C:\\Users\\Pan Name\\圖片.png')).toBe(
    'file:///C:/Users/Pan%20Name/%E5%9C%96%E7%89%87.png',
  )
  expect(attachmentFileUrl('\\\\server\\share\\image space.png')).toBe(
    'file://server/share/image%20space.png',
  )
})

test('relative, drive-relative, non-path and NUL-containing results are rejected', () => {
  for (const path of ['relative.png', 'C:relative.png', 'image\0.png', undefined, 42])
    expect(attachmentFileUrl(path)).toBeUndefined()
})
