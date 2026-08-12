/**
 * Orders root-profile writes behind an in-flight generation publication.
 *
 * Daymark publishes a replacement generation by writing its generation-scoped
 * children first and flipping the root document last. A profile edit made in
 * that window must wait for the flip: the shared rules correctly reject a
 * profileGenerationId that does not match the root's current generation.
 */
export class GenerationWriteCoordinator {
  private publication: { generationId: string; promise: Promise<unknown> } | null = null;
  private publicationTail: Promise<unknown> = Promise.resolve();
  private profileWrites: Promise<unknown> = Promise.resolve();

  /**
   * Serialize full-generation publications so their root flips cannot arrive in
   * the opposite order. A newer replacement still runs when an older upload
   * fails: it is the owner's latest complete copy and may be the recovery.
   */
  enqueuePublication<T>(generationId: string, publish: () => Promise<T>): Promise<T> {
    const promise = this.publicationTail
      .catch(() => undefined)
      .then(publish);
    const publication = { generationId, promise };
    this.publicationTail = promise;
    this.publication = publication;
    void promise.then(
      () => {
        if (this.publication === publication) this.publication = null;
      },
      () => undefined,
    );
    return promise;
  }

  enqueueProfileWrite(generationId: string, write: () => Promise<unknown>): Promise<unknown> {
    const queued = this.profileWrites
      .catch(() => undefined)
      .then(async () => {
        const publication = this.publication;
        if (publication?.generationId === generationId) await publication.promise;
        return write();
      });
    this.profileWrites = queued;
    return queued;
  }
}

/** Never let completion of an older publication reinstall its captured state. */
export function acknowledgePublishedGeneration<T extends {
  generationId: string;
  generationPending: boolean;
}>(latest: T | null | undefined, generationId: string): T | null {
  if (!latest || latest.generationId !== generationId) return null;
  return { ...latest, generationPending: false };
}
