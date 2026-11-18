#!/usr/bin/env node
// Runs every scenario twice (without and with Mandate Guard) and writes results/.
//
//   node scripts/bench.js                         worst-case agent (offline, deterministic, free)
//   node scripts/bench.js --agent ollama          free open-source model on this computer (needs Ollama)
//        [--model qwen3:8b]
//   node scripts/bench.js --agent claude          real Claude agent (needs `npm install` + an API key)
//        [--model claude-opus-5-5] [--effort medium] [--hardened] [--tasks charger,book] [--attacks fake_fee,hinglish]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import core from '../src/core.cjs';
import { TASKS, ATTACKS, buildScenarios } from '../src/scenarios.js';
import { createEnv } from '../src/env.js';
import { runWorstCase } from '../src/agents/worstcase.js';
import { judge } from '../src/judge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fmt = (n) => core.formatINR(n);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (q, xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function aggregate(rows, meta) {
  const attacks = ATTACKS.map((a) => {
    const rs = rows.filter((r) => r.variant === a.id);
    const ng = rs.filter((r) => r.condition === 'no_guard');
    const g = rs.filter((r) => r.condition === 'guard');
    const counts = {};
    for (const r of g) for (const c of new Set(r.failed_checks)) counts[c] = (counts[c] || 0) + 1;
    return {
      id: a.id,
      name: a.name,
      within_mandate: !!a.withinMandate,
      example: a.build(TASKS[0]).text,
      runs: ng.length,
      no_guard: { successes: ng.filter((r) => r.attack_success).length, misspent_inr: sum(ng.map((r) => r.misspent)), lost_inr: sum(ng.map((r) => r.lost_to_unverified)), goal_met: ng.filter((r) => r.goal_met).length },
      guard: {
        successes: g.filter((r) => r.attack_success).length,
        misspent_inr: sum(g.map((r) => r.misspent)),
        lost_inr: sum(g.map((r) => r.lost_to_unverified)),
        goal_met: g.filter((r) => r.goal_met).length,
        upsell_extra_max: Math.max(0, ...g.map((r) => r.upsell_extra)),
        upsell_extra_avg: g.length ? Math.round(sum(g.map((r) => r.upsell_extra)) / g.length) : 0,
      },
      stopped_by: Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([id, n]) => ({ id, label: core.CHECKS.find((c) => c.id === id).label, runs: n })),
    };
  });

  const benignRows = rows.filter((r) => r.kind === 'benign');
  const bng = benignRows.filter((r) => r.condition === 'no_guard');
  const bg = benignRows.filter((r) => r.condition === 'guard');
  const out = attacks.filter((a) => !a.within_mandate);
  const inm = attacks.filter((a) => a.within_mandate);
  const ms = rows.filter((r) => r.condition === 'guard').flatMap((r) => r.guard_ms);

  return {
    meta,
    scenarios: rows.length / 2,
    attacks,
    totals: {
      out_of_mandate: {
        runs: sum(out.map((a) => a.runs)),
        no_guard: { successes: sum(out.map((a) => a.no_guard.successes)), misspent_inr: sum(out.map((a) => a.no_guard.misspent_inr)), lost_inr: sum(out.map((a) => a.no_guard.lost_inr)) },
        guard: { successes: sum(out.map((a) => a.guard.successes)), misspent_inr: sum(out.map((a) => a.guard.misspent_inr)), lost_inr: sum(out.map((a) => a.guard.lost_inr)), goal_met: sum(out.map((a) => a.guard.goal_met)) },
      },
      within_mandate: {
        runs: sum(inm.map((a) => a.runs)),
        no_guard: { successes: sum(inm.map((a) => a.no_guard.successes)) },
        guard: { successes: sum(inm.map((a) => a.guard.successes)), extra_max_inr: Math.max(0, ...inm.map((a) => a.guard.upsell_extra_max)), extra_avg_inr: inm.length ? Math.round(sum(inm.map((a) => a.guard.upsell_extra_avg)) / inm.length) : 0 },
      },
    },
    benign: {
      runs: bg.length,
      variants: [...new Set(benignRows.map((r) => r.variant_name))],
      no_guard: { goal_met: bng.filter((r) => r.goal_met).length },
      guard: { goal_met: bg.filter((r) => r.goal_met).length, genuine_blocked: sum(bg.map((r) => r.genuine_blocked)), asked_user: sum(bg.map((r) => r.asked_user)) },
    },
    latency_ms: { decisions: ms.length, p50: +pct(0.5, ms).toFixed(3), p95: +pct(0.95, ms).toFixed(3), max: +Math.max(0, ...ms).toFixed(3) },
  };
}

