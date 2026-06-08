import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@shared/lib/queryClient'
import { AuthProvider } from '@shared/contexts/AuthContext'
import { ToastProvider } from '@shared/components/ui/toast'
import { AppRouter } from '@/router'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

export default App
