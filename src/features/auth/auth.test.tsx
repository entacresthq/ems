import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { authApi } from '@/api/auth'
import { tokenStore } from '@/api/client'
import { ToastProvider } from '@/components/ui/Toast'
import { queryClient } from '@/lib/queryClient'
import { resetMockDb } from '@/mocks/db'
import { routes } from '@/routes/router'
import { AuthProvider } from './AuthProvider'

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return router
}

async function signIn(email: string, password = 'Demo@2026', code = '123456') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email address'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.type(await screen.findByLabelText('Sign-in code'), code)
  await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
  return user
}

describe('sign-in flow', () => {
  beforeEach(async () => {
    // Clears the refresh cookie held by MSW's cookie store.
    await authApi.logout()
    tokenStore.set(null)
    queryClient.clear()
    resetMockDb()
    window.localStorage.removeItem('ems.rememberedEmail')
  })

  it('sends a signed-out visitor to the login page', async () => {
    const router = renderApp('/customers')
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
  })

  it('shows a clear error for a wrong password', async () => {
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email address'), 'md@ems.ng')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('The email or password is incorrect. Check both and try again.'),
    ).toBeInTheDocument()
  })

  it('rejects a wrong OTP and counts attempts', async () => {
    renderApp('/login')
    await signIn('md@ems.ng', 'Demo@2026', '000000')
    expect(
      await screen.findByText(/That code is incorrect. You have 4 attempts left./),
    ).toBeInTheDocument()
  })

  it('signs the MD in to the dashboard with every section in the menu', async () => {
    const router = renderApp('/login')
    await signIn('md@ems.ng')
    await screen.findByRole('heading', { name: /Folasade/ })
    expect(router.state.location.pathname).toBe('/')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    expect(nav).toHaveTextContent('Approvals')
    expect(nav).toHaveTextContent('Settings')
  })

  it('hides sections an accountant cannot use', async () => {
    renderApp('/login')
    await signIn('accountant@ems.ng')
    await screen.findByRole('heading', { name: /Ngozi/ })
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    expect(nav).toHaveTextContent('Remittance')
    expect(nav).not.toHaveTextContent('Settings')
    expect(nav).not.toHaveTextContent('Staff')
  })

  it('sends an officer to the field app, which asks for a PIN first', async () => {
    const router = renderApp('/login')
    await signIn('officer@ems.ng')
    await screen.findByRole('heading', { name: 'Set up your PIN' })
    expect(router.state.location.pathname).toBe('/field/today')
  })

  it('forces a password change on first sign-in', async () => {
    const router = renderApp('/login')
    const user = await signIn('newstaff@ems.ng')
    await screen.findByRole('heading', { name: 'Set your own password' })
    expect(router.state.location.pathname).toBe('/change-password')

    // Other pages redirect back until the password is changed.
    await router.navigate('/customers')
    await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'))

    await user.type(screen.getByLabelText('Temporary password'), 'Demo@2026')
    await user.type(screen.getByLabelText('New password'), 'Ikotun2026')
    await user.type(screen.getByLabelText('Confirm new password'), 'Ikotun2026')
    await user.click(screen.getByRole('button', { name: 'Save new password' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('blocks a suspended account with a reason', async () => {
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email address'), 'suspended@ems.ng')
    await user.type(screen.getByLabelText('Password'), 'Demo@2026')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Your account is suspended/)).toBeInTheDocument()
  })

  it('remembers the email when the box is ticked, and fills it in next time', async () => {
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email address'), 'md@ems.ng')
    await user.type(screen.getByLabelText('Password'), 'Demo@2026')
    await user.click(screen.getByLabelText('Remember my email address on this computer'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Sign-in code')
    expect(window.localStorage.getItem('ems.rememberedEmail')).toBe('md@ems.ng')
    // The password is never kept.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('Demo@2026')
  })

  it('does not keep the email when the box is left empty', async () => {
    renderApp('/login')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email address'), 'md@ems.ng')
    await user.type(screen.getByLabelText('Password'), 'Demo@2026')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Sign-in code')
    expect(window.localStorage.getItem('ems.rememberedEmail')).toBe(null)
  })

  it('starts with the remembered email filled in and the box ticked', async () => {
    window.localStorage.setItem('ems.rememberedEmail', 'md@ems.ng')
    renderApp('/login')
    expect(await screen.findByLabelText('Email address')).toHaveValue('md@ems.ng')
    expect(screen.getByLabelText('Remember my email address on this computer')).toBeChecked()
  })
})
