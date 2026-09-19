import type { ReactNode } from 'react';
import { taskLabels, taskMarker } from '../../shared/tasks';

// Text-only Markdown: no raw HTML or remotely fetched images.
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`'))
      return <code key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith('**') && token.endsWith('**'))
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link)
      return (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      );
    return token;
  });
}
export function Markdown({ text, tasks = false }: { text: string; tasks?: boolean }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index],
      key = index;
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const language = fence[2].trim(),
        code: string[] = [];
      index++;
      const endFence = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (index < lines.length && !endFence.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(
        <div className="markdown-code" key={key}>
          {language && <span>{language}</span>}
          <pre>
            <code>{code.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }
    const cells = (value: string) =>
      value
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/\\\|/g, '|'));
    const separators = cells(lines[index + 1] || '');
    if (
      line.includes('|') &&
      separators.length > 1 &&
      separators.every((cell) => /^:?-{3,}:?$/.test(cell)) &&
      cells(line).length === separators.length
    ) {
      const headers = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|'))
        rows.push(cells(lines[index++]));
      blocks.push(
        <div
          className="markdown-table"
          role="region"
          aria-label="표 가로 스크롤"
          tabIndex={0}
          key={key}
        >
          <table>
            <thead>
              <tr>
                {headers.map((header, column) => (
                  <th scope="col" key={column}>
                    {inline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, column) => (
                    <td key={column}>{inline(row[column] || '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push(
        heading[1].length <= 2 ? (
          <h2 key={key}>{inline(heading[2])}</h2>
        ) : (
          <h3 key={key}>{inline(heading[2])}</h3>
        ),
      );
      index++;
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = !list[1],
        items: ReactNode[] = [];
      while (index < lines.length) {
        const match = lines[index].match(ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        const task = tasks && taskMarker(match[1]);
        items.push(
          task ? (
            <li key={index} className={`task-item task-${task.state}`}>
              <span className="task-status">{taskLabels[task.state]}</span>
              <span className="task-description">{inline(task.text)}</span>
            </li>
          ) : (
            <li key={index}>{inline(match[1])}</li>
          ),
        );
        index++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    if (/^\d\d\s\//.test(line)) {
      blocks.push(<h3 key={key}>{inline(line)}</h3>);
      index++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(<blockquote key={key}>{inline(line.replace(/^>\s?/, ''))}</blockquote>);
      index++;
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      index++;
      continue;
    }
    blocks.push(<p key={key}>{inline(line)}</p>);
    index++;
  }
  return <div className="markdown">{blocks}</div>;
}
