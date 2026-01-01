#!/usr/bin/env node
/**
 * bird - CLI tool for posting tweets and replies
 *
 * Usage:
 *   bird tweet "Hello world!"
 *   bird reply <tweet-id> "This is a reply"
 *   bird reply <tweet-url> "This is a reply"
 *   bird read <tweet-id-or-url>
 */

import { Command } from 'commander';
import { collectCookieSource, createCliContext } from './cli/shared.js';
import { registerBookmarksCommand } from './commands/bookmarks.js';
import { registerCheckCommand } from './commands/check.js';
import { registerHelpCommand } from './commands/help.js';
import { registerPostCommands } from './commands/post.js';
import { registerQueryIdsCommand } from './commands/query-ids.js';
import { registerReadCommands } from './commands/read.js';
import { registerSearchCommands } from './commands/search.js';
import { registerUserCommands } from './commands/users.js';
import { resolveCliInvocation } from './lib/cli-args.js';
import { getCliVersion } from './lib/version.js';

const program: Command = new Command();

const rawArgs: string[] = process.argv.slice(2);
const normalizedArgs: string[] = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

const ctx = createCliContext(normalizedArgs);

const collect = (value: string, previous: string[] = []): string[] => {
  previous.push(value);
  return previous;
};

const KNOWN_COMMANDS = new Set([
  'tweet',
  'reply',
  'query-ids',
  'read',
  'replies',
  'thread',
  'search',
  'mentions',
  'bookmarks',
  'following',
  'followers',
  'likes',
  'help',
  'whoami',
  'check',
]);

program.addHelpText(
  'beforeAll',
  () => `${ctx.colors.banner('bird CLI')} ${ctx.colors.subtitle('— fast X CLI for tweeting, replying, and reading')}`,
);

program.name('bird').description('Post tweets and replies via Twitter/X GraphQL API').version(getCliVersion());

const formatExample = (command: string, description: string): string =>
  `${ctx.colors.command(`  ${command}`)}\n${ctx.colors.muted(`    ${description}`)}`;

program.addHelpText(
  'afterAll',
  () =>
    `\n${ctx.colors.section('Examples')}\n${[
      formatExample('bird whoami', 'Show the logged-in account via GraphQL cookies'),
      formatExample('bird --firefox-profile default-release whoami', 'Use Firefox profile cookies'),
      formatExample('bird tweet "hello from bird"', 'Send a tweet'),
      formatExample('bird replies https://x.com/user/status/1234567890123456789', 'Check replies to a tweet'),
    ].join('\n\n')}`,
);

program
  .option('--auth-token <token>', 'Twitter auth_token cookie')
  .option('--ct0 <token>', 'Twitter ct0 cookie')
  .option('--chrome-profile <name>', 'Chrome profile name for cookie extraction', ctx.config.chromeProfile)
  .option('--firefox-profile <name>', 'Firefox profile name for cookie extraction', ctx.config.firefoxProfile)
  .option('--cookie-timeout <ms>', 'Cookie extraction timeout in milliseconds (keychain/OS helpers)')
  .option(
    '--cookie-source <source>',
    'Cookie source for browser cookie extraction (repeatable)',
    collectCookieSource,
    [],
  )
  .option('--media <path>', 'Attach media file (repeatable, up to 4 images or 1 video)', collect, [])
  .option('--alt <text>', 'Alt text for the corresponding --media (repeatable)', collect, [])
  .option('--timeout <ms>', 'Request timeout in milliseconds')
  .option('--quote-depth <depth>', 'Max quoted tweet depth (default: 1; 0 disables)')
  .option('--plain', 'Plain output (stable, no emoji, no color)')
  .option('--no-emoji', 'Disable emoji output')
  .option('--no-color', 'Disable ANSI colors (or set NO_COLOR)');

program.hook('preAction', (_thisCommand, actionCommand) => {
  ctx.applyOutputFromCommand(actionCommand);
});

registerHelpCommand(program, ctx);
registerQueryIdsCommand(program, ctx);
registerPostCommands(program, ctx);
registerReadCommands(program, ctx);
registerSearchCommands(program, ctx);
registerBookmarksCommand(program, ctx);
registerUserCommands(program, ctx);
registerCheckCommand(program, ctx);

const { argv, showHelp } = resolveCliInvocation(normalizedArgs, KNOWN_COMMANDS);

if (showHelp) {
  program.outputHelp();
  process.exit(0);
}

if (argv) {
  program.parse(argv);
} else {
  program.parse(['node', 'bird', ...normalizedArgs]);
}
