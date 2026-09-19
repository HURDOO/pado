import { Hand } from 'lucide-react';
import type { Snapshot } from '../../shared/protocol';

/** The server's lease/turn is authoritative, including an owner who went offline. */
export function SpeakerStatus({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const { stage, me, workspace } = snapshot;
  const readOnly = (workspace.viewedId ?? workspace.activeId) !== workspace.activeId;
  const ownerId = stage.turn?.participantId ?? stage.speaker?.participantId;
  const ownerName = ownerId
    ? stage.participants.find((participant) => participant.id === ownerId)?.nickname ||
      (ownerId === me.id ? me.nickname : '참가자')
    : '';
  const active = connected && !workspace.switching && !readOnly && !!ownerId;
  const label = !connected
    ? '상태 확인 중'
    : workspace.switching
      ? '프로젝트 전환 중'
      : readOnly
        ? '읽기 전용'
        : stage.turn
          ? stage.phase === 'waiting'
            ? '응답 대기'
            : '작업 중'
          : stage.speaker
            ? '발언 중'
            : '발언권 비어 있음';
  return (
    <span
      className={`speaker-indicator${active ? ' has-speaker' : ''}`}
      role="status"
      aria-label="현재 발언권"
      aria-live="polite"
      aria-atomic="true"
      title={active ? `${label} · ${ownerName}${ownerId === me.id ? ' (나)' : ''}` : label}
    >
      {active && <Hand size={12} aria-hidden="true" />}
      <span className="speaker-indicator-label">{label}</span>
      {active && <strong className="speaker-nickname">{ownerName}</strong>}
    </span>
  );
}
