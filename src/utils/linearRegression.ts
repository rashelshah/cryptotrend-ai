// Simple linear regression (least squares) for y ~ a + b*x
// Returns slope b, intercept a, r2, and a predict(x) helper.
export type RegressionResult = {
  slope: number
  intercept: number
  r2: number
  predict: (x: number) => number
}

/**
 * Fit linear regression.
 * @param x array of x values (e.g., time indices or timestamps normalized)
 * @param y array of y values (e.g., prices)
 */
export function fitLinearRegression(x: number[], y: number[]): RegressionResult | null {
  const n = Math.min(x.length, y.length)
  if (n < 2) return null

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i]
    const yi = y[i]
    sumX += xi
    sumY += yi
    sumXY += xi * yi
    sumXX += xi * xi
    sumYY += yi * yi
  }

  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // Compute R^2
  const meanY = sumY / n
  let ssTot = 0, ssRes = 0
  for (let i = 0; i < n; i++) {
    const yi = y[i]
    const yhat = intercept + slope * x[i]
    ssTot += (yi - meanY) ** 2
    ssRes += (yi - yhat) ** 2
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return {
    slope,
    intercept,
    r2,
    predict: (xt: number) => intercept + slope * xt
  }
}

/** Build x values as 0..(n-1) to avoid timestamp scale issues. */
export function indexX(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}