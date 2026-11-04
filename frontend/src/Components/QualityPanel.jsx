import { useState } from 'react';
import { fixKindOfIssue } from '../autoFix';

const CATS = [
  { id: 'security', icon: '🛡️', name: 'Security', hint: 'hardcoded secrets, unsafe eval', color: '#ff6b6b' },
  { id: 'bug', icon: '🐞', name: 'Bug', hint: 'undefined variables, unreachable code', color: '#ff9f43' },
  { id: 'performance', icon: '⚡', name: 'Performance', hint: 'inefficient loops, blocking calls', color: '#5aa9ff' },
  { id: 'smell', icon: '🧩', name: 'Code Smell', hint: 'deep nesting, duplicate logic', color: '#f0b429' },
  { id: 'style', icon: '✎', name: 'Style', hint: 'naming, leftover debug logs', color: '#9aa0b8' },
];

const SEVERITY = {
  error: { label: 'Error', color: '#ff6b6b' },
  warning: { label: 'Warning', color: '#f0b429' },
  info: { label: 'Info', color: '#5aa9ff' },
};

// used when an issue has no suggestion of its own, so every issue still says what to do
const DEFAULT_FIX = {
  security: 'Review this line: remove or protect the secret, validate the input, and avoid unsafe calls.',
  bug: 'Check the logic on this line and handle the case that fails.',
  performance: 'Rewrite this part so it does less work, for example avoid repeated loops or waiting one by one.',
  smell: 'Simplify this part: split it into smaller functions or remove the duplication.',
  style: 'Rename, reformat or remove this so it matches the code around it.',
};

const TOOL_TAG = { rules: 'Rules', eslint: 'ESLint', python: 'Python', javac: 'javac' };

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

function scoreColor(score) {
  if (score >= 90) return '#4cd38a';
  if (score >= 80) return '#8fd14f';
  if (score >= 70) return '#f0b429';
  if (score >= 60) return '#ff9f43';
  return '#ff6b6b';
}

