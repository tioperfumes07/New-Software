import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { formatDateUS, parseDateUS, DATE_PLACEHOLDER_US } from "../../lib/formatDate";

// Shared QuickBooks-style date field. Value is "YYYY-MM-DD".
// MOD-02/03 (GO-MECH-0901): typed MM/DD/YYYY + month/year jump + Escape closes
// picker only (not parent wizard) — same pattern as DateTimePicker (#19067).
type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  /** Inclusive bounds as "YYYY-MM-DD"; out-of-range days are disabled in the calendar. */
  max?: string;
  min?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toISO(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function parseISO(v: string): { y: number; m: number; d: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!mt) return null;
  return { y: Number(mt[1]), m: Number(mt[2]) - 1, d: Number(mt[3]) };
}

function yearRange(viewY: number, min?: string, max?: string): number[] {
  const parsedMin = min ? parseISO(min) : null;
  const parsedMax = max ? parseISO(max) : null;
  const start = parsedMin?.y ?? viewY - 50;
  const end = parsedMax?.y ?? viewY + 10;
  const years: number[] = [];
  for (let y = start; y <= end; y += 1) years.push(y);
  return years.length > 0 ? years : [viewY];
}

/**
 * className is LAYOUT ONLY (width / margin / display). The control owns the single
 * QBO border chrome. Callers that pass `border` / `rounded` / `px-*` / `py-*` used to
 * paint a second box around the control (Assignment History From/To — CLS box-in-box).
 */
function partitionDatePickerClassName(className: string): { shell: string; buttonHeight: string } {
  const shell: string[] = [];
  let buttonHeight = "";
  for (const token of className.trim().split(/\s+/).filter(Boolean)) {
    if (
      /^(rounded|border|px-|py-|p-|pt-|pb-|pl-|pr-|text-|focus:|hover:border)/.test(token) ||
      token.startsWith("border-") ||
      token.startsWith("rounded-")
    ) {
      continue;
    }
    if (/^h-/.test(token)) {
      buttonHeight = token;
      continue;
    }
    shell.push(token);
  }
  return { shell: shell.join(" "), buttonHeight };
}

