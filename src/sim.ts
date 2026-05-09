import { allTeamCodes, fixtures, teamByCode, teamOrder, teams } from './data'
import type {
  ChanceLabel,
  EnumerationResult,
  Fixture,
  OddsMode,
  OutcomeSummary,
  QualificationTarget,
  StandingRow,
  Team,
  TeamCode,
  WinnerMap,
} from './types'

export function emptyWinners(): WinnerMap {
  return Object.fromEntries(fixtures.map((fixture) => [fixture.id, ''])) as WinnerMap
}

export function cloneWinners(winners: WinnerMap): WinnerMap {
  return { ...winners }
}

export function sortStandings<T extends Pick<Team, 'points' | 'nrr' | 'code'>>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.nrr !== a.nrr) return b.nrr - a.nrr
    return (teamOrder.get(a.code) ?? 99) - (teamOrder.get(b.code) ?? 99)
  })
}

export function applyScenario(winners: WinnerMap): StandingRow[] {
  const rows = new Map(
    teams.map((team) => [
      team.code,
      {
        ...team,
        predictedPlayed: team.played,
        predictedWon: team.won,
        predictedLost: team.lost,
        predictedPoints: team.points,
        scenarioWins: 0,
        scenarioLosses: 0,
      },
    ]),
  )

  fixtures.forEach((fixture) => {
    const winner = winners[fixture.id]
    if (!winner) return

    const loser = winner === fixture.home ? fixture.away : fixture.home
    const winnerRow = rows.get(winner)
    const loserRow = rows.get(loser)
    if (!winnerRow || !loserRow) return

    winnerRow.predictedPlayed += 1
    winnerRow.predictedWon += 1
    winnerRow.predictedPoints += 2
    winnerRow.scenarioWins += 1
    loserRow.predictedPlayed += 1
    loserRow.predictedLost += 1
    loserRow.scenarioLosses += 1
  })

  return sortStandings(
    Array.from(rows.values()).map((row) => ({
      ...row,
      played: row.predictedPlayed,
      won: row.predictedWon,
      lost: row.predictedLost,
      points: row.predictedPoints,
    })),
  )
}

export function rankOf(table: Array<Pick<Team, 'code'>>, code: TeamCode) {
  return table.findIndex((row) => row.code === code) + 1
}

export function remainingForTeam(code: TeamCode) {
  return fixtures.filter((fixture) => fixture.home === code || fixture.away === code)
}

export function maxPointsFor(code: TeamCode, winners: WinnerMap) {
  const team = teamByCode.get(code)!
  const selectedWins = fixtures.filter((fixture) => winners[fixture.id] === code).length
  const openTeamMatches = remainingForTeam(code).filter((fixture) => !winners[fixture.id]).length
  return team.points + (selectedWins + openTeamMatches) * 2
}

export function getMatchProbability(fixture: Fixture, mode: OddsMode) {
  if (mode === 'equal') return 0.5

  const home = teamByCode.get(fixture.home)!
  const away = teamByCode.get(fixture.away)!
  const homeStrength = home.points + home.nrr * 2 + home.won * 0.35
  const awayStrength = away.points + away.nrr * 2 + away.won * 0.35
  const raw = 0.5 + (homeStrength - awayStrength) / 24
  return Math.min(0.82, Math.max(0.18, raw))
}