function Tag({ text, color, title }) {
  return (
    <span title={title} style={{
      color, border: `1px solid ${color}`, borderRadius: '10px', padding: '0 8px', fontSize: '10px', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

function QualityPanel({ state, useAi, onToggleAi, onRerun, onJump, onClose, audit, onAudit, fixes, onApplyFixes }) {
  const { loading, error, data, fileName, fixNote } = state;
  const [filter, setFilter] = useState('all');
  const [showMore, setShowMore] = useState(false);

  const issues = data ? data.issues : [];
  const canApply = !loading && fixes && fixes.count > 0;

  return (
    <div style={{
      height: '420px', flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#171a24', borderTop: '1px solid #262a38',
    }}>
      {/* colors for the marks drawn in the editor */}
      <style>{`
        .q-line-error { background: rgba(255, 80, 80, 0.10); }
        .q-line-warning { background: rgba(255, 190, 60, 0.08); }
        .q-line-info { background: rgba(90, 160, 255, 0.07); }
        .q-gutter-error { border-left: 3px solid #ff5a5a; margin-left: 3px; }
        .q-gutter-warning { border-left: 3px solid #f0b429; margin-left: 3px; }
        .q-gutter-info { border-left: 3px solid #5aa9ff; margin-left: 3px; }
      `}</style>

      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px',
        borderBottom: '1px solid #262a38', flexShrink: 0,
      }}>
        <div style={{
          width: '30px', height: '30px', borderRadius: '8px', background: '#2b2760', color: '#a99dff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700,
        }} title="AI-powered analysis">✦</div>
        <div>
          <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
            Code Quality Panel{fileName ? ` – ${fileName}` : ''}
          </div>
          <div style={{ color: '#8a8fa5', fontSize: '11px' }}>AI-powered analysis of issues</div>
        </div>
        {data && (
          <span title="Score from the automatic checks (rules and tools). AI suggestions do not change it." style={{
            marginLeft: '8px', background: scoreColor(data.score), color: '#12141c', fontWeight: 700,
            fontSize: '12px', padding: '2px 10px', borderRadius: '10px',
          }}>
            {data.score}/100 · {data.grade}
          </span>
        )}
        <span onClick={onClose} style={{ marginLeft: 'auto', color: '#888', cursor: 'pointer', fontSize: '14px' }} title="Close">✕</span>
      </div>

      {/* category filter */}
      {data && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 14px', borderBottom: '1px solid #20232f', flexShrink: 0 }}>
          <span
            onClick={() => setFilter('all')}
            style={{ padding: '3px 10px', borderRadius: '12px', cursor: 'pointer', fontSize: '12px', background: filter === 'all' ? '#6d5ef5' : '#262a38', color: '#fff' }}
          >
            All ({issues.length})
          </span>
          {CATS.map((c) => (
            <span
              key={c.id}
              onClick={() => setFilter(c.id)}
              style={{
                padding: '3px 10px', borderRadius: '12px', cursor: 'pointer', fontSize: '12px',
                background: filter === c.id ? c.color : '#262a38', color: filter === c.id ? '#12141c' : '#ddd',
              }}
            >
              {c.icon} {c.name} ({data.categoryCounts[c.id] || 0})
            </span>
          ))}
        </div>
      )}

      {/* issue list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontSize: '12px' }}>
        {loading && (
          <div style={{ color: '#aaa', fontStyle: 'italic' }}>
            Analyzing… static checks, tools and the AI review. A local model can take a minute or two.
          </div>
        )}

        {!loading && error && <div style={{ color: '#ff9aa8' }}>{error}</div>}

        {!loading && data && (
          <>
            {data.aiStatus === 'failed' && (
              <div style={{
                background: '#3a3017', border: '1px solid #6b5a1f', color: '#f3d98a',
                borderRadius: '6px', padding: '8px 10px', marginBottom: '10px', lineHeight: 1.5,
              }}>
                <b>AI review unavailable.</b> {data.aiError} Showing the static analysis results instead.{' '}
                <span onClick={onRerun} style={{ color: '#fff', textDecoration: 'underline', cursor: 'pointer' }}>Try again</span>
              </div>
            )}
            {data.aiStatus === 'skipped' && data.aiError && (
              <div style={{ color: '#f0b429', marginBottom: '8px' }}>{data.aiError}</div>
            )}
            {data.summary && (
              <div style={{ color: '#ccc', marginBottom: '10px', lineHeight: 1.5 }}>
                <b style={{ color: '#a99dff' }}>✦ AI summary:</b> {data.summary}
              </div>
            )}

            {issues.length === 0 && (
              <div style={{ color: '#4cd38a', padding: '10px 0' }}>No issues found. 🎉</div>
            )}

            {CATS.filter((c) => filter === 'all' || filter === c.id).map((c) => {
              const list = issues.filter((i) => i.category === c.id);
              if (list.length === 0) return null;
              return (
                <div key={c.id} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '2px 0 8px' }}>
                    <span style={{ fontSize: '15px' }}>{c.icon}</span>
                    <b style={{ color: c.color, fontSize: '13px' }}>{c.name}</b>
                    <span style={{ color: '#6f748a' }}>{list.length} {list.length === 1 ? 'issue' : 'issues'} · {c.hint}</span>
                  </div>

                  {list.map((issue, idx) => {
                    const sev = SEVERITY[issue.severity];
                    const kind = fixKindOfIssue(issue);
                    const fixable = !!(kind && fixes && fixes.byLine[issue.line] && fixes.byLine[issue.line][kind]);
                    const lineLabel = issue.endLine && issue.endLine > issue.line
                      ? `Lines ${issue.line}–${issue.endLine}` : `Line ${issue.line}`;
                    return (
                      <div
                        key={`${c.id}-${idx}`}
                        style={{
                          background: '#1d2130', border: '1px solid #262a38', borderLeft: `4px solid ${sev.color}`,
                          borderRadius: '8px', padding: '9px 12px', marginBottom: '7px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <b style={{ color: '#fff' }}>{lineLabel}</b>
                          <Tag text={sev.label} color={sev.color} />
                          {issue.source === 'ai'
                            ? <Tag text={issue.status === 'confirmed' ? 'AI · backed by a tool' : 'AI · please verify'} color={issue.status === 'confirmed' ? '#7ee2a8' : '#f0b429'} title="Suggested by the AI. AI findings can be wrong." />
                            : <Tag text={TOOL_TAG[issue.tool] || 'Rules'} color="#8a8fa5" title="Found by an automatic check" />}
                          {fixable && <Tag text="✔ Auto-fix available" color="#4cd38a" title="Apply Fixes can change this for you" />}
                        </div>
                        <div style={{ color: '#fff', margin: '6px 0 3px', fontSize: '13px', lineHeight: 1.4 }}>{issue.message}</div>
                        <div style={{ color: '#b9bdd0', lineHeight: 1.5 }}>
                          <b style={{ color: '#9aa0b8' }}>Suggested fix:</b> {issue.suggestion || DEFAULT_FIX[issue.category] || DEFAULT_FIX.smell}
                        </div>
                        <div style={{ marginTop: '7px' }}>
                          <span
                            onClick={() => onJump(issue.line, issue.endLine)}
                            style={{ background: '#262a38', color: '#fff', padding: '3px 12px', borderRadius: '12px', cursor: 'pointer', fontSize: '11px' }}
                          >
                            View in Code
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* technical details stay hidden until asked for */}
            <div style={{ borderTop: '1px solid #262a38', paddingTop: '8px' }}>
              <span onClick={() => setShowMore((v) => !v)} style={{ color: '#a99dff', cursor: 'pointer', userSelect: 'none' }}>
                {showMore ? '▾ Hide details' : '▸ Show details (metrics, checks, dependencies)'}
              </span>
              {showMore && (
                <div style={{ marginTop: '8px', color: '#aab', lineHeight: 1.6 }}>
                  <div style={{ marginBottom: '6px' }}>
                    {data.metrics.lines} lines · {data.metrics.functions} functions · average complexity {data.metrics.avgComplexity} ·
                    most complex function {data.metrics.maxComplexity} · longest function {data.metrics.longestFunction} lines ·
                    deepest nesting {data.metrics.maxNesting} · repeated code {data.metrics.duplication}%
                  </div>
                  {data.aiStatus === 'ok' && (
                    <div style={{ marginBottom: '6px' }}>
                      AI review: {data.validation.found} findings checked against the tools: {data.validation.merged} also found by a tool,
                      {' '}{data.validation.confirmed} backed up nearby, {data.validation.unverified} AI only, {data.validation.dropped} dropped (not on a code line).
                    </div>
                  )}
                  {data.notes && data.notes.length > 0 && (
                    <div style={{ marginBottom: '6px' }}>
                      <b>Skipped checks:</b>
                      {data.notes.map((n, i) => <div key={i}>• {n}</div>)}
                    </div>
                  )}
                  {fixes && fixes.skipped.length > 0 && (
                    <div style={{ marginBottom: '6px' }}>
                      <b>Left for you (not safe to change automatically):</b>
                      {fixes.skipped.map((s, i) => <div key={i}>• Line {s.line}: {s.reason}</div>)}
                    </div>
                  )}
                  <div style={{ marginBottom: '6px' }}>
                    <b style={{ color: '#fff' }}>Dependencies (npm audit)</b>{' '}
                    <span
                      onClick={audit && audit.loading ? undefined : onAudit}
                      style={{ background: '#262a38', color: '#fff', padding: '2px 10px', borderRadius: '12px', cursor: 'pointer', marginLeft: '6px' }}
                    >
                      {audit && audit.loading ? 'Scanning…' : '🛡 Scan project dependencies'}
                    </span>
                    {audit && audit.error && <div style={{ color: '#ff9aa8' }}>{audit.error}</div>}
                    {audit && audit.data && audit.data.length === 0 && <div>No package.json found in the open folder.</div>}
                    {audit && audit.data && audit.data.map((f, i) => (
                      <div key={i}>
                        <b>{f.folder}</b>:{' '}
                        {f.error
                          ? <span style={{ color: '#f0b429' }}>{f.error}</span>
                          : <span>
                              {f.counts.critical} critical · {f.counts.high} high · {f.counts.moderate} moderate · {f.counts.low} low
                              {f.top.length > 0 && <div style={{ color: '#8a8fa5' }}>{f.top.map((t) => `${t.name} (${t.severity})`).join(' · ')}</div>}
                            </span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ color: '#6f748a' }}>
                    Static checks {fmtMs(data.timings.staticMs)} · Tool checks {fmtMs(data.timings.toolsMs)}
                    {data.timings.aiMs > 0 && ` · AI review ${fmtMs(data.timings.aiMs)}`} · Total {fmtMs(data.timings.totalMs)}
                    <br />
                    AI findings can be wrong or incomplete. Items marked "AI · please verify" were not confirmed by any tool. See docs/AI_LIMITATIONS.md.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* footer controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '8px 14px',
        borderTop: '1px solid #262a38', flexShrink: 0, background: '#14161f',
      }}>
        <span
          onClick={loading ? undefined : onRerun}
          title="Runs the static checks, the tools and the AI review again"
          style={{
            color: '#fff', background: loading ? '#2a2e3d' : '#6d5ef5', fontSize: '12px',
            padding: '4px 14px', borderRadius: '12px', cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Analyzing…' : '↻ Reanalyze'}
        </span>
        <span
          onClick={canApply ? onApplyFixes : undefined}
          title={canApply ? 'Fixes: ' + fixes.groups.map((g) => `${g.count} × ${g.label}`).join(', ') + '. Ctrl+Z undoes them all.' : 'No safe automatic fixes available right now'}
          style={{
            color: '#fff', background: canApply ? '#2f8f5b' : '#2a2e3d', fontSize: '12px',
            padding: '4px 14px', borderRadius: '12px', cursor: canApply ? 'pointer' : 'default', opacity: canApply ? 1 : 0.6,
          }}
        >
          ✔ Apply Fixes{fixes && fixes.count > 0 ? ` (${fixes.count})` : ''}
        </span>
        <label style={{ color: '#bbb', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
          <input type="checkbox" checked={useAi} onChange={(e) => onToggleAi(e.target.checked)} />
          Include AI review
        </label>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: fixNote ? '#7ee2a8' : '#6f748a', textAlign: 'right' }}>
          {fixNote
            ? fixNote
            : fixes && fixes.count > 0
              ? `Ready: ${fixes.groups.map((g) => `${g.count} × ${g.label}`).join(' · ')}`
              : data ? 'Apply Fixes only changes simple, safe things.' : ''}
        </span>
      </div>
    </div>
  );
}

export default QualityPanel;