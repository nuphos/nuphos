// Credits are the user-facing unit for LLM spend: 1 credit = $0.01 of
// provider cost — the SAME unit the team's quota windows meter, so a
// conversation's cost and the pool it drains from always add up. Keep the raw
// USD in data/APIs; convert only at display.
export function usdToCredits(usd: number): number {
  return Math.round(usd * 100)
}
