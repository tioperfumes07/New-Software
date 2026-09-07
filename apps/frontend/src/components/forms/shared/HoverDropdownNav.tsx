import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import "./HoverDropdownNav.css";

export type NavChild = { label: string; href: string };
export type NavItem = { label: string; href?: string; children?: readonly NavChild[] };

/**
 * `openOn` selects the group-menu open trigger:
 *  - "hover" (DEFAULT) — legacy hover-reveal with a 150ms exit grace (Dispatch/Reports/Lists/Maintenance).
 *  - "click" — the group menu opens on CLICK and STAYS OPEN until an item is chosen, an outside click,
 *    or Escape (NOT hover). This is the LOCKED top-bar sub-nav rule per Jorge directive 2026-06-09
 *    (`docs/specs/NAVIGATION-PATTERN-RULE.md`). Keyboard open (Enter/Space/ArrowDown) works in both modes.
 */
export type NavOpenTrigger = "hover" | "click";

export type HoverDropdownNavProps = {
  items: readonly NavItem[];
  activeHref?: string;
  openOn?: NavOpenTrigger;
};

const EXIT_MS = 150;

function itemOrChildActive(item: NavItem, activeHref?: string): boolean {
  if (!activeHref) return false;
  if (item.href != null && item.href === activeHref) return true;
  return item.children?.some((c) => c.href === activeHref) ?? false;
}

// GO-23 nav-dropdown-clip fix: `.hover-dropdown-nav { overflow-x: auto }` forces the CSS Overflow
// spec's paired `overflow-y` to also compute `auto` on that same element -- a `position: absolute`
// `.nav-dropdown` (whose containing block is `.nav-item-with-dropdown`, a descendant of that clipping
// ancestor) renders correctly in the DOM (real links, visible/opacity/display all fine, confirmed live
// via getComputedStyle) but is clipped off-screen because absolute positioning only escapes normal-flow
// LAYOUT, never an ancestor's overflow clipping. Every consumer of HoverDropdownNav (openOn="click" AND
// the default openOn="hover") shares this one CSS rule, so every dropdown group was equally affected --
// one bug, not one per menu. Fixed the same way components/Combobox.tsx's measureListboxStyle() already
// solves this class of problem: render the menu into a document.body portal, positioned with
// `position: fixed` from a live getBoundingClientRect() read, so no ancestor's overflow or stacking
// context can clip or bury it. Reuses the same z-index rationale (220 sits above every explicit
// z-index found in the codebase, including the z-[200]/z-[210] slide-over drawer tier).
export const NAV_DROPDOWN_Z_INDEX = 220;

export function measureNavDropdownStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  return {
    position: "fixed",
    top: rect.bottom,
    left: rect.left,
    minWidth: rect.width,
    zIndex: NAV_DROPDOWN_Z_INDEX,
  };
}

