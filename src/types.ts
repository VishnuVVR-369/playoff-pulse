export type TeamCode =
  | 'SRH'
  | 'PBKS'
  | 'RCB'
  | 'RR'
  | 'GT'
  | 'CSK'
  | 'KKR'
  | 'DC'
  | 'MI'
  | 'LSG'

export type Team = {
  code: TeamCode
  name: string
  short: string
  played: number
  won: number
  lost: number
  ties: number
  noResult: number
  points: number
  nrr: number
  color: string
  ink: string
}

export type Fixture = {
  id: number
  date: string
  venue: string
  home: TeamCode
  away: TeamCode
}

export type WinnerMap = Record<number, TeamCode | ''>

export type StandingRow = Team & {
  scenarioWins: number
  scenarioLosses: number
}

export type ChanceLabel = 'safe' | 'alive' | 'hunt' | 'brink' | 'out'
export type QualificationTarget = 'top4' | 'top2'
export type SolverMode = 'safest' | 'minimum'
export type OddsMode = 'equal' | 'weighted'

export type OutcomeSummary = {
  total: number
  top4: number
  top2: number
  minWinsTop4: number
  minWinsTop2: number
  bestRank: number
  worstRank: number
  sampleTop4: WinnerMap | null
  sampleTop2: WinnerMap | null
}

export type EnumerationResult = {
  summaries: Map<TeamCode, OutcomeSummary>
  odds: Map<TeamCode, { top4: number; top2: number }>
  openCount: number
}
