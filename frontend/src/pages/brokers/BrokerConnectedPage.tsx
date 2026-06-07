import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'

export function BrokerConnectedPage() {
  const [params] = useSearchParams()
  const broker = params.get('broker')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['broker-connections'] })
  }, [queryClient])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <CheckCircle2 className="text-success" size={40} />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Broker connected</h1>
            <p className="mt-1 text-sm text-muted">
              {broker ? `Your ${broker} account has been connected successfully.` : 'Your broker account has been connected.'}
            </p>
          </div>
          <Button onClick={() => navigate('/brokers')}>Back to broker connections</Button>
        </CardContent>
      </Card>
    </div>
  )
}
