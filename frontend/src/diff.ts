import type { DiffItem } from './types'

// Word-level comparison intentionally ignores punctuation and letter case.
const TOKEN = /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:\.\d+)?/g
const tokenize = (text: string) => text.match(TOKEN) ?? []
const normalize = (token: string) => token.toLowerCase().replace('’', "'")

export function wordDiff(expectedText: string, actualText: string): DiffItem[] {
  const expected = tokenize(expectedText)
  const actual = tokenize(actualText)
  const rows = expected.length + 1
  const columns = actual.length + 1
  const cost = Array.from({ length: rows }, () => Array<number>(columns).fill(0))
  for (let i = 0; i < rows; i += 1) cost[i][0] = i
  for (let j = 0; j < columns; j += 1) cost[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const substitution = normalize(expected[i - 1]) === normalize(actual[j - 1]) ? 0 : 1
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + substitution)
    }
  }
  const output: DiffItem[] = []
  let i = expected.length
  let j = actual.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && normalize(expected[i - 1]) === normalize(actual[j - 1]) && cost[i][j] === cost[i - 1][j - 1]) {
      output.push({ type: 'equal', expected: expected[i - 1], actual: actual[j - 1] }); i -= 1; j -= 1
    } else if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + 1) {
      output.push({ type: 'replace', expected: expected[i - 1], actual: actual[j - 1] }); i -= 1; j -= 1
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      output.push({ type: 'missing', expected: expected[i - 1] }); i -= 1
    } else {
      output.push({ type: 'extra', actual: actual[j - 1] }); j -= 1
    }
  }
  return output.reverse()
}