export function DatePicker({
  value,
  onChange,
  className = "",
  disabled,
  id,
  placeholder,
  max,
  min,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: Props) {
  const isOutOfRange = (iso: string) => Boolean((max && iso > max) || (min && iso < min));
  const { shell, buttonHeight } = partitionDatePickerClassName(className);
  const [open, setOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);
  // DATEPICKER-CLICKTHROUGH-REOPEN: picking a day unmounts the popover; the leftover click
  // lands on the trigger and toggles the calendar open again.
  const suppressToggleRef = useRef(false);
  const parsed = parseISO(value);
  const today = new Date();
  const [viewY, setViewY] = useState(parsed?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(parsed?.m ?? today.getMonth());

  useEffect(() => {
    const p = parseISO(value);
    if (p) {
      setViewY(p.y);
      setViewM(p.m);
    }
  }, [value]);

  useEffect(() => {
    function onDoc(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // DATEPICKER-LABEL-CLICKTHROUGH-REOPEN: label text click → outside close → synthetic
        // activate of associated control. Suppress one follow-up toggle.
        if (open) {
          suppressToggleRef.current = true;
          setTimeout(() => {
            suppressToggleRef.current = false;
          }, 0);
        }
        setOpen(false);
      }
    }
    // Escape closes ONLY this popover — stopPropagation so parent wizard modals stay open (MOD-02).
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      (dateInputRef.current ?? calendarButtonRef.current)?.focus();
    }
    if (open) {
      document.addEventListener("pointerdown", onDoc);
      document.addEventListener("keydown", onKey, true);
    }
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const commitDateDraft = () => {
    setEditingDate(false);
    const parsedDate = parseDateUS(dateDraft);
    if (!parsedDate) {
      setDateDraft(value ? formatDateUS(value) : "");
      return;
    }
    if (isOutOfRange(parsedDate)) return;
    onChange(parsedDate);
  };

  const firstDay = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const prevMonth = () => {
    if (viewM === 0) {
      setViewM(11);
      setViewY(viewY - 1);
    } else setViewM(viewM - 1);
  };
  const nextMonth = () => {
    if (viewM === 11) {
      setViewM(0);
      setViewY(viewY + 1);
    } else setViewM(viewM + 1);
  };

  const dateInputValue = editingDate ? dateDraft : value ? formatDateUS(value) : "";
  const years = yearRange(viewY, min, max);
  const heightClass = buttonHeight || "h-9";

  return (
    <div className={`relative ${shell}`.trim()} ref={ref} data-testid={dataTestId}>
      <div
        className={`flex ${heightClass} w-full items-center gap-1 rounded-sm border border-gray-300 px-2 text-left text-xs ${
          disabled ? "cursor-not-allowed bg-gray-50 text-gray-400" : "bg-white"
        }`}
      >
        <input
          id={id}
          ref={dateInputRef}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder || DATE_PLACEHOLDER_US}
          // dp-input: marks this as DatePicker's OWN internal input so page-level CSS (e.g.
          // .ldt-fld input) that targets bare <input> elements does not paint a second
          // border/background around it — see tokens-load-detail.css ROUND 16.18 comment.
          className="dp-input min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-gray-400 disabled:cursor-not-allowed"
          value={dateInputValue}
          onFocus={() => {
            setEditingDate(true);
            setDateDraft(value ? formatDateUS(value) : "");
          }}
          onChange={(e) => setDateDraft(e.target.value)}
          onBlur={commitDateDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDateDraft();
              dateInputRef.current?.blur();
            }
            if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button
          ref={calendarButtonRef}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel ? `${ariaLabel} calendar` : "Open calendar"}
          className="shrink-0 rounded-sm p-0.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          onClick={() => {
            if (suppressToggleRef.current) {
              suppressToggleRef.current = false;
              return;
            }
            setOpen((o) => !o);
          }}
        >
          <Calendar className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-label="Choose date"
          data-date-picker-popover="open"
          className="absolute z-50 mt-1 w-56 rounded-sm border border-gray-300 bg-white p-2 shadow-lg"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              (dateInputRef.current ?? calendarButtonRef.current)?.focus();
            }
          }}
        >
          <div className="mb-1 flex items-center justify-between gap-1">
            <button type="button" className="rounded-sm px-2 hover:bg-gray-100" onClick={prevMonth} aria-label="Previous month">
              ‹
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <select
                aria-label="Month"
                className="dp-select min-w-0 flex-1 rounded-sm border border-gray-200 px-1 py-0.5 text-[11px]"
                value={viewM}
                onChange={(e) => setViewM(Number(e.target.value))}
              >
                {MONTHS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Year"
                className="dp-select w-16 rounded-sm border border-gray-200 px-1 py-0.5 text-[11px]"
                value={viewY}
                onChange={(e) => setViewY(Number(e.target.value))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="rounded-sm px-2 hover:bg-gray-100" onClick={nextMonth} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-gray-400">
            {DOW.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) =>
              d == null ? (
                <div key={i} />
              ) : (
                (() => {
                  const iso = toISO(viewY, viewM, d);
                  const outOfRange = isOutOfRange(iso);
                  const selected = parsed && parsed.d === d && parsed.m === viewM && parsed.y === viewY;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={outOfRange}
                      aria-label={iso}
                      aria-current={selected ? "date" : undefined}
                      className={`rounded py-1 text-xs ${
                        outOfRange
                          ? "cursor-not-allowed text-gray-300"
                          : `hover:bg-slate-100 ${selected ? "bg-slate-700 text-white hover:bg-slate-700" : ""}`
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (outOfRange) return;
                        onChange(iso);
                        suppressToggleRef.current = true;
                        setOpen(false);
                      }}
                    >
                      {d}
                    </button>
                  );
                })()
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
