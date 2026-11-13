import { useState } from 'react';
import TaskItem from './TaskItem.jsx';
import { Empty } from './ui.jsx';

/** List of tasks. Pass onReorder(ids) to enable native drag-and-drop reordering. */
export default function TaskList({ tasks, onReorder, emptyText = 'Nothing here', emptyHint, emptyIcon = 'inbox', showDate = true, compact = false }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  if (!tasks.length) return <Empty icon={emptyIcon} title={emptyText} hint={emptyHint} />;

  const dnd = (t) => (!onReorder ? {} : {
    draggable: true,
    onDragStart: (e) => {
      setDrag(t.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(t.id));
    },
    onDragEnd: () => { setDrag(null); setOver(null); },
    onDragOver: (e) => {
      if (drag == null) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setOver({ id: t.id, after: e.clientY > r.top + r.height / 2 });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (drag == null || drag === t.id) return;
      const ids = tasks.map((x) => x.id).filter((id) => id !== drag);
      ids.splice(ids.indexOf(t.id) + (over?.after ? 1 : 0), 0, drag);
      setDrag(null);
      setOver(null);
      onReorder(ids);
    },
  });

  return (
    <div className="task-list">
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} showDate={showDate} compact={compact} dragProps={dnd(t)}
          className={`${drag === t.id ? 'dragging' : ''} ${over?.id === t.id && drag != null && drag !== t.id ? (over.after ? 'drop-after' : 'drop-before') : ''}`} />
      ))}
    </div>
  );
}
