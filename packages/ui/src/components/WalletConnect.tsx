"use client"

import { useConnectWallet, useDisconnectWallet, useWallets } from "@mysten/dapp-kit"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useSuiWallet } from "@workspace/ui/hooks/useSuiWallet"
import { Copy, LogOut, Wallet } from "lucide-react"

export function WalletConnect() {
  const { connected, truncatedAddress, address } = useSuiWallet()
  const wallets = useWallets()
  const { mutate: connectWallet } = useConnectWallet()
  const { mutate: disconnectWallet } = useDisconnectWallet()

  if (!connected) {
    return (
      <Button
        onClick={() => {
          const first = wallets[0]
          if (first) connectWallet({ wallet: first })
        }}
        disabled={wallets.length === 0}
      >
        <Wallet data-icon="inline-start" />
        {wallets.length === 0 ? "No wallet found" : "Connect Sui Wallet"}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Wallet data-icon="inline-start" />
          {truncatedAddress}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            if (address) void navigator.clipboard.writeText(address)
          }}
        >
          <Copy />
          Copy Address
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => disconnectWallet()}>
          <LogOut />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
