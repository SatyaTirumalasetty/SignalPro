import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

let accessToken: string | null = null
let refreshToken: string | null = localStorage.getItem('refreshToken')

export function setTokens(tokens: { accessToken?: string | null; refreshToken?: string | null }) {
  if (tokens.accessToken !== undefined) accessToken = tokens.accessToken
  if (tokens.refreshToken !== undefined) {
    refreshToken = tokens.refreshToken
    if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken)
    else localStorage.removeItem('refreshToken')
  }
}

export function getAccessToken() {
  return accessToken
}

export function getRefreshToken() {
  return refreshToken
}

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
})

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken })
      .then((res) => {
        const newToken: string = res.data.accessToken
        setTokens({ accessToken: newToken })
        return newToken
      })
      .catch(() => {
        setTokens({ accessToken: null, refreshToken: null })
        onUnauthorized?.()
        return null
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true
      const newToken = await refreshAccessToken()
      if (newToken) {
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      }
    }

    return Promise.reject(error)
  },
)

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: string; errors?: Array<{ msg?: string; message?: string; field?: string; path?: string }> }
      | undefined
    if (data?.error) return data.error
    if (data?.errors?.length) {
      return data.errors
        .map((e) => e.msg || e.message || `Invalid ${e.field || e.path || 'field'}`)
        .join(', ')
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred'
}
