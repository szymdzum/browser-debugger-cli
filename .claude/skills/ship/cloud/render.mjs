// Renders the RemoteTrigger create body for one cloud-round agent:
//   node render.mjs <round> <agent> <sha> [run_once_at ISO, default now + 2 min] [--prompt]
// <round> is the session tag (s28): reports go to cloud-round/<round>-<agent>.
// The cloud environment id comes from SHIP_CLOUD_ENV (not kept in this public repo).
// --prompt prints the prompt text only (for review).
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * One section of an agent file (`<!-- AREA -->` up to the next marker).
 *
 * @param {string} spec agents/<agent>.md
 * @param {string} name AREA, TARGETS or COVERED
 */
export function section(spec, name) {
  const match = spec.match(new RegExp(`<!-- ${name} -->\\n([\\s\\S]*?)(?=\\n<!-- [A-Z]+ -->|$)`));
  if (!match) throw new Error(`no ${name} section`);
  return match[1].trim();
}

/**
 * The routine prompt for one agent, or the placeholders left open.
 *
 * @param {string} template routine-template.md
 * @param {string} spec agents/<agent>.md
 * @param {{ round: string, agent: string, sha: string }} run
 * @returns {{ prompt: string } | { open: string[] }}
 */
export function renderPrompt(template, spec, { round, agent, sha }) {
  const values = {
    ROUND: round,
    AGENT: agent,
    SHA: sha,
    AREA: section(spec, 'AREA'),
    TARGETS: section(spec, 'TARGETS'),
    COVERED: section(spec, 'COVERED'),
  };
  let prompt = template.replace(/^<!--[\s\S]*?-->\n/, '');
  for (const [key, value] of Object.entries(values)) prompt = prompt.split(`{{${key}}}`).join(value);
  const open = prompt.match(/\{\{\w+\}\}/g);
  return open ? { open } : { prompt };
}

/**
 * The RemoteTrigger create body.
 *
 * @param {string} prompt
 * @param {{ round: string, agent: string, at: string, environment: string }} run
 */
export function triggerBody(prompt, { round, agent, at, environment }) {
  return {
    name: `bdg ${round} cloud round: ${agent}`,
    run_once_at: at,
    enabled: true,
    job_config: {
      ccr: {
        environment_id: environment,
        events: [
          {
            data: {
              message: { content: prompt, role: 'user' },
              parent_tool_use_id: null,
              session_id: '',
              type: 'user',
              uuid: randomUUID(),
            },
          },
        ],
        session_context: {
          allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
          model: 'claude-sonnet-5-5',
          sources: [{ git_repository: { url: 'https://github.com/szymdzum/browser-debugger-cli' } }],
        },
      },
    },
  };
}

/** Command line entry */
function main() {
  const args = process.argv.slice(2);
  const promptOnly = args.includes('--prompt');
  const [round, agent, sha, at] = args.filter((a) => a !== '--prompt');
  if (!/^s\d+$/.test(round ?? '') || !agent || !/^[0-9a-f]{7,40}$/.test(sha ?? '')) {
    console.error('usage: node render.mjs <round, e.g. s28> <agent> <sha> [run_once_at] [--prompt]');
    return 2;
  }
  if (!existsSync(join(here, 'agents', `${agent}.md`))) {
    console.error(`no agents/${agent}.md; agents: ${readdirSync(join(here, 'agents')).map((f) => f.replace(/\.md$/, '')).join(', ')}`);
    return 2;
  }
  const environment = process.env.SHIP_CLOUD_ENV;
  if (!promptOnly && !environment) {
    console.error('SHIP_CLOUD_ENV must hold the cloud environment id (see the cloud-routines memory note)');
    return 2;
  }
  const result = renderPrompt(
    readFileSync(join(here, 'routine-template.md'), 'utf8'),
    readFileSync(join(here, 'agents', `${agent}.md`), 'utf8'),
    { round, agent, sha }
  );
  if ('open' in result) {
    console.error(`unfilled: ${result.open.join(' ')}`);
    return 1;
  }
  if (promptOnly) {
    process.stdout.write(result.prompt);
    return 0;
  }
  const when = at ?? new Date(Date.now() + 120_000).toISOString().replace(/\.\d+Z$/, 'Z');
  process.stdout.write(JSON.stringify(triggerBody(result.prompt, { round, agent, at: when, environment })));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
