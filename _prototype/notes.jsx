// Notes & callouts drawer
const { useState: useStateND } = React;

function NotesDrawer({ open, onClose, items, onJump, onRemove }) {
  const I = window.Icons;
  const [tab, setTab] = useStateND("all");
  const filtered = items.filter(n => tab === "all" ? true : n.kind === tab);
  const notes = items.filter(n => n.kind === "note").length;
  const callouts = items.filter(n => n.kind === "callout").length;

  return (
    <>
      <div className={`drawer-scrim ${open ? "open" : ""}`} onClick={onClose}></div>
      <aside className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="drawer-head">
          <h3><I.Bookmark className="ic"/> Notes &amp; Callouts</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <I.X size={16}/>
          </button>
        </div>
        <div className="drawer-tabs">
          <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>All · {items.length}</button>
          <button className={tab === "note" ? "active" : ""} onClick={() => setTab("note")}>Notes · {notes}</button>
          <button className={tab === "callout" ? "active" : ""} onClick={() => setTab("callout")}>Callouts · {callouts}</button>
        </div>
        <div className="drawer-body">
          {filtered.length === 0 ? (
            <div className="drawer-empty">
              <div className="icon">
                <I.Bookmark size={32}/>
              </div>
              Highlight any passage<br/>and save it here.
            </div>
          ) : (
            filtered.map(n => (
              <div key={n.id} className={`note-card ${n.kind}`}>
                <div className="ic-kind">
                  {n.kind === "callout" ? <I.Lightbulb className="ic"/> : <I.FileText className="ic"/>}
                  {n.kind === "callout" ? "Callout" : "Note"}
                </div>
                <div className="src">{n.text}</div>
                <div className="meta">
                  <span className="from" onClick={() => onJump(n.nodeId)}>
                    <I.PageIcon className="ic"/> {n.fromTitle}
                  </span>
                  <button className="del" onClick={() => onRemove(n.id)} title="Delete">
                    <I.Trash size={14}/>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

window.NotesDrawer = NotesDrawer;
