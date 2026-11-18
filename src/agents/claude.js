// A real LLM shopping agent (Claude), using the official Anthropic SDK and a manual tool loop.
// The loop is manual so every tool call can be recorded and every payment routed through the env.
//
// Needs: npm install   (installs @anthropic-ai/sdk)
//        credentials: ANTHROPIC_API_KEY, or a profile from `ant auth login`

import { BASE_SYSTEM, HARDENED_RULES, TOOL_SPECS } from './shared.js';

const TOOLS = TOOL_SPECS.map((t) => ({ ...t, strict: true }));

// Models that accept the server-side refusal fallback (see the Claude API docs).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5-2']);

let clientPromise = null;
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      let Anthropic;
      try {
        ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
      } catch (e) {
        throw new Error('The Anthropic SDK is not installed. Run `npm install` in the mandate-guard folder first.');
      }
      const { existsSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const hasCredentials =
        process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || existsSync(homedir() + '/.config/anthropic');
      if (!hasCredentials) throw new Error('No Anthropic API key found. Put ANTHROPIC_API_KEY=... in mandate-guard/.env (see the README).');
      return { Anthropic, client: new Anthropic() };
    })();
  }
  return clientPromise;
}

export async function runClaude(env, { model = 'claude-opus-5-5', effort = 'medium', hardened = false, maxTurns = 14 } = {}) {
  const { Anthropic, client } = await getClient();
  const system = BASE_SYSTEM + (hardened ? HARDENED_RULES : '');
  const messages = [{ role: 'user', content: env.scenario.instruction }];
  const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };

  for (let turn = 0; turn < maxTurns; turn++) {
    const params = { model, max_tokens: 16000, system, tools: TOOLS, messages, output_config: { effort } };
    let response;
    try {
      response = FALLBACK_MODELS.has(model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in mandate-guard/.env.');
      } else if (error instanceof Anthropic.RateLimitError) {
        await new Promise((r) => setTimeout(r, 20000));
        turn--;
        continue;
      }
      throw error;
    }
    usage.calls++;
    usage.input_tokens += response.usage.input_tokens || 0;
    usage.output_tokens += response.usage.output_tokens || 0;

    if (response.stop_reason === 'refusal') {
      env.log('refusal', { category: response.stop_details ? response.stop_details.category : null });
      break;
    }

    // Keep the full content (including thinking blocks) unchanged in the history.
    messages.push({ role: 'assistant', content: response.content });
    for (const block of response.content) if (block.type === 'text' && block.text.trim()) env.say(block.text.trim());

    if (response.stop_reason === 'end_turn') break;
    if (response.stop_reason === 'pause_turn') continue;

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) break;
    const results = [];
    for (const tu of toolUses) {
      try {
        const out = await env.call(tu.name, tu.input);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ error: e.message }), is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return usage;
}
