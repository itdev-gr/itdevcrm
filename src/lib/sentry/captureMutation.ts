import { Sentry } from '@/lib/sentry';

/**
 * Wrap a mutationFn so any thrown error is captured to Sentry with structured
 * tags before re-throwing. Lets every useMutation report silently-handled
 * failures (e.g., catch + alert in the component) while keeping the existing
 * error-handling behavior intact.
 */
export function captureMutation<TVariables, TData>(
  feature: string,
  op: string,
  fn: (variables: TVariables) => Promise<TData>,
): (variables: TVariables) => Promise<TData> {
  return async (variables) => {
    try {
      return await fn(variables);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature, op },
        extra: { input: serializeForSentry(variables) },
      });
      throw err;
    }
  };
}

/** Drop large blobs / convert Maps and Sets so Sentry can serialize the input. */
function serializeForSentry(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input !== 'object') return input;
  if (input instanceof Map) return { __map: Array.from(input.entries()) };
  if (input instanceof Set) return { __set: Array.from(input) };
  // Truncate very large strings on any field.
  try {
    const json = JSON.stringify(input, (_k, v) =>
      typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v,
    );
    return JSON.parse(json);
  } catch {
    return { __unserializable: true };
  }
}
