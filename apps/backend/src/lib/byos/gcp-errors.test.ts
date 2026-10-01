import { describe, expect, test } from 'bun:test'

import { classifyListClustersError } from '@/lib/byos/gcp'
import { gcpServiceDisabledInfo } from '@/lib/byos/gcp-errors'
import { AppError } from '@/lib/errors'

const HANDLE = {
  serviceAccountEmail: 'zeabur-connector@zeabur-dedicated-servers.iam.gserviceaccount.com',
  projectId: 'zeabur-dedicated-servers',
  teamId: '68b0f1f77bcf86cd79943901',
}

const DISABLED_MESSAGE =
  'Kubernetes Engine API has not been used in project zeabur-dedicated-servers before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/container.googleapis.com/overview?project=zeabur-dedicated-servers then retry.'

/**
 * Shaped after what google-gax promotes off `grpc-status-details-bin` — verified
 * against GoogleError.parseGRPCStatusDetails with a real encoded ErrorInfo.
 */
function serviceDisabledError(): Error {
  return Object.assign(new Error(DISABLED_MESSAGE), {
    code: 7,
    reason: 'SERVICE_DISABLED',
    domain: 'googleapis.com',
    errorInfoMetadata: {
      service: 'container.googleapis.com',
      serviceTitle: 'Kubernetes Engine API',
      consumer: 'projects/zeabur-dedicated-servers',
      containerInfo: 'zeabur-dedicated-servers',
      activationUrl:
        'https://console.developers.google.com/apis/api/container.googleapis.com/overview?project=zeabur-dedicated-servers',
    },
  })
}

function iamDeniedError(): Error {
  return Object.assign(
    new Error(
      'Required "container.clusters.list" permission(s) for "projects/zeabur-dedicated-servers".',
    ),
    {
      code: 7,
      reason: 'IAM_PERMISSION_DENIED',
      domain: 'container.googleapis.com',
      errorInfoMetadata: {
        permission: 'container.clusters.list',
        resource: 'projects/zeabur-dedicated-servers',
      },
    },
  )
}

describe('gcpServiceDisabledInfo', () => {
  test('reads the service, project and activation URL out of ErrorInfo', () => {
    const info = gcpServiceDisabledInfo(serviceDisabledError(), {
      service: 'ignored.googleapis.com',
      serviceTitle: 'Ignored',
      projectId: 'ignored',
    })

    expect(info).toEqual({
      service: 'container.googleapis.com',
      serviceTitle: 'Kubernetes Engine API',
      project: 'zeabur-dedicated-servers',
      activationUrl:
        'https://console.developers.google.com/apis/api/container.googleapis.com/overview?project=zeabur-dedicated-servers',
      enableCommand:
        'gcloud services enable container.googleapis.com --project=zeabur-dedicated-servers',
    })
  })

  test('an ErrorInfo-tagged IAM denial is never read as a disabled API', () => {
    expect(
      gcpServiceDisabledInfo(iamDeniedError(), {
        service: 'container.googleapis.com',
        serviceTitle: 'Kubernetes Engine API',
        projectId: HANDLE.projectId,
      }),
    ).toBeNull()
  })

  test('a message-only disabled error still classifies, synthesising the URL', () => {
    const info = gcpServiceDisabledInfo(Object.assign(new Error(DISABLED_MESSAGE), { code: 7 }), {
      service: 'container.googleapis.com',
      serviceTitle: 'Kubernetes Engine API',
      projectId: HANDLE.projectId,
    })

    expect(info?.project).toBe('zeabur-dedicated-servers')
    expect(info?.activationUrl).toBe(
      'https://console.developers.google.com/apis/api/container.googleapis.com/overview?project=zeabur-dedicated-servers',
    )
    expect(info?.enableCommand).toBe(
      'gcloud services enable container.googleapis.com --project=zeabur-dedicated-servers',
    )
  })

  test('a plain permission-denied message is not a disabled API', () => {
    expect(
      gcpServiceDisabledInfo(new Error('Permission denied on resource project foo.'), {
        service: 'container.googleapis.com',
        serviceTitle: 'Kubernetes Engine API',
        projectId: HANDLE.projectId,
      }),
    ).toBeNull()
  })
})

describe('classifyListClustersError', () => {
  // The production report: the SA already held container.clusters.list, but the
  // code-7 disabled-API error was reported as a missing role.
  test('a disabled API reports gcp_api_disabled and names the enable command', () => {
    const error = classifyListClustersError(serviceDisabledError(), HANDLE)

    expect(error).toBeInstanceOf(AppError)
    expect(error!.code).toBe('gcp_api_disabled')
    expect(error!.status).toBe(502)
    expect(error!.message).toContain('Kubernetes Engine API is not enabled')
    expect(error!.message).toContain('zeabur-dedicated-servers')
    expect(error!.message).toContain(
      'gcloud services enable container.googleapis.com --project=zeabur-dedicated-servers',
    )
    expect(error!.message).not.toContain('permission')
    expect(error!.details).toMatchObject({
      provider: 'gcp',
      service: 'container.googleapis.com',
      project: 'zeabur-dedicated-servers',
      activationUrl:
        'https://console.developers.google.com/apis/api/container.googleapis.com/overview?project=zeabur-dedicated-servers',
      serviceAccountEmail: HANDLE.serviceAccountEmail,
    })
  })

  test('a real IAM denial still reports gcp_service_account_permission_denied', () => {
    const error = classifyListClustersError(iamDeniedError(), HANDLE)

    expect(error!.code).toBe('gcp_service_account_permission_denied')
    expect(error!.status).toBe(403)
    expect(error!.message).toContain('does not have permission to container.clusters.list')
  })

  test('an untagged code-7 denial keeps the permission classification', () => {
    const error = classifyListClustersError(
      Object.assign(new Error('The caller does not have permission'), { code: 7 }),
      HANDLE,
    )

    expect(error!.code).toBe('gcp_service_account_permission_denied')
  })

  test('an unrelated failure is left for the inline binding error', () => {
    expect(classifyListClustersError(new Error('socket hang up'), HANDLE)).toBeNull()
  })
})
