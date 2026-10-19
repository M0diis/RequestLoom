const STRING_OR_VARIABLE = /"(?:[^"\\]|\\.)*"|\{\{[^{}]*\}\}/g;

/** Pretty-prints JSON, tolerating {{variables}} inside strings or used as bare values. */
export function formatJson(source: string): string {
  const variables: string[] = [];
  const tokenized = source.replace(STRING_OR_VARIABLE, (match) => {
    if (match.startsWith('"')) {
      return match.replace(/\{\{[^{}]*\}\}/g, (v) => {
        variables.push(v);
        return `__RL_VAR_${variables.length - 1}__`;
      });
    }
    variables.push(match);
    return `"__RL_BARE_${variables.length - 1}__"`;
  });

  return JSON.stringify(JSON.parse(tokenized), null, 2)
    .replace(/"__RL_BARE_(\d+)__"/g, (_, i: string) => variables[Number(i)])
    .replace(/__RL_VAR_(\d+)__/g, (_, i: string) => variables[Number(i)]);
}

/** Pretty-prints XML without parsing it, so {{variables}} and odd content survive untouched. */
export function formatXml(source: string): string {
  const tokens = source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];
  const lines: string[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('<')) {
      const text = token.trim();
      if (text) lines.push('  '.repeat(depth) + text);
      continue;
    }

    const isOpen = /^<[^!?/]/.test(token) && !token.endsWith('/>');
    const isClose = token.startsWith('</');

    if (isOpen) {
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (next !== undefined && !next.startsWith('<') && after?.startsWith('</') && next.trim() && !next.includes('\n')) {
        lines.push('  '.repeat(depth) + token + next.trim() + after);
        i += 2;
        continue;
      }
      lines.push('  '.repeat(depth) + token);
      depth++;
    } else if (isClose) {
      depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + token);
    } else {
      lines.push('  '.repeat(depth) + token);
    }
  }

  return lines.join('\n');
}
