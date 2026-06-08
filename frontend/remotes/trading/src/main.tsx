import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@shared/lib/queryClient'
import './index.css'
import { StandalonePreview } from './StandalonePreview'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <StandalonePreview />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
