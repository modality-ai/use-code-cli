import React from "react";

export interface SessionPageProps {
  name?: string;
}

export default function SessionPage(_props: SessionPageProps) {
  return (
    <div>
      <p className="text-text-muted">Loading session transcript...</p>
    </div>
  );
}

export async function loadData(props?: { params?: Record<string, string>; name?: string }): Promise<SessionPageProps> {
  return { name: props?.name || props?.params?.name };
}

export function clientScript(data: SessionPageProps): string {
  const initialName = JSON.stringify(data?.name || "");
  const style = "<style>.md-content,.md-content *{color:var(--color-text-primary,#e6e6e6)}.md-content h1,.md-content h2,.md-content h3{font-weight:700;margin:.6em 0 .3em}.md-content p{margin:.3em 0}.md-content pre,.md-content code{background:var(--color-surface,#1e1e1e);padding:2px 4px;border-radius:4px;white-space:pre-wrap}.md-content ul,.md-content ol{margin:.3em 0;padding-left:1.4em}.chat-input{display:flex;gap:8px;margin-top:12px}.chat-input input{flex:1;padding:8px 12px;border-radius:6px;border:1px solid var(--color-border,#333);background:var(--color-surface,#1e1e1e);color:var(--color-text-primary,#e6e6e6)}</style>";
  return style + `<script>
window.__SESSION_NAME__ = ${initialName};
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function App(){
  const params = new URLSearchParams(window.location.search);
  const name = window.__SESSION_NAME__ || params.get('name') || '';
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [autoScroll, setAutoScroll] = React.useState(true);
  const scrollRef = React.useRef(null);
  function load(){
    if (!name) { setError('missing name'); return; }
    fetch('/api/session?name=' + encodeURIComponent(name))
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); else setError(d.error || 'failed'); })
      .catch(e => setError(String(e)));
  }
  React.useEffect(() => { load(); }, [name]);
  // live updates via SSE ('load' events carry the same payload shape as /api/session)
  // EventSource never retries a non-200 response, so recreate it ourselves on error.
  React.useEffect(() => {
    if (!name) return;
    let es = null;
    let retry = null;
    const connect = () => {
      es = new EventSource('/api/session/events?name=' + encodeURIComponent(name));
      // the route sends nameless data: events → target is the default "message" event
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.error) setError(d.error); else { setError(null); setData(d); }
        } catch (e) { setError(String(e)); }
      };
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          if (retry) clearTimeout(retry);
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => { if (retry) clearTimeout(retry); if (es) es.close(); };
  }, [name]);
  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, autoScroll]);
  // latest chat content continues to arrive via the SSE stream above
  async function send(){
    if (!input.trim() || sending) return;
    setSending(true);
    setStatus('sending...');
    try {
      const r = await fetch('/api/talk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, message: input }) });
      const d = await r.json();
      if (d.success) { setStatus('sent'); setInput(''); load(); setTimeout(load, 2000); setTimeout(load, 5000); }
      else setStatus('error: ' + (d.error || 'failed'));
    } catch(e){ setStatus('error: ' + String(e)); }
    setSending(false);
  }
  if (error) return React.createElement('p', {className:'text-text-primary'}, 'Error: ' + error);
  if (!data) return React.createElement('p', {className:'text-text-muted'}, 'Loading ' + name + '...');
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return React.createElement('div', null,
    React.createElement('div', {className:'flex items-center gap-3 mb-md'},
      React.createElement('a', {href:'/sessions', className:'text-[12px] text-accent-collaboration hover:underline'}, '← Back to sessions'),
      React.createElement('h1', {className:'text-2xl font-semibold font-display'}, data.name || name)
    ),
    React.createElement('div', {className:'font-code text-[12px] text-text-muted mb-md'}, data.transcriptPath || ''),
    React.createElement('div', {ref: scrollRef, className:'border border-border rounded-sm p-3 bg-surface font-code text-[13px] whitespace-pre-wrap max-h-[70vh] overflow-auto'},
      entries.map((e,i) => {
        const label = e.role === 'user' ? '❯ ' : '⏺ ';
        const cls = e.role === 'user' ? 'text-accent-collaboration' : 'text-text-primary';
        const children = [
          React.createElement('div', {className: cls + ' font-semibold'}, label + (e.role === 'user' ? 'You' : 'Claude')),
          e.html ? React.createElement('div', {className:'pl-4 md-content max-w-none', dangerouslySetInnerHTML: {__html: e.html}}) : (e.text ? React.createElement('div', {className:'pl-4 whitespace-pre-wrap'}, esc(e.text)) : null)
        ];
        if (Array.isArray(e.tools)) {
          e.tools.forEach((t, ti) => {
            const inputStr = t.input != null ? JSON.stringify(t.input, null, 2) : '';
            children.push(React.createElement('details', {key:'t'+ti, className:'pl-4 mt-1 border border-border rounded-sm p-2'},
              React.createElement('summary', null, 'CLICK TO SEE ' + (t.name || 'tool')),
              React.createElement('pre', {className:'whitespace-pre-wrap text-[12px] mt-1'}, esc(inputStr)),
              t.resultHtml ? React.createElement('div', {className:'mt-1 md-content max-w-none', dangerouslySetInnerHTML: {__html: t.resultHtml}}) : null
            ));
          });
        }
        return React.createElement('div', {key:i, className:'mb-sm'}, children);
      })
    ),
    React.createElement('div', {className:'flex items-center gap-2 mt-2'},
      React.createElement('input', {type:'checkbox', checked: autoScroll, onChange: (ev) => setAutoScroll(ev.target.checked), id:'autoscroll'}),
      React.createElement('label', {htmlFor:'autoscroll', className:'text-[12px] text-text-muted'}, 'Auto-scroll to bottom')
    ),
    React.createElement('div', {className:'chat-input'},
      React.createElement('input', {value: input, onChange: (ev) => setInput(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') send(); }, placeholder: 'Send a message to this session...', disabled: sending}),
      React.createElement('button', {onClick: send, disabled: sending}, sending ? 'Sending...' : 'Send')
    ),
    status ? React.createElement('div', {className:'text-[12px] text-text-muted mt-1'}, status) : null
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script>`;
}