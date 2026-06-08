import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@shared/components/layout/AuthLayout'
import { Input } from '@shared/components/ui/input'
import { Button } from '@shared/components/ui/button'
import { useAuth } from '@shared/hooks/useAuth'
import { getApiErrorMessage } from '@shared/lib/api'

export function LoginPage() {
  const { login, confirm2FA } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [twoFaToken, setTwoFaToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (twoFaToken) {
        await confirm2FA(twoFaToken, code)
      } else {
        const result = await login(email, password)
        if (result.requires2FA && result.twoFaToken) {
          setTwoFaToken(result.twoFaToken)
          setLoading(false)
          return
        }
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (twoFaToken) {
    return (
      <AuthLayout title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            maxLength={6}
            autoFocus
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Sign in to SignalPro" subtitle="Enter your credentials to access your account">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="flex items-center justify-between text-sm text-muted">
          <Link to="/forgot-password" className="hover:text-foreground">
            Forgot password?
          </Link>
          <Link to="/register" className="hover:text-foreground">
            Create account
          </Link>
        </div>
      </form>
    </AuthLayout>
  )
}
