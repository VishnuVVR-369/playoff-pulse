import { allTeamCodes, fixtures } from './data'
import type { TeamCode, WinnerMap } from './types'

export function formatNrr(nrr: number) {
  return `${nrr >= 0 ? '+' : ''}${nrr.toFixed(3)}`
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%'
  if (value > 0 && value < 0.01) return '<1%'
  if (value > 0.995 && value < 1) return '99%'
  return `${Math.round(value * 100)}%`
}

export function formatBigNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return value.toLocaleString()
}

/**
 * URL state — encode the winners map as a compact base-11 string.
 * Each fixture id maps to a position; '0' = unset, '1'..'A' = team index in allTeamCodes.
 */
const SHARE_KEY = 's'

function teamCharFor(code: TeamCode) {
  const idx = allTeamCodes.indexOf(code)
  if (idx < 0) return '0'
  // 1..10 → '1'..'9','A'
  return idx < 9 ? String(idx + 1) : 'A'
}

function teamFromChar(ch: string): TeamCode | '' {
  if (ch === '0') return ''
  const idx = ch === 'A' ? 9 : parseInt(ch, 10) - 1
  return allTeamCodes[idx] ?? ''
}

export function encodeWinnersToUrl(winners: WinnerMap): string {
  return fixtures.map((fixture) => teamCharFor(winners[fixture.id] as TeamCode)).join('')
}

export function decodeWinnersFromUrl(value: string | null, base: WinnerMap): WinnerMap {
  if (!value) return base
  const next: WinnerMap = { ...base }
  fixtures.forEach((fixture, index) => {
    const ch = value[index] ?? '0'
    next[fixture.id] = teamFromChar(ch)
  })
  return next
}

export function readScenarioFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get(SHARE_KEY)
}

export function writeScenarioToUrl(winners: WinnerMap) {
  if (typeof window === 'undefined') return
  const value = encodeWinnersToUrl(winners)
  const url = new URL(window.location.href)
  const empty = value.split('').every((c) => c === '0')
  if (empty) {
    url.searchParams.delete(SHARE_KEY)
  } else {
    url.searchParams.set(SHARE_KEY, value)
  }
  window.history.replaceState(null, '', url.toString())
}

export function buildShareUrl(winners: WinnerMap, myTeam: TeamCode | null) {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.search = ''
  const value = encodeWinnersToUrl(winners)
  const empty = value.split('').every((c) => c === '0')
  if (!empty) url.searchParams.set(SHARE_KEY, value)
  if (myTeam) url.searchParams.set('t', myTeam)
  return url.toString()
}

const TEAM_KEY = 'pp.myTeam'
const PROMPT_KEY = 'pp.dismissedPrompt'

export function readMyTeam(): TeamCode | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(TEAM_KEY)
  if (!raw) return null
  if ((allTeamCodes as string[]).includes(raw)) return raw as TeamCode
  return null
}

export function writeMyTeam(code: TeamCode | null) {
  if (typeof window === 'undefined') return
  if (code) window.localStorage.setItem(TEAM_KEY, code)
  else window.localStorage.removeItem(TEAM_KEY)
}

export function writeMyTeamToUrl(code: TeamCode | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (code) url.searchParams.set('t', code)
  else url.searchParams.delete('t')
  window.history.replaceState(null, '', url.toString())
}

export function readDismissedPrompt(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(PROMPT_KEY) === '1'
}

export function writeDismissedPrompt() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROMPT_KEY, '1')
}

export function readMyTeamFromUrl(): TeamCode | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('t')
  if (raw && (allTeamCodes as string[]).includes(raw)) return raw as TeamCode
  return null
}