export function enumerateAll(winners: WinnerMap, oddsMode: OddsMode = 'equal'): EnumerationResult {
  const undecided = fixtures.filter((fixture) => !winners[fixture.id])
  const fixedWins = new Map<TeamCode, number>(allTeamCodes.map((code) => [code, 0]))
  fixtures.forEach((fixture) => {
    const winner = winners[fixture.id]
    if (winner) fixedWins.set(winner, (fixedWins.get(winner) ?? 0) + 1)
  })
  const summaries = new Map<TeamCode, OutcomeSummary>(
    allTeamCodes.map((code) => [
      code,
      {
        total: 0,
        top4: 0,
        top2: 0,
        minWinsTop4: Number.POSITIVE_INFINITY,
        minWinsTop2: Number.POSITIVE_INFINITY,
        bestRank: 10,
        worstRank: 1,
        sampleTop4: null,
        sampleTop2: null,
      },
    ]),
  )
  const odds = new Map<TeamCode, { top4: number; top2: number }>(
    allTeamCodes.map((code) => [code, { top4: 0, top2: 0 }]),
  )

  function visit(
    index: number,
    scenario: WinnerMap,
    probability: number,
    addedWins: Map<TeamCode, number>,
  ) {
    if (index === undecided.length) {
      const merged = { ...winners, ...scenario }
      const table = applyScenario(merged)

      allTeamCodes.forEach((code) => {
        const summary = summaries.get(code)!
        const rank = rankOf(table, code)
        const scenarioWins = (fixedWins.get(code) ?? 0) + (addedWins.get(code) ?? 0)
        const teamOdds = odds.get(code)!

        summary.total += 1
        summary.bestRank = Math.min(summary.bestRank, rank)
        summary.worstRank = Math.max(summary.worstRank, rank)

        if (rank <= 4) {
          summary.top4 += 1
          summary.minWinsTop4 = Math.min(summary.minWinsTop4, scenarioWins)
          teamOdds.top4 += probability
          if (!summary.sampleTop4 || scenarioWins === summary.minWinsTop4) summary.sampleTop4 = merged
        }

        if (rank <= 2) {
          summary.top2 += 1
          summary.minWinsTop2 = Math.min(summary.minWinsTop2, scenarioWins)
          teamOdds.top2 += probability
          if (!summary.sampleTop2 || scenarioWins === summary.minWinsTop2) summary.sampleTop2 = merged
        }
      })
      return
    }

    const fixture = undecided[index]
    const homeProbability = getMatchProbability(fixture, oddsMode)
    const homeWins = new Map(addedWins)
    homeWins.set(fixture.home, (homeWins.get(fixture.home) ?? 0) + 1)
    visit(
      index + 1,
      { ...scenario, [fixture.id]: fixture.home },
      probability * homeProbability,
      homeWins,
    )

    const awayWins = new Map(addedWins)
    awayWins.set(fixture.away, (awayWins.get(fixture.away) ?? 0) + 1)
    visit(
      index + 1,
      { ...scenario, [fixture.id]: fixture.away },
      probability * (1 - homeProbability),
      awayWins,
    )
  }

  visit(0, {}, 1, new Map())
  return { summaries, odds, openCount: undecided.length }
}

export function chanceLabel(top4Ratio: number, top4Count: number, total: number): ChanceLabel {
  if (total > 0 && top4Count === total) return 'safe'
  if (top4Ratio <= 0) return 'out'
  if (top4Ratio >= 0.7) return 'alive'
  if (top4Ratio >= 0.3) return 'hunt'
  return 'brink'
}

export function chanceLabelText(label: ChanceLabel) {
  switch (label) {
    case 'safe':
      return 'Through to playoffs'
    case 'alive':
      return 'Still in the hunt'
    case 'hunt':
      return 'In the mix'
    case 'brink':
      return 'On the brink'
    case 'out':
      return 'Out of the race'
  }
}

export function chanceLabelTagline(label: ChanceLabel) {
  switch (label) {
    case 'safe':
      return 'A playoff seat is locked. Now it’s about top two.'
    case 'alive':
      return 'A clean run home and a top-four berth is theirs.'
    case 'hunt':
      return 'It’s narrow but real. Every result counts now.'
    case 'brink':
      return 'A loss away from being out. Survival math only.'
    case 'out':
      return 'Mathematically eliminated under the current picks.'
  }
}

export function getTeamQualification(code: TeamCode, enumeration: EnumerationResult) {
  const summary = enumeration.summaries.get(code)!
  const odds = enumeration.odds.get(code) ?? { top4: 0, top2: 0 }
  const top4ScenarioRatio = summary.total ? summary.top4 / summary.total : 0
  const top2ScenarioRatio = summary.total ? summary.top2 / summary.total : 0

  return {
    summary,
    top4Chance: odds.top4,
    top2Chance: odds.top2,
    top4ScenarioRatio,
    top2ScenarioRatio,
    label: chanceLabel(odds.top4, summary.top4, summary.total),
  }
}

export function getHelpfulResults(
  selectedTeam: TeamCode,
  sample: WinnerMap | null,
  winners: WinnerMap,
) {
  if (!sample) return []
  return fixtures
    .filter(
      (fixture) =>
        !winners[fixture.id] && fixture.home !== selectedTeam && fixture.away !== selectedTeam,
    )
    .map((fixture) => ({
      fixture,
      winner: sample[fixture.id],
    }))
    .filter((item) => item.winner)
    .slice(0, 6)
}

