import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import i18n from 'i18next'
import '@/i18n'
import { useAuthStore, type User } from '@/stores/auth.store'
import { useLockStore } from '@/stores/lock.store'
import type { UserProfile } from '@/lib/users-api'
import { UsersPage } from './UsersPage'

// Task #440: this page drives role changes, deletion, profile creation and PIN
// status, and had no test of any kind. It is covered here BEFORE #434 narrows
// what the backend lets a role do, so that work lands against a page that can
// fail.
//
// Deliberately real: the i18n instance (assertions read the Spanish the user
// sees), the auth and lock stores, usePermissions, the RBAC table in
// @dental/shared, and ConfirmDialog. The permission cases below therefore test
// the page against the actual role table, not against a stub that agrees with
// it. Only the HTTP layer is mocked.
//
// NOT covered, on purpose: the action menu on an OWNER row. What it offers
// there does not match what the API allows, so a test for that menu would pin
// a defect as the expected behaviour; it is tracked separately.

const api = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUserStats: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  updateUserRole: vi.fn(),
  deleteUser: vi.fn(),
}))
vi.mock('@/lib/users-api', () => api)

const fetchProfiles = vi.fn()

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

function makeUser(overrides: Partial<UserProfile>): UserProfile {
  return {
    id: 'u-x',
    tenantId: 't-1',
    email: 'x@clinic.test',
    firstName: 'X',
    lastName: 'Y',
    role: 'STAFF',
    avatar: null,
    phone: null,
    hasPinSet: false,
    emailVerified: true,
    lastLoginAt: null,
    isActive: true,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

const me = makeUser({ id: 'u-me', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN', email: 'ada@clinic.test' })
const staff = makeUser({ id: 'u-staff', firstName: 'Sara', lastName: 'Staff', role: 'STAFF', email: 'sara@clinic.test', hasPinSet: true })
const profile = makeUser({ id: 'u-prof', firstName: 'Pedro', lastName: 'Perfil', role: 'DOCTOR', email: 'u-prof@noreply.internal' })

const stats = { counts: { ADMIN: 1, DOCTOR: 1 }, limits: { maxAdmins: 2, maxDoctors: 5 } }

function signInAs(role: User['role'], id = me.id) {
  useAuthStore.setState({
    user: { id, email: 'session@clinic.test', firstName: 'S', lastName: 'S', role, tenantId: 't-1' },
  })
}

function rowFor(name: RegExp) {
  return screen.getByRole('row', { name })
}

/** Open the action menu of a row. The trigger is an icon-only button. */
function openMenu(name: RegExp) {
  fireEvent.click(within(rowFor(name)).getByRole('button'))
}

beforeEach(() => {
  vi.clearAllMocks()
  useLockStore.setState({ activeUser: null, fetchProfiles })
  signInAs('ADMIN')
  api.listUsers.mockResolvedValue([me, staff, profile])
  api.getUserStats.mockResolvedValue(stats)
})

describe('UsersPage — list', () => {
  it('renders each user with role, PIN state, status, and a badge instead of a placeholder email', async () => {
    render(<UsersPage />)

    const saraRow = await screen.findByRole('row', { name: /Sara Staff/ })
    expect(within(saraRow).getByText('sara@clinic.test')).toBeInTheDocument()
    expect(within(saraRow).getByText('Staff')).toBeInTheDocument()
    expect(within(saraRow).getByText('Configurado')).toBeInTheDocument()
    expect(within(saraRow).getByText('Activo')).toBeInTheDocument()

    const profileRow = rowFor(/Pedro Perfil/)
    // A profile-only user's generated address is an implementation detail and
    // must not be shown as if it were a real inbox.
    expect(within(profileRow).getByText('Solo perfil')).toBeInTheDocument()
    expect(within(profileRow).queryByText('u-prof@noreply.internal')).not.toBeInTheDocument()
    expect(within(profileRow).getByText('Sin PIN')).toBeInTheDocument()
  })

  it('shows plan limits from the stats endpoint', async () => {
    render(<UsersPage />)
    expect(await screen.findByText(/Admins?:\s*1\/2/i)).toBeInTheDocument()
    expect(screen.getByText(/:\s*1\/5/)).toBeInTheDocument()
  })

  it('shows an error when the list cannot be loaded', async () => {
    api.listUsers.mockRejectedValue(new Error('403'))
    render(<UsersPage />)
    expect(await screen.findByText('Error al cargar usuarios')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('UsersPage — permission gating against the real RBAC table', () => {
  it('ADMIN: may create, and gets an action menu on other users but not on their own row', async () => {
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    expect(screen.getByRole('button', { name: 'Nuevo Usuario' })).toBeInTheDocument()
    expect(within(rowFor(/Sara Staff/)).queryByRole('button')).toBeInTheDocument()
    // Acting on yourself from this menu (demoting, deactivating, deleting) is
    // not offered at all.
    expect(within(rowFor(/Ada Admin/)).queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['CLINIC_ADMIN', 'DOCTOR', 'STAFF'] as const)(
    '%s: no create button and no action menu on any row',
    async (role) => {
      signInAs(role, 'someone-else')
      render(<UsersPage />)
      await screen.findByRole('row', { name: /Sara Staff/ })

      expect(screen.queryByRole('button', { name: 'Nuevo Usuario' })).not.toBeInTheDocument()
      for (const name of [/Ada Admin/, /Sara Staff/, /Pedro Perfil/]) {
        expect(within(rowFor(name)).queryByRole('button')).not.toBeInTheDocument()
      }
    }
  )

  it('uses the PIN-profile role when a profile is active, not the account owner role', async () => {
    // The shared login is ADMIN, but a STAFF profile is unlocked at the kiosk.
    // The page must act on the person at the screen.
    useLockStore.setState({
      activeUser: { id: 'u-staff', firstName: 'Sara', lastName: 'Staff', role: 'STAFF', hasPinSet: true } as never,
    })
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    expect(screen.queryByRole('button', { name: 'Nuevo Usuario' })).not.toBeInTheDocument()
    expect(within(rowFor(/Pedro Perfil/)).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('UsersPage — role change', () => {
  it('offers exactly the other assignable roles, never OWNER', async () => {
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })
    openMenu(/Sara Staff/)

    const offered = screen
      .getAllByRole('button', { name: /^Cambiar rol:/ })
      .map((b) => b.textContent?.replace('Cambiar rol:', '').trim())
    expect(offered).toEqual(['Admin', 'Clinic Admin', 'Doctor'])
  })

  it('sends the chosen role for that user and shows the refreshed list', async () => {
    api.updateUserRole.mockResolvedValue(undefined)
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    api.listUsers.mockResolvedValue([me, { ...staff, role: 'DOCTOR' }, profile])
    openMenu(/Sara Staff/)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar rol: Doctor' }))

    await waitFor(() => expect(api.updateUserRole).toHaveBeenCalledWith('u-staff', 'DOCTOR'))
    expect(await screen.findByText('Rol actualizado')).toBeInTheDocument()
    await waitFor(() => expect(within(rowFor(/Sara Staff/)).getByText('Doctor')).toBeInTheDocument())
    // The kiosk profile list is refreshed too, so the lock screen shows the new role.
    expect(fetchProfiles).toHaveBeenCalled()
  })

  it('reports a rejected role change instead of claiming success', async () => {
    api.updateUserRole.mockRejectedValue(new Error('403'))
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    openMenu(/Sara Staff/)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar rol: Admin' }))

    expect(await screen.findByText('Error al actualizar usuario')).toBeInTheDocument()
    expect(screen.queryByText('Rol actualizado')).not.toBeInTheDocument()
  })
})

describe('UsersPage — delete', () => {
  it('asks for confirmation naming the user, and does not delete until confirmed', async () => {
    api.deleteUser.mockResolvedValue(undefined)
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    openMenu(/Sara Staff/)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Sara Staff/)).toBeInTheDocument()
    expect(api.deleteUser).not.toHaveBeenCalled()

    api.listUsers.mockResolvedValue([me, profile])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(api.deleteUser).toHaveBeenCalledWith('u-staff'))
    expect(await screen.findByText('Usuario eliminado exitosamente')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('row', { name: /Sara Staff/ })).not.toBeInTheDocument())
  })

  it('cancelling the confirmation deletes nothing', async () => {
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    openMenu(/Sara Staff/)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(api.deleteUser).not.toHaveBeenCalled()
    expect(rowFor(/Sara Staff/)).toBeInTheDocument()
  })

  it('reports a failed delete and keeps the user listed', async () => {
    api.deleteUser.mockRejectedValue(new Error('403'))
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    openMenu(/Sara Staff/)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('Error al eliminar usuario')).toBeInTheDocument()
    expect(rowFor(/Sara Staff/)).toBeInTheDocument()
  })
})

describe('UsersPage — activate / deactivate', () => {
  it('deactivates a user through the API and says so', async () => {
    api.updateUser.mockResolvedValue(undefined)
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })

    openMenu(/Sara Staff/)
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith('u-staff', { isActive: false }))
    expect(await screen.findByText('Usuario desactivado')).toBeInTheDocument()
  })
})

describe('UsersPage — create', () => {
  async function openCreate() {
    render(<UsersPage />)
    await screen.findByRole('row', { name: /Sara Staff/ })
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo Usuario' }))
    return screen.getByLabelText('Rol').closest('form')!
  }

  function fields(form: HTMLFormElement) {
    return {
      firstName: within(form).getByLabelText('Nombre'),
      lastName: within(form).getByLabelText('Apellido'),
      email: within(form).queryByLabelText('Correo electrónico'),
      password: within(form).queryByLabelText('Contraseña'),
      role: within(form).getByLabelText('Rol'),
    }
  }

  it('offers exactly the four assignable roles in the role select, never OWNER', async () => {
    const form = await openCreate()
    const options = within(fields(form).role)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF'])
  })

  it('by default creates a PROFILE: no email or password fields, and none sent', async () => {
    api.createUser.mockResolvedValue(undefined)
    const form = await openCreate()
    const f = fields(form)
    expect(f.email).toBeNull()
    expect(f.password).toBeNull()

    fireEvent.change(f.firstName, { target: { value: 'Nora' } })
    fireEvent.change(f.lastName, { target: { value: 'Nueva' } })
    fireEvent.change(f.role, { target: { value: 'DOCTOR' } })
    fireEvent.submit(form)

    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1))
    // toEqual, not objectContaining: an email or password key sneaking into a
    // profile payload is exactly the regression this must catch.
    expect(api.createUser).toHaveBeenCalledWith({
      profileOnly: true,
      firstName: 'Nora',
      lastName: 'Nueva',
      role: 'DOCTOR',
    })
    expect(await screen.findByText('Usuario creado exitosamente')).toBeInTheDocument()
    expect(fetchProfiles).toHaveBeenCalled()
  })

  it('in user mode requires email and password and does not call the API without them', async () => {
    const form = await openCreate()
    fireEvent.click(screen.getByRole('switch', { name: 'Usuario' }))
    const f = fields(form)
    fireEvent.change(f.firstName, { target: { value: 'Ulises' } })
    fireEvent.change(f.lastName, { target: { value: 'Usuario' } })
    // fireEvent.submit skips the browser's native `required`, so the page's own
    // check is what is under test.
    fireEvent.submit(form)

    expect(await screen.findByText('Todos los campos son obligatorios')).toBeInTheDocument()
    expect(api.createUser).not.toHaveBeenCalled()
  })

  it('in user mode sends email and password with the chosen role', async () => {
    api.createUser.mockResolvedValue(undefined)
    const form = await openCreate()
    fireEvent.click(screen.getByRole('switch', { name: 'Usuario' }))
    const f = fields(form)
    fireEvent.change(f.firstName, { target: { value: 'Ulises' } })
    fireEvent.change(f.lastName, { target: { value: 'Usuario' } })
    fireEvent.change(f.email, { target: { value: 'ulises@clinic.test' } })
    fireEvent.change(f.password!, { target: { value: 'Password123!' } })
    fireEvent.change(f.role, { target: { value: 'CLINIC_ADMIN' } })
    fireEvent.submit(form)

    await waitFor(() =>
      expect(api.createUser).toHaveBeenCalledWith({
        firstName: 'Ulises',
        lastName: 'Usuario',
        email: 'ulises@clinic.test',
        password: 'Password123!',
        role: 'CLINIC_ADMIN',
      })
    )
  })

  it('shows the API error in the form and keeps it open with the input intact', async () => {
    api.createUser.mockRejectedValue(new Error('Límite de doctores alcanzado'))
    const form = await openCreate()
    const f = fields(form)
    fireEvent.change(f.firstName, { target: { value: 'Nora' } })
    fireEvent.change(f.lastName, { target: { value: 'Nueva' } })
    fireEvent.submit(form)

    expect(await screen.findByText('Límite de doctores alcanzado')).toBeInTheDocument()
    expect(fields(form).firstName).toHaveValue('Nora')
  })
})
