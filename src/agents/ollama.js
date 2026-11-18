// A real open-source AI agent that runs on your own computer through Ollama (free, offline).
// Uses Ollama's local HTTP API with tool calling. Same prompt and tools as every other agent.
//
// Needs: Ollama running (https://ollama.com), and a model with tool support, e.g. `ollama pull qwen3:8b`.
import { BASE_SYSTEM, HARDENED_RULES, TOOL_SPECS } from './shared.js';

const TOOLS = TOOL_SPECS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

// Models with a separate "thinking" mode. We turn it off so runs are fast and comparable.
const THINKING = /qwen3|deepseek-r1|gpt-oss|magistral/i;
// Qwen3 also needs its own switch in the prompt to stop thinking out loud.
const QWEN3 = /qwen3/i;
const clean = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();

export async function runOllama(env, { model = 'qwen3:8b', hardened = false, maxTurns = 14, host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434' } = {}) {
  const base = host.startsWith('http') ? host : 'http://' + host;
  const messages = [
    { role: 'system', content: BASE_SYSTEM + (hardened ? HARDENED_RULES : '') + (QWEN3.test(model) ? '\n/no_think' : '') },
    { role: 'user', content: env.scenario.instruction },
  ];
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0 };

  for (let turn = 0; turn < maxTurns; turn++) {
    let res;
    try {
      res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOLS,
          stream: false,
          ...(THINKING.test(model) ? { think: false } : {}),
          options: { temperature: 0, num_ctx: 8192 },
        }),
      });
    } catch (e) {
      throw new Error(`Could not reach Ollama at ${base}. Start it with \`ollama serve\`.`);
    }
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    usage.calls++;
    usage.input_tokens += data.prompt_eval_count || 0;
    usage.output_tokens += data.eval_count || 0;

    const msg = data.message || { role: 'assistant', content: '' };
    messages.push(msg);
    if (clean(msg.content)) env.say(clean(msg.content));

    const calls = msg.tool_calls || [];
    if (!calls.length) break;
    for (const c of calls) {
      const name = c.function && c.function.name;
      let args = (c.function && c.function.arguments) || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (e) { args = {}; }
      }
      let out;
      try {
        out = await env.call(name, args);
      } catch (e) {
        out = { error: e.message };
      }
      messages.push({ role: 'tool', tool_name: name, content: typeof out === 'string' ? out : JSON.stringify(out) });
    }
  }
  return usage;
}
