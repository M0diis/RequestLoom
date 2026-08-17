import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption {
  value: string;
  label: string;
  helperText?: string;
  className?: string;
}

interface CustomDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function CustomDropdown({
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled = false,
  title,
  className,
  buttonClassName,
  menuClassName,
  align = 'left',
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({
      top: rect.bottom + 4,
      left: align === 'right' ? rect.right - rect.width : rect.left,
      width: rect.width,
    });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  const handleSelect = (nextValue: string) => {
    if (nextValue !== value) {
      onChange(nextValue);
    }
    setOpen(false);
  };

  const resolvedLabel = selectedOption?.label ?? (value ? value : placeholder);

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled || options.length === 0) return;
          setOpen((prev) => !prev);
        }}
        className={cx(
          'flex w-full items-center gap-2 border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-left text-xs text-gray-200 transition-colors',
          'hover:border-gray-500 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ff6c37]/70',
          'disabled:cursor-not-allowed disabled:opacity-50',
          buttonClassName,
        )}
      >
        <span className={cx('min-w-0 flex-1 truncate', selectedOption?.className)}>{resolvedLabel}</span>
        <span className="pr-1">
          <svg
            className={cx('h-3.5 w-3.5 text-gray-500 transition-transform', open && 'rotate-180')}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 8l4 4 4-4" />
          </svg>
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className={cx(
              'fixed z-[130] max-h-72 overflow-y-auto border border-gray-700 bg-[#141414]',
              'shadow-[0_16px_24px_rgba(0,0,0,0.45)]',
              menuClassName,
            )}
          >
            {options.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-gray-500">No options</div>
            ) : (
              <ul role="listbox" className="py-1">
                {options.map((option) => {
                  const selected = option.value === value;
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => handleSelect(option.value)}
                        className={cx(
                          'w-full px-2.5 py-1.5 text-left transition-colors',
                          selected
                            ? 'bg-gray-800 text-gray-100'
                            : 'text-gray-300 hover:bg-gray-900 hover:text-gray-100',
                        )}
                      >
                        <div className={cx('truncate text-xs', option.className)}>{option.label}</div>
                        {option.helperText && (
                          <div className="truncate text-[10px] text-gray-500">{option.helperText}</div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