export function explainTeam(
  selectedTeam: TeamCode,
  winners: WinnerMap,
  enumeration: EnumerationResult,
) {
  const team = teamByCode.get(selectedTeam)!
  const summary = enumeration.summaries.get(selectedTeam)!
  const remaining = remainingForTeam(selectedTeam)
  const selectedWins = fixtures.filter((fixture) => winners[fixture.id] === selectedTeam).length
  const openTeamMatches = remaining.filter((fixture) => !winners[fixture.id]).length
  const maxPoints = maxPointsFor(selectedTeam, winners)
  const projected = applyScenario(winners)
  const currentProjectedRank = rankOf(projected, selectedTeam)
  const qualification = getTeamQualification(selectedTeam, enumeration)

  const mustWin =
    summary.top4 > 0 && Number.isFinite(summary.minWinsTop4)
      ? Math.max(0, summary.minWinsTop4 - selectedWins)
      : openTeamMatches + 1

  const top2MustWin =
    summary.top2 > 0 && Number.isFinite(summary.minWinsTop2)
      ? Math.max(0, summary.minWinsTop2 - selectedWins)
      : openTeamMatches + 1

  const projectedSelf = projected.find((row) => row.code === selectedTeam)
  const rivals = projected
    .filter((row) => row.code !== selectedTeam)
    .filter((row) => Math.abs(row.points - (projectedSelf?.points ?? 0)) <= 4)
    .slice(0, 4)

  // NRR exposure: are any rivals tied on points within ±2?
  const tieRisk = projected.filter(
    (row) => row.code !== selectedTeam && row.points === (projectedSelf?.points ?? 0),
  )

  return {
    team,
    remaining,
    selectedWins,
    openTeamMatches,
    maxPoints,
    currentProjectedRank,
    ratio: qualification.top4ScenarioRatio,
    ratio2: qualification.top2ScenarioRatio,
    top4Chance: qualification.top4Chance,
    top2Chance: qualification.top2Chance,
    weightedTop4: qualification.top4Chance,
    weightedTop2: qualification.top2Chance,
    label: qualification.label,
    bestRank: summary.bestRank,
    worstRank: summary.worstRank,
    minTotalWins: summary.minWinsTop4,
    minTop2Wins: summary.minWinsTop2,
    mustWin,
    top2MustWin,
    sampleNeeds: getHelpfulResults(selectedTeam, summary.sampleTop4, winners),
    totalScenarios: summary.total,
    qualifyingScenarios: summary.top4,
    top2Scenarios: summary.top2,
    rivals,
    tieRisk,
    projectedSelf,
  }
}

export type StatusItem = {
  code: TeamCode
  state: ChanceLabel
  topFourPct: number
  topTwoPct: number
  pointsNow: number
  maxPts: number
  needed: number | null
}

export function getStatusBoard(
  winners: WinnerMap,
  enumeration: EnumerationResult,
): StatusItem[] {
  return allTeamCodes.map((code) => {
    const summary = enumeration.summaries.get(code)!
    const team = teamByCode.get(code)!
    const qualification = getTeamQualification(code, enumeration)
    const selectedWins = fixtures.filter((fixture) => winners[fixture.id] === code).length
    const needed = Number.isFinite(summary.minWinsTop4)
      ? Math.max(0, summary.minWinsTop4 - selectedWins)
      : null
    return {
      code,
      state: qualification.label,
      topFourPct: qualification.top4Chance * 100,
      topTwoPct: qualification.top2Chance * 100,
      pointsNow: team.points,
      maxPts: maxPointsFor(code, winners),
      needed,
    }
  })
}

export function getMatchImportance(winners: WinnerMap) {
  return fixtures
    .filter((fixture) => !winners[fixture.id])
    .map((fixture) => {
      const homeTable = applyScenario({ ...winners, [fixture.id]: fixture.home })
      const awayTable = applyScenario({ ...winners, [fixture.id]: fixture.away })
      const changedTeams = allTeamCodes.filter((code) => {
        const homeRank = rankOf(homeTable, code)
        const awayRank = rankOf(awayTable, code)
        return (homeRank <= 4) !== (awayRank <= 4) || (homeRank <= 2) !== (awayRank <= 2)
      })

      return {
        fixture,
        score: changedTeams.length,
        changedTeams,
      }
    })
    .sort((a, b) => b.score - a.score || a.fixture.id - b.fixture.id)
}

