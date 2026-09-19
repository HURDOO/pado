import { useEffect, useState } from 'react';
import { Globe2, LockKeyhole, RefreshCw } from 'lucide-react';
import type { Pane, PreviewInfo } from '../../shared/protocol';
import { sandboxDocument } from './sandbox';
import { isIsolatedPreviewUrl } from '../../shared/preview-origin';

export function BrowserPane({
  pane,
  projectId,
  checkId,
  readOnly = false,
}: {
  pane: Pane;
  projectId: string;
  checkId?: string;
  readOnly?: boolean;
}) {
  const { id, server } = pane;
  const serverPort = server?.port;
  const previewKey = server ? `${server.port}:${server.path}` : '';
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [error, setError] = useState('');
  const [entryFailure, setEntryFailure] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [entry, setEntry] = useState<{ key: string; url: string } | null>(null);
  const apiPath = `/api/preview/${encodeURIComponent(id)}?${checkId ? `check=${encodeURIComponent(checkId)}&` : ''}`;
  useEffect(() => {
    if (!previewKey) return;
    let disposed = false;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(apiPath, {
          headers: { 'X-Pado-Project': projectId },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '앱 미리보기를 확인할 수 없습니다.');
        // Never embed generated code on Pado's own origin, even if a response is malformed.
        if (!isIsolatedPreviewUrl(result.url, location.origin, serverPort!))
          throw new Error('분리된 앱 미리보기 주소가 필요합니다.');
        if (!disposed) {
          setInfo(result);
          setError('');
        }
      } catch (error) {
        if (!disposed) setError((error as Error).message);
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [id, previewKey, projectId, checkId, apiPath, serverPort]);

  const entryKey =
    info?.state === 'running' ? `${projectId}:${info.epoch}:${info.url}:${reload}` : '';
  const entryError = entryFailure?.key === entryKey ? entryFailure.message : '';
  useEffect(() => {
    if (!entryKey || !serverPort) return;
    let disposed = false;
    void fetch(apiPath + 'access=1', { headers: { 'X-Pado-Project': projectId } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !isIsolatedPreviewUrl(result.url, location.origin, serverPort))
          throw new Error(result.error || '앱 미리보기 인증에 실패했습니다.');
        if (!disposed) {
          setEntry({ key: entryKey, url: result.url });
          setEntryFailure(null);
        }
      })
      .catch((error) => {
        if (!disposed) setEntryFailure({ key: entryKey, message: (error as Error).message });
      });
    return () => {
      disposed = true;
    };
  }, [apiPath, projectId, entryKey, serverPort]);

  if (!pane.server)
    return (
      <div className="preview-content">
        <div className="preview-label">
          <Globe2 size={13} />
          <span>생성 HTML 미리보기</span>
          <LockKeyhole size={12} />
          <small>{readOnly ? '읽기 전용' : '격리됨 · 조작은 내 화면에만'}</small>
        </div>
        <iframe
          title={pane.title}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          srcDoc={sandboxDocument(pane.content, undefined, readOnly)}
        />
      </div>
    );
  return (
    <div className="preview-content live-browser">
      <div className="preview-label">
        <Globe2 size={13} />
        <span>
          앱 서버 · :{pane.server.port}
          {pane.server.path === '/' ? '' : pane.server.path}
        </span>
        <small>
          {error || entryError
            ? '연결 오류'
            : info?.state === 'running'
              ? '서버에 연결됨'
              : info?.state === 'starting'
                ? '시작 중'
                : '서버 중지'}
        </small>
        {readOnly && <small className="browser-readonly">읽기 전용 · 변경 요청 차단</small>}
        <button
          type="button"
          className="icon-button"
          aria-label={`${pane.title} 새로고침`}
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error || entryError ? (
        <div className="preview-unavailable" role="alert">
          <strong>미리보기를 연결하지 못했어요</strong>
          <p>{error || entryError}</p>
        </div>
      ) : info?.state === 'running' && entry?.key === entryKey ? (
        <iframe
          key={entryKey}
          title={pane.title}
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
          src={entry.url}
        />
      ) : (
        <div className="preview-unavailable" role="status">
          <strong>
            {info?.state === 'starting'
              ? '앱 서버를 시작하고 있어요'
              : info?.state === 'running'
                ? '앱 미리보기에 연결하고 있어요'
                : '앱 서버가 실행 중이 아니에요'}
          </strong>
          <p>에이전트가 서버를 실행하면 이곳에 실제 앱이 연결됩니다.</p>
        </div>
      )}
    </div>
  );
}
