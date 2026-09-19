export const taskStates = ['active', 'next', 'pending', 'paused', 'done'] as const;
export type TaskState = (typeof taskStates)[number];
export const taskLabels: Record<TaskState, string> = {
  active: '진행',
  next: '다음',
  pending: '대기',
  paused: '보류',
  done: '완료',
};
const markers: Record<string, TaskState> = {
  '-': 'active',
  '>': 'next',
  ' ': 'pending',
  '~': 'paused',
  x: 'done',
  X: 'done',
};

export function taskMarker(text: string) {
  const match = text.match(/^\[([ xX>~-])\]\s+(.+)$/);
  return match ? { state: markers[match[1]], text: match[2] } : undefined;
}
export function taskSummary(text: string) {
  const counts: Record<TaskState, number> = { active: 0, next: 0, pending: 0, paused: 0, done: 0 };
  let fence: { marker: string; length: number } | undefined;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const boundary = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (boundary) {
      if (!fence) fence = { marker: boundary[1][0], length: boundary[1].length };
      else if (
        boundary[1][0] === fence.marker &&
        boundary[1].length >= fence.length &&
        !boundary[2].trim()
      )
        fence = undefined;
      continue;
    }
    if (fence) continue;
    const list = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    const item = list && taskMarker(list[1]);
    if (item) counts[item.state]++;
  }
  return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}
