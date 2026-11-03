import { NODE_TOOLS, Runtime } from '@gimlet-works/core/node';
import { nodeHost } from '@gimlet-works/core/host-node';

export type RuntimeLoader = () => Promise<Runtime>;

const defaultLoad = (): Promise<Runtime> => Runtime.load(nodeHost(), { localTools: NODE_TOOLS });

/**
 * One runtime for the process, created on first use.
 *
 * A failed load is not remembered: the usual reason is a configuration file the
 * person can fix, and the window offers "Try again" — which could not work while
 * the rejected promise stayed cached.
 */
export function createRuntimeLoader(load: () => Promise<Runtime> = defaultLoad): RuntimeLoader {
  let pending: Promise<Runtime> | undefined;
  return () => {
    if (pending === undefined) {
      pending = load().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}
