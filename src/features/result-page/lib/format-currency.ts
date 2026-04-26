/**
 * INR-aware currency formatters. The redesigned wrapper never renders raw
 * USD literals — every currency-y string flows through here.
 *
 * Usage examples:
 *   formatCurrencyShort(50_000_000)       → "₹ 5.0 Cr"
 *   formatCurrencyShort(750_000)          → "₹ 7.5 L"
 *   formatCurrencyShort(45_000)           → "₹45,000"
 *   formatCurrencyFull(50_000_000)        → "₹50,00,00,000"
 */

export function formatCurrencyShort(amount: number, symbol: string = "₹"): string {
  if (!Number.isFinite(amount) || amount <= 0) return `${symbol}0`;
  if (amount >= 10_000_000) return `${symbol} ${(amount / 10_000_000).toFixed(1)} Cr`;
  if (amount >= 100_000) return `${symbol} ${(amount / 100_000).toFixed(1)} L`;
  return `${symbol}${amount.toLocaleString("en-IN")}`;
}

export function formatCurrencyFull(amount: number, symbol: string = "₹"): string {
  if (!Number.isFinite(amount)) return `${symbol}0`;
  return `${symbol}${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
