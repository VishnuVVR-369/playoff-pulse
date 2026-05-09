import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  AnimatedNumber,
  ChanceBadge,
  Eyebrow,
  PulseLine,
  TeamMonogram,
  tensionFromOdds,
} from './components'
import { allTeamCodes, fixtures, lastUpdated, sources, teamByCode, teams } from './data'
import {
  applyScenario,
  chanceLabelTagline,
  chanceLabelText,
  chooseFavoritesScenario,
  emptyWinners,
  enumerateAll,
  explainTeam,
  getMatchImportance,
  getStatusBoard,
  getTeamQualification,
  makeBothSolverScenarios,
  remainingForTeam,
  rootingSide,
} from './sim'
import type {
  ChanceLabel,
  Fixture,
  OddsMode,
  QualificationTarget,
  SolverMode,
  StandingRow,
  Team,
  TeamCode,
  WinnerMap,
} from './types'
import {
  buildShareUrl,
  decodeWinnersFromUrl,
  formatBigNumber,
  formatNrr,
  formatPercent,
  readDismissedPrompt,
  readMyTeam,
  readMyTeamFromUrl,
  readScenarioFromUrl,
  writeDismissedPrompt,
  writeMyTeam,
  writeMyTeamToUrl,
  writeScenarioToUrl,
} from './utils'

/* ============================================================== */
/*                              APP                                */
/* ============================================================== */

type SolverApplied = {
  goal: QualificationTarget
  mode: SolverMode
  before: WinnerMap
  top4MinimumPath: WinnerMap | null
  top4SafestPath: WinnerMap | null
  top2Path: WinnerMap | null
}

type PickNotice = {
  matchId: number
  team: TeamCode
  previous: TeamCode | ''
  label: string
}

