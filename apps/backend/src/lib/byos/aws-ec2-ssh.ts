import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2'
import {
  EC2InstanceConnectClient,
  SendSSHPublicKeyCommand,
} from '@aws-sdk/client-ec2-instance-connect'

import { AppError } from '@/lib/errors'
import { describeUnknown } from '@/lib/observability'

import { setupForRole, tagsToRecord } from './aws-ec2-shared'
import { generateEphemeralSshKey } from './ssh-keys'

import type { TempCredentials } from './aws'
import type { AwsEc2Instance } from './aws-ec2-shared'

export type AwsEc2SshAccess = {
  username: string
  ipAddress: string
  privateKey: string
  certKey: null
  expiresAt: string | null
}

// Returns the EC2 instance plus the region we discovered it in, so SSH calls
// can target the right regional endpoint without a separate user-supplied
// region (mirroring how Lightsail's SDK calls accept region in the path).
async function findEc2Instance(
  roleArn: string,
  instanceId: string,
  hintedRegion?: string,
): Promise<{ instance: AwsEc2Instance; temp: TempCredentials } | null> {
  const { temp, regions } = await setupForRole(roleArn)
  const search = hintedRegion ? [hintedRegion] : regions

  let firstRealError: unknown = null

  for (const region of search) {
    try {
      const ec2 = new EC2Client({ region, credentials: temp })
      const out = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))

      for (const reservation of out.Reservations ?? []) {
        for (const inst of reservation.Instances ?? []) {
          if (inst.InstanceId !== instanceId) continue
          const az = inst.Placement?.AvailabilityZone ?? ''

          return {
            temp,
            instance: {
              instanceId: inst.InstanceId,
              instanceType: inst.InstanceType ?? '',
              state: inst.State?.Name ?? 'unknown',
              region: az ? az.slice(0, az.length - 1) : region,
              availabilityZone: az,
              publicIp: inst.PublicIpAddress ?? null,
              privateIp: inst.PrivateIpAddress ?? null,
              launchTime: inst.LaunchTime ? inst.LaunchTime.toISOString() : null,
              platform: inst.Platform ?? null,
              imageId: inst.ImageId ?? null,
              tags: tagsToRecord(inst.Tags),
            },
          }
        }
      }
    } catch (e) {
      // InvalidInstanceID.NotFound just means: not in this region. Anything
      // else (auth, throttling, network) is a real failure — remember the
      // first one so we can surface it if the whole search fails.
      const name = (e as { name?: string }).name

      if (name === 'InvalidInstanceID.NotFound' || name === 'InvalidInstanceID.Malformed') {
        continue
      }
      if (firstRealError == null) firstRealError = e
    }
  }
  if (firstRealError != null) {
    throw firstRealError instanceof Error
      ? firstRealError
      : new Error(describeUnknown(firstRealError))
  }

  return null
}

// Best-effort default Linux username for the instance. EC2 Instance Connect
// uses whichever username actually exists on the host, so this is just the
// first guess we surface to the user; they can edit it later if needed.
function guessLinuxUsername(instance: AwsEc2Instance): string {
  const explicit = instance.tags['atlas:ssh-user'] || instance.tags.SSHUser

  if (explicit) return explicit
  // The AMI ID itself doesn't encode the OS; this is a heuristic that catches
  // the cases where the AMI was tagged on launch (e.g. "ubuntu-..." copy).
  // Real disambiguation would need DescribeImages, which we skip to keep the
  // SSH path snappy. Users can override via tag or the `username` param.
  const imageName = (
    instance.tags['atlas:ami-name'] ||
    instance.tags['ami-name'] ||
    instance.imageId ||
    ''
  ).toLowerCase()

  if (imageName.includes('ubuntu')) return 'ubuntu'
  if (imageName.includes('debian')) return 'admin'
  if (imageName.includes('bitnami')) return 'bitnami'
  if (imageName.includes('centos')) return 'centos'

  return 'ec2-user'
}

export async function getEc2InstanceSshAccess(
  roleArn: string,
  instanceId: string,
  opts?: { region?: string; username?: string },
): Promise<AwsEc2SshAccess> {
  const found = await findEc2Instance(roleArn, instanceId, opts?.region)

  if (!found) {
    throw new AppError(404, 'ec2_instance_not_found', `EC2 instance ${instanceId} not found`)
  }
  const { instance, temp } = found

  if (instance.state !== 'running') {
    throw new AppError(
      409,
      'ec2_instance_not_running',
      `EC2 instance ${instanceId} is ${instance.state}; start it before opening SSH`,
    )
  }
  const ipAddress = instance.publicIp

  if (!ipAddress) {
    throw new AppError(
      400,
      'ec2_no_public_ip',
      `EC2 instance ${instanceId} has no public IP; SSH from Nuphos requires a reachable address`,
    )
  }

  const username = opts?.username || guessLinuxUsername(instance)
  const { privateKeyPem, publicKeyOpenSsh } = generateEphemeralSshKey(`atlas-${instanceId}`)

  const client = new EC2InstanceConnectClient({ region: instance.region, credentials: temp })

  await client.send(
    new SendSSHPublicKeyCommand({
      InstanceId: instanceId,
      InstanceOSUser: username,
      SSHPublicKey: publicKeyOpenSsh,
      AvailabilityZone: instance.availabilityZone || undefined,
    }),
  )

  // The public key remains authorized for 60 seconds — we surface that so the
  // caller can warn the user, even though the live ssh process keeps the
  // session beyond expiry.
  const expiresAt = new Date(Date.now() + 60_000).toISOString()

  return { username, ipAddress, privateKey: privateKeyPem, certKey: null, expiresAt }
}
