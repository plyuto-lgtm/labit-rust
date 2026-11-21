// The status line the page shows for the agent's work (labit reply --progress, the hooks' own line) is plain words:
// "reading the page", "editing a file", "running a command". An agent that pastes what it is running (a shell line, a
// heredoc, a python one-liner, a path with flags) is not telling the person anything, and its text can carry things
// that don't belong on a page. This is the one place a line passes before it is kept.

// What a command looks like and prose does not: a heredoc, a pipe or chain, a substitution, a flag, a path of two or more
// parts, or a first word that is a program.
const RAW = [
  /<<|\$\(|`|&&|\|\||\s\|\s|\s>>?\s|\\n/,
  /(^|\s)--?[a-z][\w-]*(=|\s|$)/i,
  /(^|\s)(~|\.{1,2})?(\/[\w.@+-]+){2,}/,
  /^(sudo|cd|git|npm|npx|node|python3?|pip3?|bash|sh|zsh|cat|sed|awk|grep|rg|ls|find|curl|wget|echo|printf|rm|mv|cp|mkdir|touch|chmod|make|yarn|pnpm|docker|cargo|go|labit|tee|head|tail|export|env|xargs)(\s|$)/,
];
const EDIT = /<<|\s>>?\s|^sed\s+-i|^tee\b|^(edit|edits|editing|write|writes|writing|patch|patching|apply|applying|create|creating|fix|fixing)\b/i;
const READ = /^(cat|head|tail|less|grep|rg|ls|find|awk|sed|curl|wget|read|reads|reading|look|looking|open|opening|search|searching|check|checking)\b/i;

/**
 * One plain line for the page: the text as it is when it is words, else what kind of work it was.
 * @param {string} line the one-line text the agent (or its hook) sent
 */
export function plainStatus(line) {
  if (!RAW.some((re) => re.test(line))) return line;
  return EDIT.test(line) ? 'editing a file' : READ.test(line) ? 'reading the page' : 'running a command';
}

/**
 * The pill's line for a session's name: "Session ooze", and "Session 1a2b3c4d" for a name that already starts with the
 * word (the default is "session 1a2b3c4d"), so the page never says "Session session 1a2b3c4d".
 * @param {string} name
 */
export const sessionLine = (name) => name.replace(/^(session\s+)?/i, 'Session ');
