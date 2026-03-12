const SUMMARY_THRESHOLD = 400

function normalizeSummaryText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function shouldUseSummaryText(text: string): boolean {
  const normalized = normalizeSummaryText(text)
  return normalized.includes('\n') || normalized.length > SUMMARY_THRESHOLD
}
