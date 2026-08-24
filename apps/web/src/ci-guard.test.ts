/**
 * TEMPORARY -- task #388, acceptance criterion 4.
 *
 * This file exists only to prove that the CI steps added by task #388
 * actually execute the apps/web unit test suite on the GitHub runner. It is
 * reverted before this PR merges -- if you are reading this on `main`,
 * something went wrong.
 *
 * The assertion is inverted on purpose: it PASSES locally (where CI is
 * unset, keeping atelier's safe-commit push gate green) and FAILS on the
 * GitHub runner (where CI=true), so a red "Test Frontend" job is itself the
 * proof that this file ran in CI.
 */
import { describe, it, expect } from 'vitest'

describe('task #388 acceptance criterion 4 guard (temporary)', () => {
  it('fails under CI to prove apps/web unit tests actually execute in CI (task #388, temporary)', () => {
    expect(process.env.CI).toBeFalsy()
  })
})