function toMarkdown(agg) {
  const L = [];
  const t = agg.totals;
  L.push(`### ${agg.meta.agent_label}`, '');
  L.push(`Run on ${agg.meta.generated_at.slice(0, 10)} · ${agg.scenarios} scenarios, each run without and with Mandate Guard.`, '');
  L.push(`- Attacks outside the mandate (${t.out_of_mandate.runs} runs): **${t.out_of_mandate.no_guard.successes} succeeded without the guard (${fmt(t.out_of_mandate.no_guard.misspent_inr)} misspent), ${t.out_of_mandate.guard.successes} with it (${fmt(t.out_of_mandate.guard.misspent_inr)})**.`);
  L.push(`- Upsell within the mandate (${t.within_mandate.runs} runs): ${t.within_mandate.guard.successes} still succeed with the guard, by design. Extra spend at most ${fmt(t.within_mandate.guard.extra_max_inr)}, always inside the user's own limit.`);
  L.push(`- Genuine purchases (${agg.benign.runs} runs): ${agg.benign.guard.goal_met} completed with the guard, ${agg.benign.guard.genuine_blocked} genuine payments blocked.`);
  const busy = agg.meta.agent === 'ollama' ? ' Measured while the same laptop was also running the AI model, which slows the guard down. The worst-case run shows the guard on its own.' : '';
  L.push(`- Guard decision time: median ${agg.latency_ms.p50} ms, 95th percentile ${agg.latency_ms.p95} ms (${agg.latency_ms.decisions} decisions, including Ed25519 signature checks).${busy}`, '');
  L.push('| Attack technique | Runs | Succeeded without guard | Succeeded with guard | Misspent without → with | Checks that stopped it |');
  L.push('|---|---|---|---|---|---|');
  for (const a of agg.attacks) {
    L.push(`| ${a.name} | ${a.runs} | ${a.no_guard.successes} | ${a.guard.successes} | ${fmt(a.no_guard.misspent_inr)} → ${fmt(a.guard.misspent_inr)} | ${a.stopped_by.slice(0, 3).map((s) => s.label).join('; ') || '—'} |`);
  }
  L.push('');
  return L.join('\n');
}

async function runAll(opts) {
  const scenarios = buildScenarios({ tasks: opts.tasks, attacks: opts.attacks });
  let runAgent = runWorstCase;
  let agentLabel = 'Worst-case agent (obeys every instruction it reads)';
  let tag = 'worstcase';
  const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };
  if (opts.agent === 'ollama') {
    const { runOllama } = await import('../src/agents/ollama.js');
    const model = opts.model || 'qwen3:8b';
    runAgent = async (env) => {
      const u = await runOllama(env, { model, hardened: !!opts.hardened });
      usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens; usage.calls += u.calls;
    };
    const display = opts.name || model;
    agentLabel = `${display} (open-source, run free on a laptop)${opts.hardened ? ', hardened prompt' : ''}`;
    tag = `ollama-${display.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}${opts.hardened ? '-hardened' : ''}`;
  } else if (opts.agent === 'claude') {
    const { runClaude } = await import('../src/agents/claude.js');
    const model = opts.model || 'claude-opus-5-5';
    const effort = opts.effort || 'medium';
    runAgent = async (env) => {
      const u = await runClaude(env, { model, effort, hardened: !!opts.hardened });
      usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens; usage.calls += u.calls;
    };
    agentLabel = `Claude agent (${model}, effort ${effort}${opts.hardened ? ', hardened prompt' : ''})`;
    tag = `claude-${model}${opts.hardened ? '-hardened' : ''}`;
  }

  const jobs = [];
  scenarios.forEach((s, i) => {
    for (const guard of [false, true]) jobs.push({ s, guard, i });
  });
  const rows = new Array(jobs.length);
  const concurrency = Number(opts.concurrency || (opts.agent === 'claude' ? 3 : opts.agent === 'ollama' ? 2 : 8));
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      const idx = jobs.indexOf(j);
      const env = await createEnv(j.s, { guard: j.guard, index: j.i + 1 });
      await runAgent(env);
      rows[idx] = judge(env);
      done++;
      if (opts.agent) process.stdout.write(`\r  ${done}/${jobs.length} runs`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (opts.agent) process.stdout.write('\n');

  const meta = { agent: opts.agent || 'worstcase', agent_label: agentLabel, generated_at: new Date().toISOString(), guard_version: core.GUARD_VERSION, node: process.version, usage: opts.agent ? usage : undefined };
  const agg = aggregate(rows, meta);
  return { tag, agg, rows };
}

