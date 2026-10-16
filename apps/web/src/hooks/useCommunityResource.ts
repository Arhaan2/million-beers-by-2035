import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../lib/api';

function definitive(caught: unknown) {
  return caught instanceof ApiRequestError && [401, 403, 404].includes(caught.status);
}

/** Route identity is separate from the mutation generation, so refreshes keep useful UI state. */
export function useCommunityResource<T>(loader: () => Promise<T>, key: string, revision = 0) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    revision: number;
    data: T | null;
    error: string | null;
  }>({
    key,
    revision,
    data: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    void loader()
      .then((data) => {
        if (!cancelled) setState({ key, revision, data, error: null });
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setState((previous) => ({
            key,
            revision,
            data:
              previous.key === key && previous.revision === revision && !definitive(caught)
                ? previous.data
                : null,
            error: caught instanceof Error ? caught.message : 'Unable to load this page.',
          }));
      });
    return () => {
      cancelled = true;
    };
    // The key contains all query inputs; mutation generations refresh without discarding drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision, attempt]);
  const retry = () => setAttempt((value) => value + 1);
  return { ...(state.key === key ? state : { data: null, error: null }), retry };
}

/** Refresh every loaded page after a mutation and ignore obsolete pagination responses. */
export function useCommunityPages<T extends { nextCursor: string | null; revision?: number }>(
  loader: (cursor?: string) => Promise<T>,
  merge: (previous: T, next: T) => T,
  key: string,
  revision: number,
  moreError: string,
) {
  const pageCount = useRef({ key, count: 1 });
  const generation = useRef(0);
  const refreshing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    revision: number;
    page: T | null;
    busy: boolean;
    error: string;
  }>({
    key,
    revision,
    page: null,
    busy: false,
    error: '',
  });
  useEffect(() => {
    const current = ++generation.current;
    refreshing.current = true;
    if (pageCount.current.key !== key) pageCount.current = { key, count: 1 };
    const count = pageCount.current.count;
    void (async () => {
      let page = await loader();
      if (generation.current !== current) return;
      if (generation.current === current)
        setState({ key, revision, page, busy: count > 1 && Boolean(page.nextCursor), error: '' });
      for (let index = 1; index < count && page.nextCursor; index++) {
        const next = await loader(page.nextCursor);
        if (generation.current !== current) return;
        if (
          page.revision !== undefined &&
          next.revision !== undefined &&
          page.revision !== next.revision
        ) {
          if (generation.current === current)
            setState({
              key,
              revision,
              page: null,
              busy: false,
              error: 'Records changed while loading. Refresh this view.',
            });
          throw new ApiRequestError('Records changed while loading. Refresh this view.', 409);
        }
        page = merge(page, next);
        if (generation.current === current)
          setState({ key, revision, page, busy: true, error: '' });
      }
      if (generation.current === current) {
        refreshing.current = false;
        setState({ key, revision, page, busy: false, error: '' });
      }
    })().catch((caught: unknown) => {
      if (generation.current === current) {
        refreshing.current = false;
        setState((previous) => ({
          key,
          revision,
          page:
            previous.key === key && previous.revision === revision && !definitive(caught)
              ? previous.page
              : null,
          busy: false,
          error: caught instanceof Error ? caught.message : 'Unable to load this page.',
        }));
      }
    });
    return () => {
      generation.current = current + 1;
    };
    // Every loader and merger input is represented in key or revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision, attempt]);
  const page = state.key === key ? state.page : null;
  const more = async () => {
    if (refreshing.current || state.busy || !page?.nextCursor) return;
    const current = generation.current;
    setState({ key, revision, page, busy: true, error: '' });
    try {
      const next = await loader(page.nextCursor);
      if (generation.current !== current) return;
      if (
        page.revision !== undefined &&
        next.revision !== undefined &&
        page.revision !== next.revision
      ) {
        setState({
          key,
          revision,
          page: null,
          busy: false,
          error: 'Records changed while loading. Refresh this view.',
        });
        return;
      }
      pageCount.current.count++;
      setState({ key, revision, page: merge(page, next), busy: false, error: '' });
    } catch {
      if (generation.current === current)
        setState({ key, revision, page, busy: false, error: moreError });
    }
  };
  return {
    page,
    busy: state.key === key && state.busy,
    error: state.key === key ? state.error : '',
    more,
    retry: () => setAttempt((value) => value + 1),
  };
}
