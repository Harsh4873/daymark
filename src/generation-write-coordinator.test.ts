import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgePublishedGeneration,
  GenerationWriteCoordinator,
} from './generation-write-coordinator';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('generation root write barrier', () => {
  it('holds a profile edit until its replacement generation is published', async () => {
    const coordinator = new GenerationWriteCoordinator();
    const publication = deferred();
    const write = vi.fn(async () => undefined);

    const publishing = coordinator.enqueuePublication('generation-new', () => publication.promise);
    const queued = coordinator.enqueueProfileWrite('generation-new', write);
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();

    publication.resolve();
    await Promise.all([publishing, queued]);
    expect(write).toHaveBeenCalledOnce();
  });

  it('keeps consecutive profile edits ordered after the root flip', async () => {
    const coordinator = new GenerationWriteCoordinator();
    const publication = deferred();
    const order: string[] = [];

    const publishing = coordinator.enqueuePublication('generation-new', () => publication.promise);
    const first = coordinator.enqueueProfileWrite('generation-new', async () => {
      order.push('first');
    });
    const second = coordinator.enqueueProfileWrite('generation-new', async () => {
      order.push('second');
    });
    publication.resolve();

    await Promise.all([publishing, first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('does not send a dependent profile write when the generation publication fails', async () => {
    const coordinator = new GenerationWriteCoordinator();
    const publication = deferred();
    const write = vi.fn(async () => undefined);

    const publishing = coordinator.enqueuePublication('generation-new', () => publication.promise);
    const queued = coordinator.enqueueProfileWrite('generation-new', write);
    publication.reject(new Error('root rejected'));

    await expect(queued).rejects.toThrow('root rejected');
    await expect(publishing).rejects.toThrow('root rejected');
    expect(write).not.toHaveBeenCalled();
  });

  it('publishes replacement generations in the order they were requested', async () => {
    const coordinator = new GenerationWriteCoordinator();
    const first = deferred();
    const order: string[] = [];

    const publishingFirst = coordinator.enqueuePublication('generation-a', async () => {
      order.push('a-start');
      await first.promise;
      order.push('a-end');
    });
    const publishingSecond = coordinator.enqueuePublication('generation-b', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await vi.waitFor(() => expect(order).toEqual(['a-start']));
    first.resolve();
    await Promise.all([publishingFirst, publishingSecond]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('refuses to acknowledge an older generation over the latest local copy', () => {
    const latest = {
      generationId: 'generation-b',
      generationPending: true,
      profile: 'newest edit',
    };

    expect(acknowledgePublishedGeneration(latest, 'generation-a')).toBeNull();
    expect(acknowledgePublishedGeneration(latest, 'generation-b')).toEqual({
      ...latest,
      generationPending: false,
    });
  });
});
