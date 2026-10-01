#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertTagIsAncestor,
  changedFilesSince,
  commitMessagesSince,
  findVersionCommit,
  headCommit,
  listReleaseTags,
  readPackageVersion,
  releaseDateForTag,
} from './release-git.mjs'
import { scheduledReleaseDay } from './release-schedule.mjs'
import { bumpVersion, compareVersions, highestReleaseType } from './release-versioning.mjs'

const COMPONENTS = {
  backend: {
    paths: ['apps/backend'],
    packageFile: 'apps/backend/package.json',
    tagPrefix: 'backend-v',
  },
  desktop: {
    paths: ['apps/desktop'],
    packageFile: 'apps/desktop/package.json',
    tagPrefix: 'v',
  },
  ios: {
    paths: ['apps/ios'],
    packageFile: 'apps/ios/package.json',
    tagPrefix: 'ios-v',
  },
}

function decideAction(root, name, config, facts) {
  const { current, latest, meaningfulFiles, releasedOnReleaseDay, reconcileOnly } = facts

  if (!latest || compareVersions(current, latest.version) > 0) {
    return {
      action: 'release-current',
      releaseType: null,
      nextVersion: current.raw,
      releaseCommit: findVersionCommit(root, config.packageFile, current.raw),
    }
  }
  if (compareVersions(current, latest.version) < 0) {
    throw new Error(`${name} package version ${current.raw} is behind release tag ${latest.tag}`)
  }
  if (!reconcileOnly && !releasedOnReleaseDay && meaningfulFiles.length > 0) {
    const releaseType = highestReleaseType(commitMessagesSince(root, latest.tag, config.paths))

    return {
      action: 'bump',
      releaseType,
      nextVersion: bumpVersion(current, releaseType),
      releaseCommit: null,
    }
  }

  return { action: 'none', releaseType: null, nextVersion: current.raw, releaseCommit: null }
}

function planComponent(root, name, config, { reconcileOnly, releaseDay, timeZone }) {
  const current = readPackageVersion(root, config.packageFile)
  const latest = listReleaseTags(root, config.tagPrefix)[0] ?? null

  if (latest) assertTagIsAncestor(root, latest.tag)

  const changedFiles = changedFilesSince(root, latest?.tag ?? null, config.paths)
  const meaningfulFiles = changedFiles.filter((file) => file !== config.packageFile)
  const releasedOnReleaseDay =
    Boolean(releaseDay) &&
    Boolean(latest) &&
    releaseDateForTag(root, latest.tag, timeZone) === releaseDay

  if (
    latest &&
    current.major > latest.version.major &&
    (current.minor !== 0 || current.patch !== 0)
  ) {
    throw new Error(
      `${name} manual major version ${current.raw} must use the form ${current.major}.0.0`,
    )
  }

  const decision = decideAction(root, name, config, {
    current,
    latest,
    meaningfulFiles,
    releasedOnReleaseDay,
    reconcileOnly,
  })

  return {
    action: decision.action,
    releaseType: decision.releaseType,
    currentVersion: current.raw,
    nextVersion: decision.nextVersion,
    latestTag: latest?.tag ?? null,
    latestVersion: latest?.version.raw ?? null,
    releaseCommit: decision.releaseCommit,
    changedFiles: meaningfulFiles,
    releasedOnReleaseDay,
  }
}

export function buildReleasePlan(
  root = process.cwd(),
  { reconcileOnly = false, releaseDay = null, timeZone = 'Asia/Shanghai' } = {},
) {
  const head = headCommit(root)
  const components = {}

  for (const [name, config] of Object.entries(COMPONENTS)) {
    components[name] = planComponent(root, name, config, { reconcileOnly, releaseDay, timeZone })
  }

  return {
    head,
    releasePrNeeded: Object.values(components).some((component) => component.action === 'bump'),
    noUnreleasedChanges: Object.values(components).every(
      (component) => component.action === 'none',
    ),
    releaseDeferred: Object.values(components).some(
      (component) =>
        component.action === 'none' &&
        component.releasedOnReleaseDay &&
        component.changedFiles.length > 0,
    ),
    components,
  }
}

function githubOutput(plan) {
  const entries = {
    head: plan.head,
    release_pr_needed: String(plan.releasePrNeeded),
    no_unreleased_changes: String(plan.noUnreleasedChanges),
    release_deferred: String(plan.releaseDeferred),
  }

  for (const [name, component] of Object.entries(plan.components)) {
    entries[`${name}_action`] = component.action
    entries[`${name}_release_type`] = component.releaseType ?? ''
    entries[`${name}_current_version`] = component.currentVersion
    entries[`${name}_next_version`] = component.nextVersion
    entries[`${name}_latest_tag`] = component.latestTag ?? ''
    entries[`${name}_release_commit`] = component.releaseCommit ?? ''
    entries[`${name}_changed_files`] = String(component.changedFiles.length)
  }

  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMain) {
  try {
    const rootArgument = process.argv.find((argument) => argument.startsWith('--root='))
    const root = rootArgument ? resolve(rootArgument.slice('--root='.length)) : process.cwd()
    // A scheduled run dates itself by the cron that fired it, capping the
    // schedule at one release per day. A human-initiated run carries no release
    // day: it releases what is unreleased even if the schedule ran today.
    const scheduleArgument = process.argv.find((argument) => argument.startsWith('--schedule='))
    const timeZone = 'Asia/Shanghai'
    const releaseDay = scheduleArgument
      ? scheduledReleaseDay(scheduleArgument.slice('--schedule='.length), new Date(), timeZone)
      : null
    const plan = buildReleasePlan(root, {
      reconcileOnly: process.argv.includes('--reconcile-only'),
      releaseDay,
      timeZone,
    })

    if (process.argv.includes('--github-output')) {
      process.stdout.write(`${githubOutput(plan)}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
