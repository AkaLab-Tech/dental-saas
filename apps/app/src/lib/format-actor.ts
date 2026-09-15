import type { TFunction } from 'i18next'
import type { ActorView } from './payment-api'

/**
 * Task #461: the one place a recorded actor becomes text, shared by every
 * surface that shows one so they cannot drift apart.
 *
 * Returns null when there is nothing to say: an actor that was never recorded
 * renders no text at all (absent rather than invented, #392). A removed user is
 * NOT that case — someone did this and is gone — and says so.
 *
 * The role is deliberately not shown: it would be the person's role today, not
 * the one they held when they acted.
 */
export function formatActor(actor: ActorView | null | undefined, t: TFunction): string | null {
  if (!actor) return null
  switch (actor.kind) {
    case 'user':
      return actor.active
        ? t('payments.actorBy', { name: actor.name })
        : t('payments.actorByDeactivated', { name: actor.name })
    case 'removed':
      return t('payments.actorByRemoved')
    case 'system':
      return t('payments.actorBySystem')
  }
}
