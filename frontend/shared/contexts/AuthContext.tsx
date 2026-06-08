import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, getRefreshToken, setTokens, setUnauthorizedHandler } from '@shared/lib/api'
import type { User } from '@shared/types/api'
import { AuthContext, type AuthContextValue, type LoginResult } from '@shared/contexts/auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')

  const loadUser = useCallback(async () => {
    const { data } = await api.get('/users/me')
    setUser(data.user)
    setStatus('authenticated')
  }, [])

  const clearSession = useCallback(() => {
    setTokens({ accessToken: null, refreshToken: null })
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(clearSession)
  }, [clearSession])

  useEffect(() => {
    const init = async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) {
        setStatus('unauthenticated')
        return
      }
      try {
        const { data } = await api.post('/auth/refresh', { refreshToken })
        setTokens({ accessToken: data.accessToken })
        await loadUser()
      } catch {
        clearSession()
      }
    }
    init()
  }, [loadUser, clearSession])

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const { data } = await api.post('/auth/login', { email, password })
    if (data.requires_2fa) {
      return { requires2FA: true, twoFaToken: data.two_fa_token }
    }
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    setUser(data.user)
    setStatus('authenticated')
    return { requires2FA: false }
  }, [])

  const confirm2FA = useCallback(async (twoFaToken: string, code: string) => {
    const { data } = await api.post('/auth/2fa/challenge', { two_fa_token: twoFaToken, code })
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    setUser(data.user)
    setStatus('authenticated')
  }, [])

  const register = useCallback(
    async (payload: { email: string; password: string; full_name: string }) => {
      await api.post('/auth/register', payload)
    },
    [],
  )

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken()
    try {
      await api.post('/auth/logout', { refreshToken })
    } catch {
      // ignore network errors on logout
    }
    clearSession()
  }, [clearSession])

  return (
    <AuthContext.Provider value={{ user, status, login, confirm2FA, register, logout, refreshUser: loadUser }}>
      {children}
    </AuthContext.Provider>
  )
}