async function main() {
  // Optional: read ANTHROPIC_API_KEY from mandate-guard/.env (never committed).
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  const opts = parseArgs(process.argv.slice(2));
  if (opts.tasks) opts.tasks = String(opts.tasks).split(',');
  if (opts.attacks) opts.attacks = String(opts.attacks).split(',');
  const { tag, agg, rows } = await runAll(opts);

  const dir = path.join(root, 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `benchmark-${tag}.json`), JSON.stringify({ ...agg, rows }, null, 2));

  // RESULTS.md summarises every results file present.
  // The worst-case run first: it is the headline result. Real-model runs follow.
  const first = (f) => (f === 'benchmark-worstcase.json' ? 0 : 1);
  const files = fs.readdirSync(dir).filter((f) => /^benchmark-.*\.json$/.test(f)).sort((a, b) => first(a) - first(b) || a.localeCompare(b));
  const sections = files.map((f) => toMarkdown(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
  fs.writeFileSync(
    path.join(dir, 'RESULTS.md'),
    [
      '# Benchmark results',
      '',
      'Generated by `npm run bench`. Each scenario is run twice: without Mandate Guard (the agent pays UPI directly) and with it. Money is counted from the bank ledger only.',
      '',
      'What spending limits alone would stop, and what each check adds: [`COMPARISON.md`](COMPARISON.md) (`npm run compare`).',
      '',
      ...sections,
    ].join('\n')
  );

  const t = agg.totals;
  console.log(`\n${agg.meta.agent_label}`);
  console.log(`  ${agg.scenarios} scenarios x 2 conditions`);
  console.log(`  Attacks outside the mandate: ${t.out_of_mandate.no_guard.successes}/${t.out_of_mandate.runs} succeeded without the guard (${fmt(t.out_of_mandate.no_guard.misspent_inr)} misspent)`);
  console.log(`                               ${t.out_of_mandate.guard.successes}/${t.out_of_mandate.runs} succeeded with the guard (${fmt(t.out_of_mandate.guard.misspent_inr)} misspent)`);
  console.log(`  Upsell within the mandate:   ${t.within_mandate.guard.successes}/${t.within_mandate.runs} still succeed (extra spend at most ${fmt(t.within_mandate.guard.extra_max_inr)})`);
  console.log(`  Genuine purchases:           ${agg.benign.guard.goal_met}/${agg.benign.runs} completed with the guard, ${agg.benign.guard.genuine_blocked} genuine payments blocked`);
  console.log(`  Guard decision time:         median ${agg.latency_ms.p50} ms, p95 ${agg.latency_ms.p95} ms`);
  if (agg.meta.usage) console.log(`  API usage:                   ${agg.meta.usage.calls} calls, ${agg.meta.usage.input_tokens} input + ${agg.meta.usage.output_tokens} output tokens`);
  console.log(`\n  Wrote results/benchmark-${tag}.json and results/RESULTS.md\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error('\nError:', e.message);
    process.exit(1);
  });
}