/**
 * Compute who an `myTeam` fan should root for in `fixture` —
 * returns the side whose win raises my team's top-4 odds the most.
 */
export function rootingSide(
  myTeam: TeamCode,
  fixture: Fixture,
  winners: WinnerMap,
  oddsMode: OddsMode,
) {
  if (fixture.home === myTeam || fixture.away === myTeam) {
    // It's my team's match — root for my team.
    return {
      side: myTeam,
      odds: { with: 1, without: 0 },
      delta: 1,
      isMyMatch: true,
    }
  }
  const homeWinners = { ...winners, [fixture.id]: fixture.home }
  const awayWinners = { ...winners, [fixture.id]: fixture.away }
  const homeOdds = enumerateAll(homeWinners, oddsMode).odds.get(myTeam)?.top4 ?? 0
  const awayOdds = enumerateAll(awayWinners, oddsMode).odds.get(myTeam)?.top4 ?? 0
  const side = homeOdds >= awayOdds ? fixture.home : fixture.away
  const win = Math.max(homeOdds, awayOdds)
  const lose = Math.min(homeOdds, awayOdds)
  return { side, odds: { with: win, without: lose }, delta: win - lose, isMyMatch: false }
}

export function nextUnsetFixture(winners: WinnerMap): Fixture | null {
  return fixtures.find((fixture) => !winners[fixture.id]) ?? null
}

export function makeSolverScenario(
  selectedTeam: TeamCode,
  winners: WinnerMap,
  target: 'top4' | 'top2',
) {
  const { summaries } = enumerateAll(winners, 'equal')
  const summary = summaries.get(selectedTeam)!
  const sample = target === 'top2' ? summary.sampleTop2 : summary.sampleTop4
  if (!sample) return null
  return cloneWinners(sample)
}

/**
 * Solve both top-4 and top-2 paths from a single enumeration pass.
 * Returns null for either if no path exists. Used by the auto-solver UI to
 * pre-compute possibility for the goal toggle without re-enumerating.
 */
export function makeBothSolverScenarios(
  selectedTeam: TeamCode,
  winners: WinnerMap,
): { top4Minimum: WinnerMap | null; top4Safest: WinnerMap | null; top2: WinnerMap | null } {
  return {
    top4Minimum: findSolverScenario(selectedTeam, winners, 'top4', 'minimum'),
    top4Safest: findSolverScenario(selectedTeam, winners, 'top4', 'safest'),
    top2: findSolverScenario(selectedTeam, winners, 'top2', 'safest'),
  }
}

function findSolverScenario(
  selectedTeam: TeamCode,
  winners: WinnerMap,
  target: QualificationTarget,
  mode: 'minimum' | 'safest',
) {
  const undecided = fixtures.filter((fixture) => !winners[fixture.id])
  let bestScenario: WinnerMap | null = null
  let bestScore = Number.POSITIVE_INFINITY

  function scoreScenario(scenario: WinnerMap) {
    const table = applyScenario(scenario)
    const rank = rankOf(table, selectedTeam)
    if ((target === 'top4' && rank > 4) || (target === 'top2' && rank > 2)) return null

    const myWins = fixtures.filter((fixture) => scenario[fixture.id] === selectedTeam).length
    const row = table.find((item) => item.code === selectedTeam)
    const points = row?.points ?? 0

    if (mode === 'minimum') {
      return myWins * 10_000 + rank * 100 - points
    }
    return rank * 10_000 - points * 100 - myWins
  }

  function visit(index: number, scenario: WinnerMap) {
    if (index === undecided.length) {
      const merged = { ...winners, ...scenario }
      const score = scoreScenario(merged)
      if (score === null) return
      if (score < bestScore) {
        bestScenario = merged
        bestScore = score
      }
      return
    }

    const fixture = undecided[index]
    visit(index + 1, { ...scenario, [fixture.id]: fixture.home })
    visit(index + 1, { ...scenario, [fixture.id]: fixture.away })
  }

  visit(0, {})
  return bestScenario ? cloneWinners(bestScenario) : null
}

export function chooseFavoritesScenario(): WinnerMap {
  return Object.fromEntries(
    fixtures.map((fixture) => {
      const home = teamByCode.get(fixture.home)!
      const away = teamByCode.get(fixture.away)!
      const winner = getMatchProbability(fixture, 'weighted') >= 0.5 ? home.code : away.code
      return [fixture.id, winner]
    }),
  ) as WinnerMap
}
