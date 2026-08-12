import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { Calendar, Download, Clock, MapPin, Users, Plus, Trash2 } from 'lucide-react';

interface CalEvent {
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees?: string;
}

const CalendarTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [parsedEvents, setParsedEvents] = useState<CalEvent[]>([]);
  const [mode, setMode] = useState<'create' | 'parse'>('create');
  const [newEvent, setNewEvent] = useState<CalEvent>({
    title: '', start: '', end: '', location: '', description: '', attendees: '',
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Generate ICS content
  const generateICS = (evts: CalEvent[]): string => {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SD ToolBox//Calendar Tool//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const evt of evts) {
      const startStr = evt.start.replace(/[-:]/g, '').replace('T', 'T') + '00';
      const endStr = evt.end.replace(/[-:]/g, '').replace('T', 'T') + '00';
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@sd-toolbox`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTART:${startStr}`);
      lines.push(`DTEND:${endStr}`);
      lines.push(`SUMMARY:${evt.title}`);
      if (evt.location) lines.push(`LOCATION:${evt.location}`);
      if (evt.description) lines.push(`DESCRIPTION:${evt.description.replace(/\n/g, '\\n')}`);
      if (evt.attendees) {
        for (const att of evt.attendees.split(/[,;，；]/).map(s => s.trim()).filter(Boolean)) {
          lines.push(`ATTENDEE;CN=${att}:mailto:${att.includes('@') ? att : att + '@example.com'}`);
        }
      }
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace('Z', 'Z')}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  // Parse ICS content
  const parseICS = (text: string): CalEvent[] => {
    const events: CalEvent[] = [];
    const eventBlocks = text.split('BEGIN:VEVENT').slice(1);

    for (const block of eventBlocks) {
      const endIdx = block.indexOf('END:VEVENT');
      if (endIdx === -1) continue;
      const content = block.slice(0, endIdx);

      const getLine = (key: string): string => {
        const match = content.match(new RegExp(`^${key}:`, 'm'));
        if (!match) return '';
        const startIdx = match.index! + match[0].length;
        const nextLine = content.indexOf('\n', startIdx);
        return (nextLine === -1 ? content.slice(startIdx) : content.slice(startIdx, nextLine)).trim();
      };

      const formatDT = (dt: string): string => {
        if (!dt) return '';
        // 20240101T090000 → 2024-01-01T09:00
        const cleaned = dt.replace(/[TZ]/g, '');
        if (cleaned.length >= 12) {
          return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}T${cleaned.slice(8, 10)}:${cleaned.slice(10, 12)}`;
        }
        return dt;
      };

      events.push({
        title: getLine('SUMMARY'),
        start: formatDT(getLine('DTSTART')),
        end: formatDT(getLine('DTEND')),
        location: getLine('LOCATION'),
        description: getLine('DESCRIPTION').replace(/\\n/g, '\n'),
      });
    }

    return events;
  };

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const text = await fl[0].text();
    const parsed = parseICS(text);
    setParsedEvents(parsed);
  }, []);

  const addEvent = () => {
    if (!newEvent.title || !newEvent.start) return;
    setEvents(prev => [...prev, { ...newEvent }]);
    setNewEvent({ title: '', start: '', end: '', location: '', description: '', attendees: '' });
  };

  const removeEvent = (idx: number) => {
    setEvents(prev => prev.filter((_, i) => i !== idx));
  };

  const downloadICS = (evts: CalEvent[], filename: string) => {
    const ics = generateICS(evts);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allEvents = [...events, ...parsedEvents];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">创建日历事件并导出 .ics 文件，或解析现有 .ics 文件查看内容</p>

      <div className="flex gap-2">
        <button onClick={() => setMode('create')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'create' ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
          创建事件
        </button>
        <button onClick={() => setMode('parse')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'parse' ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
          解析 ICS
        </button>
      </div>

      {mode === 'create' && (
        <div className="space-y-3 border border-[#ead0ad] rounded-lg p-3">
          <div>
            <label className="text-xs font-medium text-[#6d5a47] block mb-1">事件标题 *</label>
            <input value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
              className="w-full border border-[#ead0ad] rounded px-2 py-1 text-sm text-[#6d5a47] focus:outline-none focus:border-[#7a421b]"
              placeholder="会议、提醒、日程..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#6d5a47] block mb-1">开始时间 *</label>
              <input type="datetime-local" value={newEvent.start} onChange={e => setNewEvent(prev => ({ ...prev, start: e.target.value }))}
                className="w-full border border-[#ead0ad] rounded px-2 py-1 text-sm text-[#6d5a47] focus:outline-none focus:border-[#7a421b]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#6d5a47] block mb-1">结束时间</label>
              <input type="datetime-local" value={newEvent.end} onChange={e => setNewEvent(prev => ({ ...prev, end: e.target.value }))}
                className="w-full border border-[#ead0ad] rounded px-2 py-1 text-sm text-[#6d5a47] focus:outline-none focus:border-[#7a421b]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[#6d5a47] block mb-1">地点</label>
            <input value={newEvent.location} onChange={e => setNewEvent(prev => ({ ...prev, location: e.target.value }))}
              className="w-full border border-[#ead0ad] rounded px-2 py-1 text-sm text-[#6d5a47] focus:outline-none focus:border-[#7a421b]"
              placeholder="会议室、地址..." />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6d5a47] block mb-1">描述</label>
            <textarea value={newEvent.description} onChange={e => setNewEvent(prev => ({ ...prev, description: e.target.value }))}
              className="w-full border border-[#ead0ad] rounded px-2 py-1 text-sm text-[#6d5a47] focus:outline-none focus:border-[#7a421b] resize-none"
              rows={2} placeholder="事件详情..." />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6d5a47] block mb-1">参与者（逗号分隔）</label>
            <input value={newEvent.attendees} onChange={e => setNewEvent(prev => ({ ...prev, attendees: e.target.value }))}
              className="w-full border border-[#ead0ad] rounded px-2 py-1 text-sm text-[#6d5a47] focus:outline-none focus:border-[#7a421b]"
              placeholder="email1@example.com, email2@example.com" />
          </div>
          <Btn onClick={addEvent} disabled={!newEvent.title || !newEvent.start}>
            <Plus className="w-4 h-4 mr-1" />添加事件
          </Btn>
        </div>
      )}

      {mode === 'parse' && (
        <div>
          <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".ics" label="上传 .ics 文件" sublabel="支持 iCalendar 格式" />
          <input ref={inputRef} type="file" className="hidden" accept=".ics" onChange={e => handleFile(e.target.files)} />
        </div>
      )}

      {allEvents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#6d5a47]">事件列表 ({allEvents.length})</span>
            <div className="flex gap-2">
              <button onClick={() => downloadICS(allEvents, 'calendar.ics')} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
                <Download className="w-3 h-3" />导出 ICS
              </button>
              <button onClick={() => { setEvents([]); setParsedEvents([]); }} className="text-xs text-red-500 hover:underline">清空</button>
            </div>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {allEvents.map((evt, i) => (
              <div key={i} className="border border-[#ead0ad] rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#6d5a47]">{evt.title || '（无标题）'}</div>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#8b735c]">
                      {evt.start && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{evt.start.replace('T', ' ')}</span>}
                      {evt.end && <span>→ {evt.end.replace('T', ' ')}</span>}
                      {evt.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{evt.location}</span>}
                    </div>
                    {evt.description && <div className="text-xs text-[#8b735c] mt-1 whitespace-pre-wrap">{evt.description}</div>}
                    {evt.attendees && <div className="text-xs text-[#8b735c] mt-1 flex items-center gap-1"><Users className="w-3 h-3" />{evt.attendees}</div>}
                  </div>
                  {i < events.length && (
                    <button onClick={() => removeEvent(i)} className="text-red-400 hover:text-red-600 ml-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：导出的 .ics 文件可导入 Outlook、Google Calendar、Apple Calendar 等日历应用。
          时间格式为本地时间，如需指定时区请在描述中注明。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default CalendarTool;