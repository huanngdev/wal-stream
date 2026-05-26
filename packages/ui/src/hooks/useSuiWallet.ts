"use client"

import { useCurrentAccount, useCurrentWallet } from "@mysten/dapp-kit"

export function useSuiWallet() {
  const account = useCurrentAccount()
  const { connectionStatus } = useCurrentWallet()

  return {
    connected: connectionStatus === "connected",
    address: account?.address ?? null,
    truncatedAddress: account?.address
      ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
      : null,
    status: connectionStatus,
  }
}