export default function App() {
  const [winners, setWinnersState] = useState<WinnerMap>(() => {
    const fromUrl = readScenarioFromUrl()
    return decodeWinnersFromUrl(fromUrl, emptyWinners())
  })
  const [myTeam, setMyTeamState] = useState<TeamCode | null>(() => {
    return readMyTeamFromUrl() ?? readMyTeam() ?? null
  })
  const [oddsMode, setOddsMode] = useState<OddsMode>('weighted')
  const [target, setTarget] = useState<QualificationTarget>('top4')
  const [solverMode, setSolverMode] = useState<SolverMode>('safest')
  const [showAllFixtures, setShowAllFixtures] = useState(false)
  const [showStandings, setShowStandings] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [skippedFixtures, setSkippedFixtures] = useState<Set<number>>(() => new Set())
  const [picking, setPicking] = useState(false)
  const [softPromptDismissed, setSoftPromptDismissed] = useState(() => readDismissedPrompt())
  const [shareToast, setShareToast] = useState(false)
  const [pickNotice, setPickNotice] = useState<PickNotice | null>(null)
  const [solverApplied, setSolverApplied] = useState<SolverApplied | null>(null)

  // Wraps setWinners — manual edits invalidate the "solver applied" state.
  const setWinners: typeof setWinnersState = (next) => {
    setSolverApplied(null)
    setWinnersState(next)
  }

  const setMyTeam = (code: TeamCode | null) => {
    setMyTeamState(code)
    writeMyTeam(code)
    writeMyTeamToUrl(code)
  }

  function resetScenarioSelections() {
    setWinnersState(emptyWinners())
    setSkippedFixtures(new Set())
    setSolverApplied(null)
    setPickNotice(null)
  }

  function changeSupportingTeam(code: TeamCode | null) {
    if (code !== myTeam) resetScenarioSelections()
    setMyTeam(code)
  }

  // URL persistence — debounce-ish via effect
  useEffect(() => {
    writeScenarioToUrl(winners)
  }, [winners])

  const enumeration = useMemo(() => enumerateAll(winners, oddsMode), [winners, oddsMode])
  const predictedStandings = useMemo(() => applyScenario(winners), [winners])
  const realStandings = useMemo(() => applyScenario(emptyWinners()), [])
  const status = useMemo(() => getStatusBoard(winners, enumeration), [winners, enumeration])
  const importance = useMemo(() => getMatchImportance(winners), [winners])

  const explanation = useMemo(
    () => (myTeam ? explainTeam(myTeam, winners, enumeration) : null),
    [myTeam, winners, enumeration],
  )

  const upcoming = useMemo(
    () => fixtures.find((fixture) => !winners[fixture.id] && !skippedFixtures.has(fixture.id)) ?? null,
    [winners, skippedFixtures],
  )
  const pickedMatches = fixtures.filter((fixture) => winners[fixture.id]).length
  const isComplete = pickedMatches === fixtures.length

  function setWinner(matchId: number, winner: TeamCode | '', options?: { silent?: boolean }) {
    setWinners((current) => {
      const previous = current[matchId] ?? ''
      if (winner && !options?.silent) {
        const fixture = fixtures.find((item) => item.id === matchId)
        const team = teamByCode.get(winner)!
        setPickNotice({
          matchId,
          team: winner,
          previous,
          label: fixture ? `M${fixture.id} ${team.code} marked winner` : `${team.code} marked winner`,
        })
        window.setTimeout(() => {
          setPickNotice((notice) => (notice?.matchId === matchId && notice.team === winner ? null : notice))
        }, 3600)
      }
      return { ...current, [matchId]: winner }
    })
  }

  function onShare() {
    const url = buildShareUrl(winners, myTeam)
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setShareToast(true)
        setTimeout(() => setShareToast(false), 2400)
      })
    }
  }

  function undoLastPick() {
    if (!pickNotice) return
    setWinner(pickNotice.matchId, pickNotice.previous, { silent: true })
    setPickNotice(null)
  }

  function onChooseFavorites() {
    setWinners(chooseFavoritesScenario())
  }

  function onReset() {
    setWinners(emptyWinners())
    setSkippedFixtures(new Set())
  }

  function onApplySolver(goalOverride?: QualificationTarget, modeOverride?: SolverMode) {
    if (!myTeam) return
    const goal = goalOverride ?? target
    const mode = modeOverride ?? solverMode

    // If we're already in applied state, re-solve from the snapshot — not from
    // the (now fully-decided) current scenario. This makes the goal toggle work
    // intuitively: clicking Top 2 after solving Top 4 should plot a fresh path.
    let baseWinners: WinnerMap
    let paths: { top4Minimum: WinnerMap | null; top4Safest: WinnerMap | null; top2: WinnerMap | null }
    if (solverApplied) {
      baseWinners = solverApplied.before
      paths = {
        top4Minimum: solverApplied.top4MinimumPath,
        top4Safest: solverApplied.top4SafestPath,
        top2: solverApplied.top2Path,
      }
    } else {
      baseWinners = { ...winners }
      paths = makeBothSolverScenarios(myTeam, baseWinners)
    }

    const solved = goal === 'top2' ? paths.top2 : mode === 'minimum' ? paths.top4Minimum : paths.top4Safest
    if (!solved) return

    if (goalOverride && goalOverride !== target) setTarget(goalOverride)
    if (modeOverride && modeOverride !== solverMode) setSolverMode(modeOverride)
    setWinnersState(solved)
    setSolverApplied({
      goal,
      mode,
      before: baseWinners,
      top4MinimumPath: paths.top4Minimum,
      top4SafestPath: paths.top4Safest,
      top2Path: paths.top2,
    })
  }

  function onUndoSolver() {
    if (!solverApplied) return
    setWinnersState(solverApplied.before)
    setSolverApplied(null)
  }

  function dismissSoftPrompt() {
    setSoftPromptDismissed(true)
    writeDismissedPrompt()
  }

  return (
    <div className="shell">
      <TopBar
        myTeam={myTeam}
        onOpenPicker={() => setPicking(true)}
        onReset={onReset}
        onShare={onShare}
        shareToast={shareToast}
        progress={pickedMatches / fixtures.length}
      />

      <main className="page">
        <Hero
          myTeam={myTeam}
          explanation={explanation}
          totalCombos={
            myTeam
              ? enumeration.summaries.get(myTeam)!.total
              : Math.max(...allTeamCodes.map((c) => enumeration.summaries.get(c)!.total))
          }
          status={status}
          openCount={enumeration.openCount}
          oddsMode={oddsMode}
          setOddsMode={setOddsMode}
          onScrollToFixtures={() => {
            document.getElementById('fixtures-section')?.scrollIntoView({ behavior: 'smooth' })
          }}
          onPickTeam={() => setPicking(true)}
        />

        <NextActionStrip
          myTeam={myTeam}
          upcoming={upcoming}
          picked={pickedMatches}
          total={fixtures.length}
          onPickTeam={() => setPicking(true)}
          onScrollToFixtures={() => {
            document.getElementById('fixtures-section')?.scrollIntoView({ behavior: 'smooth' })
          }}
          onScrollToSolver={() => {
            document.getElementById('solver-section')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />

        {!myTeam && !softPromptDismissed && (
          <SoftPrompt onPick={() => setPicking(true)} onDismiss={dismissSoftPrompt} />
        )}

        {upcoming && (
          <LastResultStrip
            fixture={upcoming}
            onPick={(code) => setWinner(upcoming.id, code)}
            onSkip={() => setSkippedFixtures((current) => new Set(current).add(upcoming.id))}
            picked={pickedMatches}
            total={fixtures.length}
          />
        )}

        {myTeam && upcoming && (
          <RootingSection
            myTeam={myTeam}
            fixture={upcoming}
            winners={winners}
            oddsMode={oddsMode}
            onPick={(code) => setWinner(upcoming.id, code)}
          />
        )}

        {myTeam && (
          <YourTeamRoadSection
            myTeam={myTeam}
            winners={winners}
            onPick={(matchId, code) => setWinner(matchId, code)}
            onClear={(matchId) => setWinner(matchId, '')}
            showAllFixtures={showAllFixtures}
            onToggleAll={() => setShowAllFixtures((v) => !v)}
          />
        )}

        {myTeam && (
          <AutoSolverSection
            myTeam={myTeam}
            target={target}
            setTarget={setTarget}
            solverMode={solverMode}
            setSolverMode={setSolverMode}
            winners={winners}
            applied={solverApplied}
            enumeration={enumeration}
            onApply={onApplySolver}
            onUndo={onUndoSolver}
          />
        )}

        <StatusBoardSection
          status={status}
          myTeam={myTeam}
          onSelectTeam={(code) => {
            if (code === myTeam) changeSupportingTeam(null)
            else changeSupportingTeam(code)
          }}
          oddsMode={oddsMode}
        />

        {!myTeam && (
          <YourTeamRoadSection
            myTeam={myTeam}
            winners={winners}
            onPick={(matchId, code) => setWinner(matchId, code)}
            onClear={(matchId) => setWinner(matchId, '')}
            showAllFixtures={showAllFixtures}
            onToggleAll={() => setShowAllFixtures((v) => !v)}
          />
        )}

        <GamesToWatchSection importance={importance} winners={winners} onPick={setWinner} />

        <OddsChartSection enumeration={enumeration} myTeam={myTeam} oddsMode={oddsMode} />

        <ToolsDisclosure
          open={showTools}
          onToggle={() => setShowTools((v) => !v)}
          oddsMode={oddsMode}
          setOddsMode={setOddsMode}
          onChooseFavorites={onChooseFavorites}
          onReset={onReset}
          onShare={onShare}
        />

        <StandingsDisclosure
          open={showStandings}
          onToggle={() => setShowStandings((v) => !v)}
          real={realStandings}
          predicted={predictedStandings}
          isComplete={isComplete}
        />

        <SiteFooter />
      </main>

      {picking && (
        <TeamPicker
          current={myTeam}
          onPick={(code) => {
            changeSupportingTeam(code)
            setPicking(false)
          }}
          onClear={() => {
            changeSupportingTeam(null)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {pickNotice && (
        <PickToast notice={pickNotice} onUndo={undoLastPick} onDismiss={() => setPickNotice(null)} />
      )}
    </div>
  )
}

/* ============================================================== */
/*                            TOP BAR                              */
/* ============================================================== */

function TopBar({
  myTeam,
  onOpenPicker,
  onReset,
  onShare,
  shareToast,
  progress,
}: {
  myTeam: TeamCode | null
  onOpenPicker: () => void
  onReset: () => void
  onShare: () => void
  shareToast: boolean
  progress: number
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span className="brand-dot" />
            <span className="brand-dot" />
            <span className="brand-dot" />
          </span>
          <span className="brand-name">
            <span>Playoff</span>
            <em>Pulse</em>
          </span>
        </div>

        <div className="topbar-actions">
          <button className="topbar-team" type="button" onClick={onOpenPicker}>
            {myTeam ? (
              <>
                <TeamMonogram code={myTeam} size="xs" />
                <span className="topbar-team-label">
                  <span>Supporting</span>
                  <strong>{myTeam}</strong>
                </span>
              </>
            ) : (
              <>
                <span className="topbar-team-empty" aria-hidden />
                <span className="topbar-team-label">
                  <span>Pick your</span>
                  <strong>team</strong>
                </span>
              </>
            )}
            <span className="topbar-caret" aria-hidden>
              ▾
            </span>
          </button>

          <button className="topbar-reset" type="button" onClick={onReset} aria-label="Reset all picks">
            <ResetIcon />
            <span className="topbar-reset-label">Reset</span>
          </button>

          <button className="topbar-share" type="button" onClick={onShare} aria-label="Copy share link">
            <ShareIcon />
            <span className="topbar-share-label">Share</span>
          </button>
        </div>
      </div>

      {progress > 0 && (
        <div className="topbar-progress" aria-hidden>
          <div className="topbar-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {shareToast && (
        <div className="toast" role="status">
          Scenario link copied — team and picks are included
        </div>
      )}
    </header>
  )
}

function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M15 9l-6 6" />
      <path d="M9 9l6 6" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}

/* ============================================================== */
/*                              HERO                               */
/* ============================================================== */

type ExplainResult = ReturnType<typeof explainTeam>

function Hero({
  myTeam,
  explanation,
  totalCombos,
  status,
  openCount,
  oddsMode,
  setOddsMode,
  onScrollToFixtures,
  onPickTeam,
}: {
  myTeam: TeamCode | null
  explanation: ExplainResult | null
  totalCombos: number
  status: ReturnType<typeof getStatusBoard>
  openCount: number
  oddsMode: OddsMode
  setOddsMode: (mode: OddsMode) => void
  onScrollToFixtures: () => void
  onPickTeam: () => void
}) {
  const team = myTeam ? teamByCode.get(myTeam)! : null
  const tension = explanation
    ? tensionFromOdds(explanation.top4Chance)
    : 0.5
  const headline = explanation ? chanceLabelText(explanation.label) : 'The race for the playoffs'
  const tagline = explanation
    ? chanceLabelTagline(explanation.label)
    : 'Nineteen matches. Ten teams. One league table to crack. Pick your team and find the path.'
  const top4Pct = explanation ? explanation.top4Chance : 0
  const top2Pct = explanation ? explanation.top2Chance : 0

  const aliveCount = status.filter((s) => s.state === 'alive' || s.state === 'safe' || s.state === 'hunt').length
  const onBrinkCount = status.filter((s) => s.state === 'brink').length
  const outCount = status.filter((s) => s.state === 'out').length

  return (
    <section
      className={`hero ${myTeam ? 'hero-team' : 'hero-generic'}`}
      style={team ? ({ '--hero-color': team.color } as React.CSSProperties) : undefined}
    >
      <div className="hero-glow" aria-hidden />
      <div className="hero-content">
        <Eyebrow>
          {myTeam ? `${team!.name}` : 'IPL 2026 — Playoff race'}
        </Eyebrow>

        <h1 className="hero-headline">
          {myTeam ? (
            <>
              <span className="hero-team-name">{team!.short}</span>
              <span className="hero-em">— {headline.toLowerCase()}</span>
            </>
          ) : (
            <>
              <span className="hero-em-light">Who survives</span>
              <span className="hero-team-name">the cut?</span>
            </>
          )}
        </h1>

        <p className="hero-tagline">{tagline}</p>

        <OddsModeInline oddsMode={oddsMode} setOddsMode={setOddsMode} />

        {myTeam ? (
          <div className="hero-stats">
            <div className="stat-block">
              <span className="stat-label">Top-4 chance</span>
              <PercentStatValue value={top4Pct} />
            </div>
            <div className="stat-block">
              <span className="stat-label">Top-2 chance</span>
              <PercentStatValue value={top2Pct} />
            </div>
            <div className="stat-block">
              <span className="stat-label">Must-win count</span>
              <span className="stat-value-small">
                {explanation!.label === 'out'
                  ? 'Eliminated'
                  : explanation!.label === 'safe'
                    ? 'Through'
                    : explanation!.mustWin === 0
                      ? 'Hold serve'
                      : `${explanation!.mustWin} of ${explanation!.openTeamMatches}`}
                <em>
                  {explanation!.label === 'safe'
                    ? 'A playoff seat is locked'
                    : explanation!.label === 'out'
                      ? 'Mathematically out'
                      : explanation!.mustWin === 0
                        ? 'Path exists with zero more wins'
                        : ` matches remaining`}
                </em>
              </span>
            </div>
          </div>
        ) : (
          <div className="hero-stats">
            <div className="stat-block">
              <span className="stat-label">Alive</span>
              <span className="stat-value">
                <AnimatedNumber value={aliveCount} format={(n) => Math.round(n).toString()} />
              </span>
            </div>
            <div className="stat-block">
              <span className="stat-label">On brink</span>
              <span className="stat-value">
                <AnimatedNumber value={onBrinkCount} format={(n) => Math.round(n).toString()} />
              </span>
            </div>
            <div className="stat-block">
              <span className="stat-label">Out</span>
              <span className="stat-value">
                <AnimatedNumber value={outCount} format={(n) => Math.round(n).toString()} />
              </span>
            </div>
          </div>
        )}

        <div className="hero-pulse">
          <PulseLine
            tension={myTeam ? tension : 0.4}
            color={team?.color ?? '#ffc857'}
            flatline={explanation?.label === 'out'}
          />
          <div className="hero-pulse-meta">
            <span>The pulse</span>
            <strong>
              {explanation?.label === 'out'
                ? 'Flatline'
                : explanation?.label === 'safe'
                  ? 'Steady — through to playoffs'
                  : `${Math.round(60 + tension * 110)} bpm — ${tensionLabel(tension)}`}
            </strong>
          </div>
        </div>

        {myTeam ? (
          <div className="hero-cta-row">
            <button type="button" className="btn-primary" onClick={onScrollToFixtures}>
              See {myTeam}'s road
            </button>
            <button type="button" className="btn-ghost" onClick={onPickTeam}>
              Switch team
            </button>
          </div>
        ) : (
          <div className="hero-cta-row">
            <button type="button" className="btn-primary" onClick={onPickTeam}>
              Pick your team
            </button>
            <button type="button" className="btn-ghost" onClick={onScrollToFixtures}>
              Skip, just show me the race
            </button>
          </div>
        )}

        {totalCombos > 0 && (
          <p className="hero-permutations">
            <span>{formatBigNumber(totalCombos)}</span>{' '}
            {totalCombos === 1 ? 'way' : 'ways'} the league still finishes
            {myTeam && explanation && explanation.qualifyingScenarios > 0 && (
              <>
                <span className="hero-perm-divider"> · </span>
                <span>{formatBigNumber(explanation.qualifyingScenarios)}</span>{' '}
                {explanation.qualifyingScenarios === 1 ? 'has' : 'have'} {myTeam} in the top four
              </>
            )}
            {openCount > 0 && (
              <>
                <span className="hero-perm-divider"> · </span>
                <span>{openCount}</span> {openCount === 1 ? 'match' : 'matches'} still to call
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}

function PercentStatValue({ value }: { value: number }) {
  const formatted = formatPercent(value)
  const match = formatted.match(/^(.+)%$/)

  return (
    <span className="stat-value">
      <span>{match ? match[1] : formatted}</span>
      {match && <em>%</em>}
    </span>
  )
}

function OddsModeInline({
  oddsMode,
  setOddsMode,
}: {
  oddsMode: OddsMode
  setOddsMode: (mode: OddsMode) => void
}) {
  return (
    <div className="hero-mode" aria-label="Odds method">
      <span>Odds</span>
      <button
        type="button"
        className={oddsMode === 'weighted' ? 'hero-mode-active' : ''}
        onClick={() => setOddsMode('weighted')}
      >
        Form
      </button>
      <button
        type="button"
        className={oddsMode === 'equal' ? 'hero-mode-active' : ''}
        onClick={() => setOddsMode('equal')}
      >
        50/50
      </button>
    </div>
  )
}

function NextActionStrip({
  myTeam,
  upcoming,
  picked,
  total,
  onPickTeam,
  onScrollToFixtures,
  onScrollToSolver,
}: {
  myTeam: TeamCode | null
  upcoming: Fixture | null
  picked: number
  total: number
  onPickTeam: () => void
  onScrollToFixtures: () => void
  onScrollToSolver: () => void
}) {
  const fixtureLabel = upcoming
    ? `Next: M${upcoming.id} ${upcoming.home} vs ${upcoming.away}`
    : 'All results are filled'

  return (
    <section className="next-action" aria-label="Next action">
      <div className="next-action-copy">
        <span>{picked}/{total} results picked</span>
        <strong>{myTeam ? fixtureLabel : 'Start by choosing your team'}</strong>
      </div>
      <div className="next-action-buttons">
        {!myTeam ? (
          <button type="button" className="btn-primary btn-sm" onClick={onPickTeam}>
            Pick team
          </button>
        ) : (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={onScrollToFixtures}>
              My road
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={onScrollToSolver}>
              Plot path
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function PickToast({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: PickNotice
  onUndo: () => void
  onDismiss: () => void
}) {
  return (
    <div className="pick-toast" role="status">
      <span>{notice.label}</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="pick-toast-close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

function tensionLabel(t: number) {
  if (t >= 0.85) return 'edge of the seat'
  if (t >= 0.6) return 'pulse racing'
  if (t >= 0.35) return 'tense'
  return 'steady'
}

/* ============================================================== */
/*                       SOFT PROMPT BANNER                        */
/* ============================================================== */

function SoftPrompt({ onPick, onDismiss }: { onPick: () => void; onDismiss: () => void }) {
  return (
    <section className="soft-prompt" role="region" aria-label="Pick your team for personalized verdicts">
      <div className="soft-prompt-text">
        <strong>Make it personal.</strong>
        <span>Pick your team and the page becomes a verdict on their season.</span>
      </div>
      <div className="soft-prompt-actions">
        <button type="button" className="btn-primary btn-sm" onClick={onPick}>
          Pick a team
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </section>
  )
}

/* ============================================================== */
/*                       LAST RESULT STRIP                         */
/* ============================================================== */

function LastResultStrip({
  fixture,
  onPick,
  onSkip,
  picked,
  total,
}: {
  fixture: Fixture
  onPick: (code: TeamCode) => void
  onSkip: () => void
  picked: number
  total: number
}) {
  const home = teamByCode.get(fixture.home)!
  const away = teamByCode.get(fixture.away)!
  return (
    <section className="strip strip-result" aria-label="Quick result entry">
      <div className="strip-head">
        <Eyebrow>Quick entry</Eyebrow>
        <span className="strip-progress">
          {picked} of {total} matches called
        </span>
      </div>
      <p className="strip-q">
        Match {fixture.id} — <strong>{home.short}</strong> vs <strong>{away.short}</strong>
        <span className="strip-meta">
          {' '}
          · {fixture.date} · {fixture.venue}
        </span>
      </p>
      <div className="strip-buttons">
        <button
          type="button"
          className="strip-btn"
          style={{ '--c': home.color } as React.CSSProperties}
          onClick={() => onPick(home.code)}
        >
          <TeamMonogram code={home.code} size="sm" />
          <span>{home.code} won</span>
        </button>
        <button
          type="button"
          className="strip-btn"
          style={{ '--c': away.color } as React.CSSProperties}
          onClick={() => onPick(away.code)}
        >
          <TeamMonogram code={away.code} size="sm" />
          <span>{away.code} won</span>
        </button>
        <button type="button" className="strip-skip" onClick={onSkip} aria-label="Skip for now">
          Skip for now
        </button>
      </div>
    </section>
  )
}

/* ============================================================== */
/*                        ROOTING GUIDE                             */
/* ============================================================== */

function RootingSection({
  myTeam,
  fixture,
  winners,
  oddsMode,
  onPick,
}: {
  myTeam: TeamCode
  fixture: Fixture
  winners: WinnerMap
  oddsMode: OddsMode
  onPick: (code: TeamCode) => void
}) {
  const result = useMemo(
    () => rootingSide(myTeam, fixture, winners, oddsMode),
    [myTeam, fixture, winners, oddsMode],
  )
  const home = teamByCode.get(fixture.home)!
  const away = teamByCode.get(fixture.away)!
  const rootFor = teamByCode.get(result.side)!
  const myTeamData = teamByCode.get(myTeam)!

  if (result.isMyMatch) {
    return (
      <section className="rooting rooting-self">
        <Eyebrow>Tonight</Eyebrow>
        <h2 className="rooting-headline">
          It's your night. {home.code} vs {away.code} — and {myTeam} is in it.
        </h2>
        <p className="rooting-body">
          {fixture.date} · {fixture.venue}. Win and the door opens. Lose and the math gets steeper.
        </p>
        <div className="rooting-cta-row">
          <button
            type="button"
            className="btn-team"
            style={{ '--c': home.color } as React.CSSProperties}
            onClick={() => onPick(home.code)}
          >
            <TeamMonogram code={home.code} size="sm" />
            {home.code} win
          </button>
          <button
            type="button"
            className="btn-team"
            style={{ '--c': away.color } as React.CSSProperties}
            onClick={() => onPick(away.code)}
          >
            <TeamMonogram code={away.code} size="sm" />
            {away.code} win
          </button>
        </div>
      </section>
    )
  }

  const deltaPct = Math.round(result.delta * 100)
  const negligible = result.delta < 0.005

  return (
    <section
      className="rooting"
      style={{ '--c': rootFor.color } as React.CSSProperties}
    >
      <Eyebrow>The fan's instruction</Eyebrow>
      <h2 className="rooting-headline">
        {negligible ? (
          <>
            Tonight's match barely moves the needle for {myTeam}.
          </>
        ) : (
          <>
            As a {myTeamData.short} fan, root for{' '}
            <span className="rooting-target">{rootFor.short}</span>.
          </>
        )}
      </h2>
      <p className="rooting-body">
        Match {fixture.id} · {home.short} vs {away.short} · {fixture.date} · {fixture.venue}.
        {!negligible && (
          <>
            {' '}
            If {rootFor.code} win, your top-four chance climbs from{' '}
            <strong>{formatPercent(result.odds.without)}</strong> to{' '}
            <strong>{formatPercent(result.odds.with)}</strong>{' '}
            <span className="rooting-delta">+{deltaPct}pp</span>.
          </>
        )}
        {negligible && ' Either result leaves your odds within a percentage point of where they sit now.'}
      </p>
      <div className="rooting-cta-row">
        <button
          type="button"
          className="btn-team"
          style={{ '--c': home.color } as React.CSSProperties}
          onClick={() => onPick(home.code)}
        >
          <TeamMonogram code={home.code} size="sm" />
          {home.code} won
        </button>
        <button
          type="button"
          className="btn-team"
          style={{ '--c': away.color } as React.CSSProperties}
          onClick={() => onPick(away.code)}
        >
          <TeamMonogram code={away.code} size="sm" />
          {away.code} won
        </button>
      </div>
    </section>
  )
}

/* ============================================================== */
/*                         STATUS BOARD                            */
/* ============================================================== */

function StatusBoardSection({
  status,
  myTeam,
  onSelectTeam,
  oddsMode,
}: {
  status: ReturnType<typeof getStatusBoard>
  myTeam: TeamCode | null
  onSelectTeam: (code: TeamCode) => void
  oddsMode: OddsMode
}) {
  const stateOrder: ChanceLabel[] = ['safe', 'alive', 'hunt', 'brink', 'out']
  const sorted = [...status].sort(
    (a, b) =>
      stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state) || b.topFourPct - a.topFourPct,
  )

  return (
    <section className="section">
      <header className="section-head">
        <div>
          <Eyebrow>The status board</Eyebrow>
          <h2 className="section-title">Who's still in?</h2>
        </div>
        <p className="section-sub">Tap a team to make it yours.</p>
      </header>

      <div className="status-grid">
        {sorted.map((item) => {
          const team = teamByCode.get(item.code)!
          const isMine = myTeam === item.code
          return (
            <button
              key={item.code}
              type="button"
              className={`status-card status-${item.state}${isMine ? ' status-mine' : ''}`}
              onClick={() => onSelectTeam(item.code)}
              style={{ '--c': team.color } as React.CSSProperties}
            >
              <div className="status-card-row">
                <TeamMonogram code={item.code} size="md" />
                <div className="status-card-name">
                  <strong>{team.short}</strong>
                  <span>{item.code}</span>
                </div>
                <ChanceBadge label={item.state} />
              </div>
              <div className="status-card-bar">
                <div
                  className="status-card-bar-fill"
                  style={{ width: `${Math.max(2, item.topFourPct)}%` }}
                />
                <div className="status-card-bar-meta">
                  <span>Top-4</span>
                  <strong>{formatPercent(item.topFourPct / 100)}</strong>
                </div>
              </div>
              <div className="status-card-foot">
                <span>{item.pointsNow}p now · max {item.maxPts}</span>
                {item.needed !== null && item.needed > 0 ? (
                  <strong>{item.needed} more wins needed</strong>
                ) : item.state === 'out' ? (
                  <strong>Mathematically out</strong>
                ) : item.state === 'safe' ? (
                  <strong>Through</strong>
                ) : (
                  <strong>Locked in already</strong>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <p className="section-foot">
        {oddsMode === 'weighted'
          ? 'Top-4 % is weighted by team form (NRR + recent results).'
          : 'Top-4 % treats every remaining match as a 50/50.'}
      </p>
    </section>
  )
}

/* ============================================================== */
/*                       YOUR TEAM'S ROAD                          */
/* ============================================================== */

function YourTeamRoadSection({
  myTeam,
  winners,
  onPick,
  onClear,
  showAllFixtures,
  onToggleAll,
}: {
  myTeam: TeamCode | null
  winners: WinnerMap
  onPick: (matchId: number, code: TeamCode) => void
  onClear: (matchId: number) => void
  showAllFixtures: boolean
  onToggleAll: () => void
}) {
  const visibleFixtures = useMemo(() => {
    if (!myTeam || showAllFixtures) return fixtures
    return remainingForTeam(myTeam)
  }, [myTeam, showAllFixtures])

  return (
    <section className="section" id="fixtures-section">
      <header className="section-head">
        <div>
          <Eyebrow>{myTeam && !showAllFixtures ? `${myTeam}'s road` : 'The fixture list'}</Eyebrow>
          <h2 className="section-title">
            {myTeam && !showAllFixtures
              ? `${myTeam}'s remaining matches`
              : 'All remaining matches'}
          </h2>
        </div>
        {myTeam && (
          <button type="button" className="btn-text" onClick={onToggleAll}>
            {showAllFixtures
              ? `Show only ${myTeam}'s matches`
              : `See all ${fixtures.length} matches`}
          </button>
        )}
      </header>

      <div className="fixtures">
        {visibleFixtures.map((fixture) => {
          const winnerNow = winners[fixture.id] || ''
          const isMyMatch =
            myTeam !== null && (fixture.home === myTeam || fixture.away === myTeam)

          return (
            <article
              key={fixture.id}
              className={`fixture${winnerNow ? ' fixture-set' : ''}${isMyMatch ? ' fixture-mine' : ''}`}
            >
              <div className="fixture-meta">
                <span className="fixture-id">M{fixture.id}</span>
                <div className="fixture-date">
                  <span>{fixture.date}</span>
                  <em>{fixture.venue}</em>
                </div>
              </div>
              <div className="fixture-buttons">
                <FixtureSide
                  team={fixture.home}
                  selected={winnerNow === fixture.home}
                  onClick={() => onPick(fixture.id, fixture.home)}
                />
                <span className="fixture-vs">vs</span>
                <FixtureSide
                  team={fixture.away}
                  selected={winnerNow === fixture.away}
                  onClick={() => onPick(fixture.id, fixture.away)}
                />
              </div>
              {winnerNow && (
                <button
                  type="button"
                  className="fixture-clear"
                  onClick={() => onClear(fixture.id)}
                  aria-label="Clear pick"
                >
                  Clear
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function FixtureSide({
  team,
  selected,
  onClick,
}: {
  team: TeamCode
  selected: boolean
  onClick: () => void
}) {
  const t = teamByCode.get(team)!

  return (
    <button
      type="button"
      className={`fixture-side${selected ? ' fixture-side-selected' : ''}`}
      onClick={onClick}
      style={{ '--c': t.color } as React.CSSProperties}
    >
      <TeamMonogram code={team} size="md" />
      <span className="fixture-side-name">{t.code}</span>
      {selected && (
        <span className="fixture-check" aria-hidden>
          ✓
        </span>
      )}
    </button>
  )
}

/* ============================================================== */
/*                         GAMES TO WATCH                          */
/* ============================================================== */

function GamesToWatchSection({
  importance,
  winners,
  onPick,
}: {
  importance: ReturnType<typeof getMatchImportance>
  winners: WinnerMap
  onPick: (matchId: number, code: TeamCode | '') => void
}) {
  const top = importance.slice(0, 5).filter((item) => item.score > 0)
  if (top.length === 0) return null

  return (
    <section className="section">
      <header className="section-head">
        <div>
          <Eyebrow>The high-leverage games</Eyebrow>
          <h2 className="section-title">Games that decide the cut</h2>
        </div>
        <p className="section-sub">Sorted by how much they reshape the playoff picture.</p>
      </header>

      <div className="leverage-list">
        {top.map((item, index) => {
          const home = teamByCode.get(item.fixture.home)!
          const away = teamByCode.get(item.fixture.away)!
          const winnerNow = winners[item.fixture.id]
          return (
            <article key={item.fixture.id} className={`leverage${winnerNow ? ' leverage-set' : ''}`}>
              <div className="leverage-rank">{index + 1}</div>
              <div className="leverage-body">
                <div className="leverage-head">
                  <strong>
                    {home.short} vs {away.short}
                  </strong>
                  <span>
                    {item.fixture.date} · {item.fixture.venue}
                  </span>
                </div>
                <p className="leverage-explain">
                  Decides the line for{' '}
                  <span className="leverage-affected">
                    {item.changedTeams.slice(0, 5).join(', ')}
                    {item.changedTeams.length > 5 && ` + ${item.changedTeams.length - 5} more`}
                  </span>
                  .
                </p>
                <div className="leverage-buttons">
                  <button
                    type="button"
                    className={`leverage-btn${winnerNow === home.code ? ' leverage-btn-selected' : ''}`}
                    style={{ '--c': home.color } as React.CSSProperties}
                    onClick={() => onPick(item.fixture.id, home.code)}
                  >
                    <TeamMonogram code={home.code} size="xs" />
                    {home.code}
                  </button>
                  <button
                    type="button"
                    className={`leverage-btn${winnerNow === away.code ? ' leverage-btn-selected' : ''}`}
                    style={{ '--c': away.color } as React.CSSProperties}
                    onClick={() => onPick(item.fixture.id, away.code)}
                  >
                    <TeamMonogram code={away.code} size="xs" />
                    {away.code}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/* ============================================================== */
/*                         ODDS BAR CHART                          */
/* ============================================================== */

function OddsChartSection({
  enumeration,
  myTeam,
  oddsMode,
}: {
  enumeration: ReturnType<typeof enumerateAll>
  myTeam: TeamCode | null
  oddsMode: OddsMode
}) {
  const rows = useMemo(() => {
    return allTeamCodes
      .map((code) => {
        const qualification = getTeamQualification(code, enumeration)
        return {
          code,
          top4: qualification.top4Chance,
          top2: qualification.top2Chance,
        }
      })
      .sort((a, b) => b.top4 - a.top4 || b.top2 - a.top2)
  }, [enumeration])

  return (
    <section className="section">
      <header className="section-head">
        <div>
          <Eyebrow>The board</Eyebrow>
          <h2 className="section-title">Top-four chances</h2>
        </div>
        <p className="section-sub">{oddsMode === 'weighted' ? 'Weighted by form.' : '50/50 across all open matches.'}</p>
      </header>

      <ol className="bars">
        {rows.map((row) => {
          const team = teamByCode.get(row.code)!
          const isMine = myTeam === row.code
          return (
            <li key={row.code} className={`bar${isMine ? ' bar-mine' : ''}`}>
              <div className="bar-label">
                <TeamMonogram code={row.code} size="sm" />
                <span>{row.code}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${Math.max(1.5, row.top4 * 100)}%`,
                    background: team.color,
                  }}
                />
                <div
                  className="bar-fill bar-fill-top2"
                  style={{ width: `${Math.max(0, row.top2 * 100)}%` }}
                />
              </div>
              <div className="bar-values">
                <strong>{formatPercent(row.top4)}</strong>
                <span>top-2 {formatPercent(row.top2)}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/* ============================================================== */
/*                          AUTO SOLVER                            */
/* ============================================================== */

function AutoSolverSection({
  myTeam,
  target,
  setTarget,
  solverMode,
  setSolverMode,
  winners,
  applied,
  enumeration,
  onApply,
  onUndo,
}: {
  myTeam: TeamCode
  target: QualificationTarget
  setTarget: (t: QualificationTarget) => void
  solverMode: SolverMode
  setSolverMode: (mode: SolverMode) => void
  winners: WinnerMap
  applied: SolverApplied | null
  enumeration: ReturnType<typeof enumerateAll>
  onApply: (goal?: QualificationTarget, mode?: SolverMode) => void
  onUndo: () => void
}) {
  const team = teamByCode.get(myTeam)!

  // When applied, possibility is judged against the *snapshot before* — not
  // the current fully-determined scenario. So the goal toggle reflects what
  // the user can re-solve to.
  const top4Possible = applied
    ? applied.top4MinimumPath !== null || applied.top4SafestPath !== null
    : getTeamQualification(myTeam, enumeration).summary.top4 > 0
  const top2Possible = applied
    ? applied.top2Path !== null
    : getTeamQualification(myTeam, enumeration).summary.top2 > 0
  const possibleNow = target === 'top2' ? top2Possible : top4Possible

  function changeGoal(goal: QualificationTarget) {
    if (goal === target) return
    if (applied) {
      onApply(goal, solverMode) // re-solve from snapshot with new goal
    } else {
      setTarget(goal)
    }
  }

  function changeMode(mode: SolverMode) {
    if (mode === solverMode) return
    if (applied) onApply(target, mode)
    else setSolverMode(mode)
  }

  return (
    <section className="section" id="solver-section">
      <header className="section-head">
        <div>
          <Eyebrow>The path home</Eyebrow>
          <h2 className="section-title">What does it take for {myTeam}?</h2>
        </div>
      </header>

      <div className={`solver${applied ? ' solver-applied' : ''}`}>
        <SolverGoalBar
          target={target}
          changeGoal={changeGoal}
          top4Possible={top4Possible}
          top2Possible={top2Possible}
          applied={applied}
        />

        {!applied ? (
          <SolverReady
            team={team}
            myTeam={myTeam}
            target={target}
            solverMode={solverMode}
            setSolverMode={changeMode}
            possibleNow={possibleNow}
            onApply={() => onApply()}
          />
        ) : (
          <SolverApplied
            myTeam={myTeam}
            applied={applied}
            winners={winners}
            onUndo={onUndo}
          />
        )}
      </div>
    </section>
  )
}

function SolverGoalBar({
  target,
  changeGoal,
  top4Possible,
  top2Possible,
  applied,
}: {
  target: QualificationTarget
  changeGoal: (t: QualificationTarget) => void
  top4Possible: boolean
  top2Possible: boolean
  applied: SolverApplied | null
}) {
  return (
    <div className="solver-goal">
      <span className="solver-goal-label">Aim for</span>
      <div className="solver-toggle" role="radiogroup" aria-label="Qualification goal">
        <button
          type="button"
          role="radio"
          aria-checked={target === 'top4'}
          className={`solver-toggle-btn${target === 'top4' ? ' solver-toggle-active' : ''}`}
          onClick={() => changeGoal('top4')}
          disabled={!top4Possible}
        >
          Top 4
          {!top4Possible && <span className="solver-toggle-dim"> · impossible</span>}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={target === 'top2'}
          className={`solver-toggle-btn${target === 'top2' ? ' solver-toggle-active' : ''}`}
          onClick={() => changeGoal('top2')}
          disabled={!top2Possible}
        >
          Top 2
          {!top2Possible && <span className="solver-toggle-dim"> · impossible</span>}
        </button>
      </div>
      {applied && (
        <span className="solver-goal-tag">
          showing path to <strong>{applied.goal === 'top2' ? 'top 2' : 'top 4'}</strong>
        </span>
      )}
    </div>
  )
}

function SolverReady({
  team,
  myTeam,
  target,
  solverMode,
  setSolverMode,
  possibleNow,
  onApply,
}: {
  team: Team
  myTeam: TeamCode
  target: QualificationTarget
  solverMode: SolverMode
  setSolverMode: (mode: SolverMode) => void
  possibleNow: boolean
  onApply: () => void
}) {
  if (!possibleNow) {
    return (
      <div className="solver-impossible">
        <strong className="solver-impossible-head">No path to {target === 'top2' ? 'top two' : 'top four'}.</strong>
        <p>
          Under your current picks, {team.short} cannot finish there in any combination of remaining
          results. Clear some picks above, or aim for the other goal.
        </p>
      </div>
    )
  }

  return (
    <>
      {target === 'top4' && (
        <div className="solver-mode" aria-label="Path type">
          <span>Path type</span>
          <button
            type="button"
            className={solverMode === 'safest' ? 'solver-mode-active' : ''}
            onClick={() => setSolverMode('safest')}
          >
            Safest path
          </button>
          <button
            type="button"
            className={solverMode === 'minimum' ? 'solver-mode-active' : ''}
            onClick={() => setSolverMode('minimum')}
          >
            Minimum wins
          </button>
        </div>
      )}
      <p className="solver-body">
        Tap below and we'll plot one specific run that lands{' '}
        <strong>{team.short}</strong> in the{' '}
        <strong>{target === 'top2' ? 'top two' : 'top four'}</strong>. Picks you've already locked
        stay as they are. {target === 'top4' && solverMode === 'minimum'
          ? 'Minimum wins shows the lowest-effort qualifying path, not necessarily the happiest path.'
          : 'Safest path favors the strongest final position available under your picks.'}
      </p>
      <button
        type="button"
        className="btn-primary solver-cta"
        onClick={onApply}
        style={{ '--c': team.color } as React.CSSProperties}
      >
        Plot a path for {myTeam}
        <span className="solver-cta-arrow" aria-hidden>
          →
        </span>
      </button>
    </>
  )
}

function SolverApplied({
  myTeam,
  applied,
  winners,
  onUndo,
}: {
  myTeam: TeamCode
  applied: SolverApplied
  winners: WinnerMap
  onUndo: () => void
}) {
  // What was open in `applied.before` and is now decided in `winners`?
  const myMatchIds = new Set(remainingForTeam(myTeam).map((f) => f.id))

  const myMatchPath = remainingForTeam(myTeam)
    .filter((f) => !applied.before[f.id])
    .map((f) => ({
      fixture: f,
      winner: winners[f.id] as TeamCode,
    }))

  const importanceBefore = getMatchImportance(applied.before)
  const keyOutsidePath = importanceBefore
    .filter((item) => !myMatchIds.has(item.fixture.id))
    .filter((item) => item.score > 0)
    .slice(0, 5)
    .map((item) => ({
      fixture: item.fixture,
      winner: winners[item.fixture.id] as TeamCode,
    }))

  const myWins = myMatchPath.filter((p) => p.winner === myTeam).length
  const totalDecided = Object.values(winners).filter(Boolean).length

  return (
    <>
      <div className="solver-success">
        <span className="solver-success-tick" aria-hidden>
          ✓
        </span>
        <div>
          <strong>Path locked in.</strong>
          <span>
            {myTeam} qualifies for the {applied.goal === 'top2' ? 'top two' : 'top four'} when these
            results play out.
          </span>
        </div>
      </div>

      <p className="solver-context-note">
        {applied.goal === 'top4' && applied.mode === 'minimum'
          ? 'This is the lowest-effort qualifying path, not the best outcome for your team.'
          : applied.goal === 'top4'
            ? 'This path favors a stronger final position before minimizing wins.'
            : 'This is a top-two push, so it favors the strongest final position available.'}
      </p>

      <div className="solver-min-wins">
        <strong>{myWins}</strong>
        <span>
          {myMatchPath.length === 0
            ? `${myTeam} have no matches left in this slice`
            : `${myWins === 1 ? 'win' : 'wins'} from ${myTeam}'s ${
                myMatchPath.length === 1 ? 'remaining match' : `${myMatchPath.length} remaining matches`
              }`}
        </span>
      </div>

      {myMatchPath.length > 0 && (
        <div className="path-block">
          <p className="path-section-label">{myTeam}'s run</p>
          <ol className="path-list">
            {myMatchPath.map(({ fixture, winner }) => (
              <PathItem key={fixture.id} fixture={fixture} winner={winner} highlightCode={myTeam} />
            ))}
          </ol>
        </div>
      )}

      {keyOutsidePath.length > 0 && (
        <div className="path-block">
          <p className="path-section-label">Key outside results</p>
          <ol className="path-list">
            {keyOutsidePath.map(({ fixture, winner }) => (
              <PathItem key={fixture.id} fixture={fixture} winner={winner} highlightCode={null} />
            ))}
          </ol>
          <p className="path-foot-note">
            One valid combination — many others get {myTeam} in too.
            {totalDecided === fixtures.length && ` All ${fixtures.length} picks are now on the board — scroll up to inspect.`}
          </p>
        </div>
      )}

      <div className="solver-foot-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onUndo}>
          Undo this path
        </button>
        <span className="solver-foot-note">
          Tap a different goal above to plot a fresh path.
        </span>
      </div>
    </>
  )
}

function PathItem({
  fixture,
  winner,
  highlightCode,
}: {
  fixture: Fixture
  winner: TeamCode
  highlightCode: TeamCode | null
}) {
  const home = teamByCode.get(fixture.home)!
  const away = teamByCode.get(fixture.away)!
  const winnerTeam = teamByCode.get(winner)!
  const isMine = highlightCode !== null && winner === highlightCode
  const isAgainstMine = highlightCode !== null && winner !== highlightCode && (fixture.home === highlightCode || fixture.away === highlightCode)

  return (
    <li className={`path-item${isMine ? ' path-item-win' : ''}${isAgainstMine ? ' path-item-loss' : ''}`}>
      <span className="path-item-id">M{fixture.id}</span>
      <span className="path-item-mid">
        <span className={fixture.home === winner ? 'path-name-strong' : 'path-name-soft'}>
          {home.code}
        </span>
        <span className="path-item-vs">vs</span>
        <span className={fixture.away === winner ? 'path-name-strong' : 'path-name-soft'}>
          {away.code}
        </span>
      </span>
      <span
        className={`path-winner${isMine ? ' path-winner-mine' : isAgainstMine ? ' path-winner-against' : ''}`}
        style={{ '--c': winnerTeam.color } as React.CSSProperties}
      >
        <TeamMonogram code={winner} size="xs" />
        {isMine ? 'WIN' : isAgainstMine ? 'LOSS' : winner}
      </span>
    </li>
  )
}

/* ============================================================== */
/*                       TOOLS DISCLOSURE                          */
/* ============================================================== */

function ToolsDisclosure({
  open,
  onToggle,
  oddsMode,
  setOddsMode,
  onChooseFavorites,
  onReset,
  onShare,
}: {
  open: boolean
  onToggle: () => void
  oddsMode: OddsMode
  setOddsMode: (m: OddsMode) => void
  onChooseFavorites: () => void
  onReset: () => void
  onShare: () => void
}) {
  return (
    <section className="section">
      <button type="button" className={`disclosure-head${open ? ' disclosure-open' : ''}`} onClick={onToggle}>
        <div>
          <Eyebrow>Advanced</Eyebrow>
          <h2 className="section-title">Tools</h2>
        </div>
        <span className="disclosure-caret" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="tools">
          <div className="tools-row">
            <span className="tools-label">Odds method</span>
            <div className="tools-toggle">
              <button
                type="button"
                className={`tools-toggle-btn${oddsMode === 'weighted' ? ' tools-toggle-active' : ''}`}
                onClick={() => setOddsMode('weighted')}
              >
                Weighted by form
              </button>
              <button
                type="button"
                className={`tools-toggle-btn${oddsMode === 'equal' ? ' tools-toggle-active' : ''}`}
                onClick={() => setOddsMode('equal')}
              >
                Pure 50/50
              </button>
            </div>
          </div>
          <div className="tools-row tools-row-buttons">
            <button type="button" className="btn-ghost" onClick={onChooseFavorites}>
              Auto-fill the favorites
            </button>
            <button type="button" className="btn-ghost" onClick={onShare}>
              Copy share link
            </button>
            <button type="button" className="btn-ghost btn-danger" onClick={onReset}>
              Reset all picks
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/* ============================================================== */
/*                       STANDINGS DISCLOSURE                      */
/* ============================================================== */

function StandingsDisclosure({
  open,
  onToggle,
  real,
  predicted,
  isComplete,
}: {
  open: boolean
  onToggle: () => void
  real: StandingRow[]
  predicted: StandingRow[]
  isComplete: boolean
}) {
  const [view, setView] = useState<'real' | 'predicted'>('predicted')

  return (
    <section className="section">
      <button type="button" className={`disclosure-head${open ? ' disclosure-open' : ''}`} onClick={onToggle}>
        <div>
          <Eyebrow>The numbers</Eyebrow>
          <h2 className="section-title">Full points table</h2>
        </div>
        <span className="disclosure-caret" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="standings">
          <div className="standings-toggle">
            <button
              type="button"
              className={`standings-toggle-btn${view === 'real' ? ' standings-toggle-active' : ''}`}
              onClick={() => setView('real')}
            >
              Live snapshot
            </button>
            <button
              type="button"
              className={`standings-toggle-btn${view === 'predicted' ? ' standings-toggle-active' : ''}`}
              onClick={() => setView('predicted')}
            >
              {isComplete ? 'Final predicted' : 'Projected'}
            </button>
          </div>
          <StandingsTable rows={view === 'real' ? real : predicted} showScenario={view === 'predicted'} />
        </div>
      )}
    </section>
  )
}

function StandingsTable({ rows, showScenario }: { rows: StandingRow[]; showScenario: boolean }) {
  return (
    <div className="table-wrap">
      <table className="standings-table">
        <thead>
          <tr>
            <th className="th-rank">#</th>
            <th className="th-team">Team</th>
            <th>P</th>
            <th>W</th>
            <th>L</th>
            <th>Pts</th>
            <th>NRR</th>
            {showScenario && <th>Scn-W</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((team, index) => (
            <tr key={team.code} className={index < 4 ? 'row-q' : ''}>
              <td className="td-rank">{index + 1}</td>
              <td className="td-team">
                <TeamMonogram code={team.code} size="xs" />
                <span>{team.code}</span>
              </td>
              <td>{team.played}</td>
              <td>{team.won}</td>
              <td>{team.lost}</td>
              <td>
                <strong>{team.points}</strong>
              </td>
              <td className={team.nrr >= 0 ? 'td-nrr-pos' : 'td-nrr-neg'}>{formatNrr(team.nrr)}</td>
              {showScenario && <td>{team.scenarioWins}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================================================== */
/*                            FOOTER                                */
/* ============================================================== */

function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-row">
        <div>
          <p className="footer-brand">Playoff Pulse</p>
          <p className="footer-meta">{lastUpdated}</p>
        </div>
        <div>
          <p className="footer-label">Built with</p>
          <p className="footer-meta">React · TypeScript · maths and a bit of stadium light</p>
        </div>
      </div>

      <details className="footer-explain">
        <summary>How the math works</summary>
        <p>
          The app enumerates all <em>2<sup>n</sup></em> outcomes of remaining matches (
          <em>n</em> = open match count). For each leaf of that tree it computes the final standings using
          standard IPL tie-breaks (points → NRR → original league order). “Top-4 chance” is the share of
          leaves that put a team in the top four. <strong>Weighted</strong> mode tilts each match by team
          form (points + NRR + recent wins, clamped to 18–82%); <strong>50/50</strong> treats every open
          match as a coin flip. NRR is held fixed — only wins and losses change between scenarios.
        </p>
      </details>

      <div className="footer-sources">
        <span className="footer-label">Sources</span>
        <ul>
          {sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}

/* ============================================================== */
/*                          TEAM PICKER                             */
/* ============================================================== */

function TeamPicker({
  current,
  onPick,
  onClear,
  onClose,
}: {
  current: TeamCode | null
  onPick: (code: TeamCode) => void
  onClear: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div
        className="picker"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick your team"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <div>
            <Eyebrow>Make it personal</Eyebrow>
            <h2 className="picker-title">Who do you support?</h2>
          </div>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="picker-grid">
          {teams.map((team) => (
            <button
              key={team.code}
              type="button"
              className={`picker-card${current === team.code ? ' picker-card-current' : ''}`}
              style={{ '--c': team.color, '--ink': team.ink } as React.CSSProperties}
              onClick={() => onPick(team.code)}
            >
              <TeamMonogram code={team.code} size="lg" flat />
              <span className="picker-card-name">{team.short}</span>
            </button>
          ))}
        </div>
        <div className="picker-foot">
          <button type="button" className="btn-ghost" onClick={onClear}>
            Watch all teams (no pick)
          </button>
        </div>
      </div>
    </div>
  )
}
