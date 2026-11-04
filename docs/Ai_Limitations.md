# AI Limitations and Fallback Behaviour

This document explains where the AI features of the IDE can be wrong, and what the IDE does when the AI is not available.

## 1. How the quality analysis is built

| Layer | What it does | Reliability |
|---|---|---|
| Rule-based checks | Metrics (complexity, nesting, duplication) and known bad patterns | Deterministic: the same file always gives the same result |
| Real tools | ESLint (JavaScript), Python checker and pyflakes (Python), javac (Java) | Deterministic, as reliable as the tool |
| AI review | Finds bugs and improvements that rules cannot see | Not deterministic, can be wrong |

The score (0-100) uses only the first two layers. AI findings are shown next to it and do not change the score.

## 2. Where the AI can be wrong

- **Wrong or invented problems (hallucination).** A model may report a problem that does not exist or describe code that is not in the file.
- **Wrong line numbers.** Small models often point to a nearby line.
- **Missed problems.** The AI can miss real bugs, especially runtime errors such as an undefined variable. In testing, a small local model missed an undefined function that ESLint found.
- **Different answers each time.** The same code can give a different review on a second run.
- **Large files are cut.** Only the first 12,000 characters of a file are sent to the AI.
- **Small local models are weaker.** A local model such as Qwen2.5-Coder is private and free but less accurate than a large cloud model.
- **Format errors.** The AI must answer in JSON. If it does not, the IDE asks once more, and if that fails the AI result is skipped.
- **No execution.** The AI reads the code but never runs it or its tests, so it cannot prove that code works.
- **Security.** An AI security review is not a penetration test. Absence of findings does not mean the code is secure.

## 3. How the IDE checks the AI

Every AI finding is compared with the rule and tool findings:

1. A finding that points to a blank or comment-only line is removed.
2. A finding that matches a tool finding on the same category and line is merged, and the tool finding is marked "the AI agrees".
3. A finding near any tool finding is shown as **confirmed nearby**.
4. A finding that nothing backs up is shown as **AI only: please verify**.

## 4. When to rely on static analysis instead

| Situation | Rely on |
|---|---|
| Syntax errors, undefined names, compile errors | The tools (ESLint, Python, javac) |
| Complexity, nesting, duplication, function length | The built-in metrics |
| Known insecure patterns (eval, SQL built from text, weak hashes) | The built-in rules |
| Vulnerable dependencies | npm audit |
| Design advice, naming, readability, logic ideas | AI, but review it yourself |
| Anything marked "AI only" | Check it manually before acting |

## 5. Fallback when the AI fails

| Failure | What the user sees | What the IDE does |
|---|---|---|
| AI timeout (more than 150 s) | "The AI took too long to answer" | Shows the static and tool results, offers Try again |
| Usage limit or quota (HTTP 429) | "The AI service reached its usage limit" | Shows the static results; user can pick another model |
| Ollama not running or no internet | "Could not reach the AI service" | Shows the static results |
| Wrong or missing API key | "The AI service rejected the request" | Shows the static results |
| Reply is not valid JSON | Retried once, then "format could not be read" | Shows the static results |
| ESLint, Python or JDK missing | "Skipped checks" note | Other checks still run |
| No internet for npm audit | "No internet connection" | The rest of the analysis is unaffected |

The panel is never blank: the rule-based result is always shown.

## 4. Performance measurements

- `POST /api/benchmark/load` load-tests the backend (requests per second, p50, p95, p99).
- `POST /api/benchmark/ai-latency` measures AI response time (the first run of a local model includes loading it).
- Each quality run shows its own timings (static, tools, AI) and saves them in the `quality_runs` table.

## 5. Not included

- SonarQube is not integrated. It needs a separate server and scanner. It is a possible future extension.
- TypeScript files use the built-in rules only (no ESLint run).
- Only the open file is analyzed, not the whole project.