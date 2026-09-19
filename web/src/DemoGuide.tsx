import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Compass, X } from 'lucide-react';
import type { Snapshot } from '../../shared/protocol';
import './DemoGuide.css';

function guidance({ stage, me, workspace }: Snapshot, connected: boolean) {
  if (!connected)
    return {
      step: 'connecting',
      title: '연결을 확인하고 있어요',
      text: '다시 연결되면 현재 작업에 맞는 안내가 이어져요.',
    };
  if (workspace.switching)
    return {
      step: 'switching',
      title: '프로젝트를 전환하고 있어요',
      text: '잠시 기다려 주세요. 전환이 끝나면 참여할 수 있어요.',
    };
  if ((workspace.viewedId ?? workspace.activeId) !== workspace.activeId)
    return {
      step: 'browsing',
      title: '지금은 둘러보는 중이에요',
      text: '이 프로젝트는 읽기 전용이에요. 직접 요청하려면 ‘참여 프로젝트로 돌아가기’를 눌러 주세요.',
    };
  if (stage.phase === 'error' && !stage.speaker)
    return {
      step: 'error',
      title: '작업 상태를 확인해 주세요',
      text: 'Agent에 표시된 안내를 확인해 주세요. 진행이 어려우면 데모 진행자에게 알려 주세요.',
    };

  if (stage.turn) {
    const canAnswer = me.admin || stage.turn.participantId === me.id;
    if (stage.phase === 'waiting') {
      const input = stage.panes.find((pane) => pane.kind === 'input' && pane.status === 'active');
      if (!canAnswer)
        return {
          step: 'watching-input',
          title: '요청자의 응답을 기다리고 있어요',
          text: input
            ? '어떤 판단이 필요해서 Input이 열렸는지 살펴보세요. 요청자가 응답하면 AI가 작업을 이어가요.'
            : 'Agent의 진행 상황을 지켜봐 주세요. 지금은 요청자가 응답할 차례예요.',
        };
      return {
        step: 'input',
        title: input?.decision ? '원하는 안을 골라 주세요' : '입력 요청을 확인해 주세요',
        text: input
          ? input.decision
            ? 'Input 화면에서 원하는 안을 고르고 확인해 주세요. 응답하면 AI가 작업을 이어가요.'
            : 'Input 화면에 요청한 정보를 입력해 주세요. 필요한 순간에만 이런 화면이 나타나요.'
          : 'Agent가 응답을 기다리고 있어요. 화면에 표시된 안내를 확인해 주세요.',
      };
    }
    return {
      step: 'working',
      title: stage.turn.participantId === me.id ? 'AI가 작업하고 있어요' : '지금은 함께 관람해요',
      text: '필요한 화면이 나타나는 걸 지켜보세요. 판단이나 결과 확인이 필요할 때 작업 공간이 달라져요.',
    };
  }
  if (stage.speaker)
    return stage.speaker.participantId === me.id
      ? {
          step: 'request',
          title: '이렇게 요청해 보세요',
          text: '원하는 변화와 직접 고르고 싶은 부분을 설명해 보세요. 비교가 필요하면 선택지를 먼저 보여달라고 해도 좋아요.',
        }
      : {
          step: 'watching-request',
          title: '다른 참가자가 요청을 준비하고 있어요',
          text: '잠시 기다려 주세요. 요청이 시작되면 필요한 화면이 나타나는 과정을 함께 볼 수 있어요.',
        };
  const browser = stage.panes.some((pane) => pane.kind === 'browser');
  const review = stage.panes.some((pane) => pane.kind === 'review');
  if (browser || review)
    return {
      step: 'result',
      title: '열린 결과 화면을 확인해 보세요',
      text:
        browser && review
          ? 'Browser에서 실행 화면을, Review에서 변경점과 검증 내용을 살펴보세요.'
          : browser
            ? 'Browser에서 실행 화면을 확인해 보세요. 더 바꾸고 싶은 점은 다시 손을 들고 요청할 수 있어요.'
            : 'Review에서 변경점과 검증 내용을 살펴보세요. 실패하거나 아직 확인하지 못한 항목도 확인해 주세요.',
    };
  return {
    step: 'start',
    title: '손들고 체험을 시작해 보세요',
    text: '‘손들고 참여하기’를 누르면 요청할 수 있어요. 현재 프로젝트에서 바꾸고 싶은 점을 생각해 보세요.',
  };
}

const dismissalKey = 'pado-demo-guide-dismissed';
const smallViewport = () => (window.visualViewport?.height ?? window.innerHeight) < 600;

export function DemoGuide({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(dismissalKey) !== 'true';
    } catch {
      return true;
    }
  });
  const [compact, setCompact] = useState(smallViewport);
  const [expandedInCompact, setExpandedInCompact] = useState(false);
  const previousCompact = useRef(compact);
  const focusOnToggle = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const expanded = open && (!compact || expandedInCompact);
  const guide = guidance(snapshot, connected);

  useEffect(() => {
    const update = () => {
      const next = smallViewport();
      if (next !== previousCompact.current) {
        previousCompact.current = next;
        setCompact(next);
        setExpandedInCompact(false);
      }
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    // Stage changes never move focus away from the terminal or an Input pane.
    if (!focusOnToggle.current) return;
    focusOnToggle.current = false;
    (expanded ? closeButton.current : launcher.current)?.focus();
  }, [expanded]);

  const toggle = (next: boolean) => {
    focusOnToggle.current = true;
    setOpen(next);
    setExpandedInCompact(next);
    try {
      sessionStorage.setItem(dismissalKey, String(!next));
    } catch {
      // The card remains usable when browser storage is unavailable.
    }
  };

  return (
    <aside className="demo-guide" aria-label="데모 안내" data-step={guide.step}>
      {expanded ? (
        <div className="demo-guide-card" id="demo-guide-card">
          <div className="demo-guide-header">
            <span>
              <Compass size={15} aria-hidden="true" /> 데모 안내
            </span>
            <button
              ref={closeButton}
              type="button"
              className="icon-button"
              aria-label="데모 안내 닫기"
              onClick={() => toggle(false)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h2>{guide.title}</h2>
            <p>{guide.text}</p>
          </div>
        </div>
      ) : (
        <button
          ref={launcher}
          type="button"
          className="demo-guide-launcher"
          aria-label="데모 안내 열기"
          aria-expanded={false}
          title={guide.title}
          onClick={() => toggle(true)}
        >
          <CircleHelp size={16} aria-hidden="true" /> 데모 안내
        </button>
      )}
    </aside>
  );
}
