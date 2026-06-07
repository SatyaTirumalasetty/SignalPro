import { createContext } from 'react'
import type { User } from '@/types/api'

export interface LoginResult {
  requires2FA: boolean
  twoFaToken?: string
}

export interface AuthContextValue {
  user: User | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  login: (email: string, password: string) => Promise<LoginResult>
  confirm2FA: (twoFaToken: string, code: string) => Promise<void>
  register: (data: { email: string; password: string; full_name: string }) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
