"use client"

import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import "@mysten/dapp-kit/dist/index.css"

const queryClient = new QueryClient()

const SUI_NETWORKS = {
  testnet: { url: "https://fullnode.testnet.sui.io:443" },
  mainnet: { url: "https://fullnode.mainnet.sui.io:443" },
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider
        networks={SUI_NETWORKS}
        defaultNetwork="testnet"
      >
        <WalletProvider autoConnect>
          <ThemeProvider>{children}</ThemeProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
