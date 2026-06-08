import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '@shared/components/layout/AuthLayout'
import { api, getApiErrorMessage } from '@shared/lib/api'

type Status = 'pending' | 'success' | 'error'

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [result, setResult] = useState<{ status: Status; error: string | null }>(
    token ? { status: 'pending', error: null } : { status: 'error', error: 'Missing verification token' },
  )

  const requestedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!token || requestedRef.current === token) return
    requestedRef.current = token
    api
      .post('/auth/verify-email', { token })
      .then(() => setResult({ status: 'success', error: null }))
      .catch((err) => setResult({ status: 'error', error: getApiErrorMessage(err) }))
  }, [token])

  return (
    <AuthLayout title="Email verification">
      {result.status === 'pending' && <p className="text-sm text-muted">Verifying your email…</p>}
      {result.status === 'success' && (
        <p className="text-sm text-foreground">
          Your email has been verified. You can now{' '}
          <Link to="/login" className="text-primary hover:underline">
            sign in
          </Link>
          .
        </p>
      )}
      {result.status === 'error' && <p className="text-sm text-danger">{result.error}</p>}
    </AuthLayout>
  )
}