function DropdownColumn({
  item,
  activeHref,
  openOn,
}: {
  item: NavItem;
  activeHref?: string;
  openOn: NavOpenTrigger;
}) {
  const menuId = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const isClick = openOn === "click";
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const openViaKey = useRef(false);
  const hasDefaultHref = item.href != null && item.href.length > 0;

  useLayoutEffect(() => {
    if (!open || !splitRef.current) return;
    setMenuStyle(measureNavDropdownStyle(splitRef.current));
  }, [open, item.children?.length]);

  useEffect(() => {
    if (!open) return;
    function reposition() {
      if (!splitRef.current) return;
      setMenuStyle(measureNavDropdownStyle(splitRef.current));
    }
    window.addEventListener("resize", reposition);
    // Capture: `.hover-dropdown-nav` itself scrolls horizontally (overflow-x: auto) without bubbling.
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const clearHide = useCallback(() => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimer.current = setTimeout(() => setOpen(false), EXIT_MS);
  }, [clearHide]);

  const show = useCallback(() => {
    clearHide();
    setOpen(true);
  }, [clearHide]);

  useEffect(() => {
    if (!open) return undefined;
    if (openViaKey.current) {
      queueMicrotask(() => {
        menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
        openViaKey.current = false;
      });
    }

    const onDocMouse = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || splitRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };

    const onDocKey = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onDocMouse);
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouse);
      document.removeEventListener("keydown", onDocKey);
    };
  }, [open]);

  useEffect(() => () => clearHide(), [clearHide]);

  const parentActive = itemOrChildActive(item, activeHref);

  const focusSibling = (dir: 1 | -1) => {
    const links = [...(menuRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    if (!links.length) return;
    const ae = document.activeElement;
    const i = Math.max(0, links.indexOf(ae as HTMLAnchorElement));
    const next = (i + dir + links.length) % links.length;
    links[next]?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusSibling(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusSibling(-1);
    }
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        openViaKey.current = true;
        show();
      } else {
        queueMicrotask(() => menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
      }
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) show();
      else queueMicrotask(() => menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
    }
  };

  const children = item.children ?? [];

  return (
    <li role="none" className="nav-item-with-dropdown">
      <div
        ref={splitRef}
        className={hasDefaultHref ? "nav-split" : undefined}
        onMouseEnter={isClick ? undefined : show}
        onMouseLeave={isClick ? undefined : scheduleHide}
      >
        {hasDefaultHref ? (
          // Label navigates to the group's default list (Dispatch nav-split pattern). Chevron opens the menu.
          <Link role="menuitem" to={item.href!} className={parentActive ? "active" : undefined}>
            {item.label}
          </Link>
        ) : null}
        <button
          ref={btnRef}
          type="button"
          role={hasDefaultHref ? undefined : "menuitem"}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={hasDefaultHref ? `${item.label} submenu` : undefined}
          className={!hasDefaultHref && parentActive ? "active" : undefined}
          id={`${menuId}-trigger`}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onButtonKeyDown}
        >
          {hasDefaultHref ? null : item.label}
          <ChevronDown size={12} aria-hidden />
        </button>
        {open && typeof document !== "undefined"
          ? createPortal(
              <ul
                ref={menuRef}
                id={menuId}
                role="menu"
                className="nav-dropdown"
                data-testid={
                  item.label === "Bills"
                    ? "bills-dropdown-menu"
                    : item.label === "Expenses"
                      ? "expenses-dropdown-menu"
                      : undefined
                }
                style={menuStyle}
                onKeyDown={onMenuKeyDown}
                tabIndex={-1}
              >
                {children.map((child) => (
                  <li key={child.href} role="none">
                    <Link
                      role="menuitem"
                      to={child.href}
                      className={activeHref === child.href ? "active" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>,
              document.body,
            )
          : null}
      </div>
    </li>
  );
}

function LeafItem({ item, activeHref }: { item: NavItem; activeHref?: string }) {
  if (item.href == null) return null;
  const active = activeHref === item.href;
  return (
    <li role="none">
      <Link role="menuitem" to={item.href} className={active ? "active" : undefined}>
        {item.label}
      </Link>
    </li>
  );
}

/**
 * Top horizontal grouped sub-nav (invariant #20). Dropdown width follows longest label (MUST 6.3.1.1).
 * `openOn` selects hover-reveal (default, legacy) vs. click-open-persistent (LOCKED top-bar rule).
 */
export function HoverDropdownNav({ items, activeHref, openOn = "hover" }: HoverDropdownNavProps) {
  return (
    <nav
      className="hover-dropdown-nav"
      aria-label={
        openOn === "click"
          ? "Module sub-navigation (click dropdown)"
          : "Module sub-navigation (hover dropdown)"
      }
    >
      <ul role="menubar">
        {items.map((item) =>
          item.children?.length ? (
            <DropdownColumn key={item.label} item={item} activeHref={activeHref} openOn={openOn} />
          ) : (
            <LeafItem key={item.label} item={item} activeHref={activeHref} />
          ),
        )}
      </ul>
    </nav>
  );
}
