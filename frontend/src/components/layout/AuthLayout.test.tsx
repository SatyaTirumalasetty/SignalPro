import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { AuthLayout } from './AuthLayout'

describe('AuthLayout', () => {
  test('renders title, subtitle, and children', () => {
    render(
      <AuthLayout title="Sign in" subtitle="Enter your credentials">
        <div>form content</div>
      </AuthLayout>,
    )

    expect(screen.getByText('Sign in')).toBeInTheDocument()
    expect(screen.getByText('Enter your credentials')).toBeInTheDocument()
    expect(screen.getByText('form content')).toBeInTheDocument()
  })

  test('renders without a subtitle', () => {
    render(
      <AuthLayout title="Choose a new password">
        <div>form content</div>
      </AuthLayout>,
    )

    expect(screen.getByText('Choose a new password')).toBeInTheDocument()
    expect(screen.queryByText('Enter your credentials')).not.toBeInTheDocument()
  })
})
