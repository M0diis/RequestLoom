interface RequestNotesEditorProps {
  notes: string;
  onChange: (notes: string) => void;
}

export function RequestNotesEditor({ notes, onChange }: RequestNotesEditorProps) {
  return (
    <section className="flex h-full min-h-[260px] flex-col">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-gray-200">Request notes</h3>
        <p className="mt-1 text-[11px] text-gray-500">Keep documentation, reminders, or test details with this request.</p>
      </div>
      <textarea
        value={notes}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Write notes for this request…"
        className="min-h-[220px] flex-1 resize-y border border-gray-700 bg-[#111] p-3 font-mono text-xs leading-5 text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#ff6c37]/70"
        spellCheck
      />
    </section>
  );
}
