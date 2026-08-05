'use client';

import { Children, isValidElement, useMemo, useState, type ReactNode } from 'react';

import { IconSearch } from './icons';

/**
 * A table you can actually find something in.
 *
 * The console loads up to 300 rows a page and, before this, offered no way to
 * reach any particular one. When a host writes in asking where their payout
 * went, the answer was to scroll -- which is not a workflow, and gets worse
 * every week the marketplace grows.
 *
 * Filtering happens here rather than in the query because the rows are already
 * in the browser: a round trip to Supabase to narrow 300 rows the page is
 * holding would be slower than the keystroke that asked for it, and would lose
 * the server-rendered cells the rows are made of.
 *
 * Rows carry their own haystack in `data-search`, set by whichever page built
 * them. That is deliberate -- the page knows a payout row should be findable by
 * the host's name, their phone and the reference note, none of which this
 * component can see once the row is rendered JSX.
 */

export type Filter = {
  /** Matched against a row's `data-filter`. */
  value: string;
  label: string;
};

export function DataTable({
  head,
  children,
  placeholder = 'Search…',
  filters,
  noun = 'row',
  empty,
}: {
  head: string[];
  children: ReactNode;
  placeholder?: string;
  /** Status chips. The "all" chip is added automatically. */
  filters?: Filter[];
  /** Named in the result count and the no-matches message. */
  noun?: string;
  /** Shown when there were no rows to begin with, as opposed to none matching. */
  empty?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('all');

  const rows = useMemo(
    () =>
      Children.toArray(children).filter(
        (child): child is React.ReactElement<Record<string, unknown>> => isValidElement(child)
      ),
    [children]
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const row of rows) {
      const key = String(row.props['data-filter'] ?? '');
      if (key) tally[key] = (tally[key] ?? 0) + 1;
    }
    return tally;
  }, [rows]);

  const needle = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (active !== 'all' && String(row.props['data-filter'] ?? '') !== active) return false;
        if (!needle) return true;
        return String(row.props['data-search'] ?? '')
          .toLowerCase()
          .includes(needle);
      }),
    [rows, active, needle]
  );

  const filtering = needle.length > 0 || active !== 'all';

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button className="clear" type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          ) : null}
        </div>

        {filters && filters.length > 0 ? (
          <div className="chips">
            <button
              type="button"
              className="chip"
              aria-pressed={active === 'all'}
              onClick={() => setActive('all')}>
              All<span className="n">{rows.length}</span>
            </button>
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className="chip"
                aria-pressed={active === filter.value}
                onClick={() => setActive(filter.value)}>
                {filter.label}
                <span className="n">{counts[filter.value] ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}

        {filtering ? (
          <span className="result-count" role="status">
            {visible.length} of {rows.length} {noun}
            {rows.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {head.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length > 0 ? (
                visible
              ) : (
                <tr>
                  <td colSpan={head.length}>
                    <div className="empty">
                      {rows.length === 0 ? (
                        empty ?? <strong>Nothing here yet.</strong>
                      ) : (
                        <>
                          {/* Distinguished on purpose: "none exist" and "none
                              match what you typed" call for different next
                              actions, and reading the wrong one wastes real
                              time during an incident. */}
                          <strong>No {noun}s match that.</strong>
                          Try a different search, or clear the filters.
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
