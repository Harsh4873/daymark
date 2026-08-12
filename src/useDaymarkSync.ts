import { useCallback, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  terminate,
  updateDoc,
  waitForPendingWrites,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  authPersistenceReady,
  daymarkFirestore,
  firebaseAuth,
  googleProvider,
} from './firebase';
import {
  acknowledgePublishedGeneration,
  GenerationWriteCoordinator,
} from './generation-write-coordinator';
import { createInitialState, makeGenerationId, type TrackerState } from './model';
import { finishSafeSignOut } from './signout';
import { syncAccountProblem } from './sync-account';
import {
  LEGACY_LOCAL_GENERATION_ID,
  describeGenerationConflict,
  findUnsyncedLocalWork,
  hasUnsyncedLocalWork,
  materializeCloudState,
  mergeSameGeneration,
  resolveGenerationConflict,
  resolveInitialSync,
  serializeEntryDocument,
  serializeHabitDocument,
  serializeRootDocument,
  serializeTrackerDelta,
  serializeTrackerState,
  type CloudEntryDocument,
  type CloudHabitDocument,
  type CloudUserDocument,
  type GenerationConflict,
  type GenerationConflictChoice,
} from './sync-core';
import { parseTrackerState, type TrackerMutation, type TrackerStore } from './store';

const WRITE_BATCH_SIZE = 450;

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'action-needed';

export type { GenerationConflict, GenerationConflictChoice } from './sync-core';

export interface DaymarkSync {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt?: string;
  message?: string;
  /** Set while a generation split is waiting on the owner. Never auto-resolved. */
  conflict: GenerationConflict | null;
  resolveConflict: (choice: GenerationConflictChoice) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const UNVERIFIED_ACCOUNT_MESSAGE = 'Use a verified Google account to sync Daymark.';
const NON_GOOGLE_ACCOUNT_MESSAGE = 'Daymark only syncs accounts signed in with Google. Sign in again with the Google button.';
const TOKEN_CHECK_ACCOUNT_MESSAGE = 'Daymark could not verify this Google session. Reconnect, then sign in again with the Google button.';

/**
 * Mirrors the shared Firestore rules, which require a verified email *and*
 * `sign_in_provider == 'google.com'`. Checking only `emailVerified` let a
 * non-Google session through and turned every read into a raw permission
 * error. The provider claim needs a token, and a session whose token cannot be
 * inspected must stay out of Firestore because linked providers cannot prove
 * which provider issued the current session.
 */
async function describeAccountEligibility(authUser: User): Promise<{ ok: true } | { ok: false; message: string }> {
  let signInProvider: string | null | undefined;
  try {
    signInProvider = (await authUser.getIdTokenResult()).signInProvider ?? null;
  } catch {
    return { ok: false, message: TOKEN_CHECK_ACCOUNT_MESSAGE };
  }

  const problem = syncAccountProblem({
    email: authUser.email,
    emailVerified: authUser.emailVerified,
    signInProvider,
  });
  if (!problem) return { ok: true };
  return {
    ok: false,
    message: problem === 'unverified-provider' ? NON_GOOGLE_ACCOUNT_MESSAGE : UNVERIFIED_ACCOUNT_MESSAGE,
  };
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeConflictMessage(conflict: GenerationConflict) {
  const parts: string[] = [];
  if (conflict.unsyncedEntryCount > 0) parts.push(countLabel(conflict.unsyncedEntryCount, 'entry', 'entries'));
  if (conflict.unsyncedHabitCount > 0) parts.push(countLabel(conflict.unsyncedHabitCount, 'habit', 'habits'));
  if (parts.length === 0 && conflict.unsyncedProfile) parts.push('a settings change');
  const held = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0] ?? 'changes';
  const span = conflict.earliestUnsyncedDate
    ? conflict.earliestUnsyncedDate === conflict.latestUnsyncedDate
      ? ` from ${conflict.earliestUnsyncedDate}`
      : ` from ${conflict.earliestUnsyncedDate} to ${conflict.latestUnsyncedDate}`
    : '';
  return `The synced record was replaced on another device. This device still holds ${held}${span} that the synced record does not have. Nothing was deleted — choose what to keep in Profile → Sync.`;
}

function timestampOrder(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }
  return left.localeCompare(right);
}

function friendlySyncError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('popup-closed-by-user')) return 'Sign-in was cancelled. Your local Daymark data is unchanged.';
  if (code.includes('popup-blocked')) return 'Allow the Google sign-in window, then try again.';
  if (code.includes('permission-denied')) return 'This Google account is not allowed to access Daymark.';
  if (code.includes('unavailable') || !navigator.onLine) return 'You are offline. Changes stay on this device and will sync after reconnection.';
  return error instanceof Error ? error.message : 'Daymark could not finish syncing. Your local data is still safe.';
}

function isCloudRoot(value: unknown): value is CloudUserDocument {
  if (!value || typeof value !== 'object') return false;
  const root = value as Partial<CloudUserDocument>;
  return root.schemaVersion === 2
    && typeof root.generationId === 'string'
    && typeof root.generationUpdatedAt === 'string'
    && root.profileGenerationId === root.generationId
    && typeof root.updatedAt === 'string'
    && Boolean(root.profile);
}

export function useDaymarkSync(store: TrackerStore): DaymarkSync {
  const [status, setStatus] = useState<SyncStatus>(() => navigator.onLine ? 'action-needed' : 'offline');
  const [user, setUser] = useState<User | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [conflict, setConflict] = useState<GenerationConflict | null>(null);
  const localStateRef = useRef(store.state);
  const activeUserRef = useRef<User | null>(null);
  const stopAllListenersRef = useRef<() => void>(() => undefined);
  const bootstrapActiveUserRef = useRef<() => void>(() => undefined);
  const otherTabsOpenRef = useRef<() => Promise<boolean>>(async () => false);
  const resolveConflictRef = useRef<(choice: GenerationConflictChoice) => Promise<void>>(async () => undefined);
  localStateRef.current = store.state;

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const tabId = makeGenerationId();
    const channel = new BroadcastChannel('daymark-tab-presence');
    const pending = new Map<string, () => void>();
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; requestId?: string; source?: string; target?: string };
      if (data.type === 'probe' && data.source !== tabId && data.requestId) {
        channel.postMessage({ type: 'present', requestId: data.requestId, target: data.source });
      }
      if (data.type === 'present' && data.target === tabId && data.requestId) {
        pending.get(data.requestId)?.();
      }
    };
    otherTabsOpenRef.current = () => new Promise((resolve) => {
      const requestId = makeGenerationId();
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        pending.delete(requestId);
        resolve(value);
      };
      pending.set(requestId, () => finish(true));
      channel.postMessage({ type: 'probe', requestId, source: tabId });
      window.setTimeout(() => finish(false), 250);
    });
    return () => {
      otherTabsOpenRef.current = async () => false;
      pending.clear();
      channel.close();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeUid: string | null = null;
    let activeGeneration: string | null = null;
    let rootUnsubscribe: Unsubscribe | undefined;
    let habitUnsubscribe: Unsubscribe | undefined;
    let entryUnsubscribe: Unsubscribe | undefined;
    let subscribedGeneration: string | null = null;
    let rootDocument: CloudUserDocument | null = null;
    let habitDocuments: CloudHabitDocument[] = [];
    let entryDocuments: CloudEntryDocument[] = [];
    let habitsReady = false;
    let entriesReady = false;
    let rootFromCache = true;
    let habitsFromCache = true;
    let entriesFromCache = true;
    let rootHasPendingWrites = false;
    let habitsHavePendingWrites = false;
    let entriesHavePendingWrites = false;
    let pendingWriteCount = 0;
    let pendingGeneration: string | null = null;
    let bootstrapInFlight = false;
    let bootstrapSequence = 0;
    let authSequence = 0;
    let pendingConflict: { uid: string; cloud: TrackerState; summary: GenerationConflict } | null = null;
    let blockedAccountMessage: string | null = null;
    let rejectedWrite = false;
    let lastRecoveryAt = 0;
    const writeCoordinator = new GenerationWriteCoordinator();

    function showError(error: unknown) {
      if (disposed) return;
      if (pendingConflict) {
        showConflict();
        return;
      }
      const offline = !navigator.onLine
        || (typeof error === 'object' && error && 'code' in error && String(error.code).includes('unavailable'));
      setStatus(offline ? 'offline' : 'action-needed');
      setMessage(friendlySyncError(error));
    }

    /** An unanswered conflict outranks every other status: work is still unsynced. */
    function showConflict() {
      if (disposed || !pendingConflict) return;
      setStatus('action-needed');
      setMessage(describeConflictMessage(pendingConflict.summary));
    }

    function markSynced() {
      if (disposed) return;
      if (pendingConflict) {
        showConflict();
        return;
      }
      // A rejected write means this device holds a change the cloud does not.
      // Saying "Synced" here is the lie that hides lost work.
      if (rejectedWrite) {
        setStatus('action-needed');
        setMessage('A change made on this device has not reached the cloud yet. Daymark keeps it here and retries on the next sync.');
        return;
      }
      const now = new Date().toISOString();
      setStatus(navigator.onLine ? 'synced' : 'offline');
      setLastSyncedAt(now);
      setMessage(undefined);
    }

    function updateConnectionStatus() {
      if (disposed) return;
      if (pendingConflict) {
        showConflict();
        return;
      }
      if (!navigator.onLine) {
        setStatus('offline');
        setMessage('Changes are saved here and will sync automatically when this device reconnects.');
      } else if (activeUid && pendingWriteCount > 0) {
        setStatus('syncing');
        setMessage(undefined);
      }
    }

    /**
     * Parks a generation split. The local state is left exactly as it is, no
     * cloud write is queued, and listeners stop so nothing can overwrite this
     * device before the owner answers.
     */
    function raiseConflict(uid: string, cloud: TrackerState, summary: GenerationConflict) {
      stopAllListeners();
      pendingConflict = { uid, cloud, summary };
      setConflict(summary);
      showConflict();
    }

    function stopDataListeners() {
      habitUnsubscribe?.();
      entryUnsubscribe?.();
      habitUnsubscribe = undefined;
      entryUnsubscribe = undefined;
      subscribedGeneration = null;
      rootDocument = null;
      habitDocuments = [];
      entryDocuments = [];
      habitsReady = false;
      entriesReady = false;
    }

    function stopAllListeners() {
      bootstrapSequence += 1;
      rootUnsubscribe?.();
      rootUnsubscribe = undefined;
      stopDataListeners();
    }
    stopAllListenersRef.current = stopAllListeners;

    function rootReference(uid: string) {
      return doc(daymarkFirestore, 'daymark_users', uid);
    }

    function trackWrite(write: Promise<unknown>) {
      pendingWriteCount += 1;
      updateConnectionStatus();
      if (navigator.onLine) setStatus('syncing');
      setMessage(undefined);

      return write.then(() => {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        if (pendingWriteCount === 0) markSynced();
      }).catch((error) => {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        rejectedWrite = true;
        showError(error);
        throw error;
      });
    }

    /**
     * A rejected write is a change this device holds and the cloud does not.
     * `permission-denied` on a Daymark write means the root moved to another
     * generation, so re-resolve against the cloud: bootstrap replays the local
     * change through the merge path, or parks a conflict for the owner. Rate
     * limited so a genuinely unauthorised account cannot spin.
     */
    function recoverFromWriteRejection(error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (!code.includes('permission-denied')) return;
      const authUser = activeUserRef.current;
      const now = Date.now();
      if (!authUser || now - lastRecoveryAt < 30_000) return;
      lastRecoveryAt = now;
      setMessage('The synced record changed on another device. Daymark is re-checking this device’s copy…');
      void bootstrap(authUser);
    }

    async function queueFullStateWrite(uid: string, state: TrackerState) {
      const serialized = serializeTrackerState(state);
      const root = rootReference(uid);
      const children: Array<{ reference: DocumentReference<DocumentData>; data: DocumentData }> = [
        ...serialized.habits.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'habits', id),
          data,
        })),
        ...serialized.entries.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'entries', id),
          data,
        })),
      ];

      if (children.length + 1 <= 500) {
        const batch = writeBatch(daymarkFirestore);
        children.forEach(({ reference, data }) => batch.set(reference, data));
        batch.set(root, serialized.root);
        await batch.commit();
      } else {
        const childWrites: Array<Promise<void>> = [];
        for (let index = 0; index < children.length; index += WRITE_BATCH_SIZE) {
          const batch = writeBatch(daymarkFirestore);
          children.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
          childWrites.push(batch.commit());
        }
        // Generation-scoped child IDs make staging safe. The authoritative
        // root flips only after every child batch is acknowledged.
        await Promise.all(childWrites);
        const rootBatch = writeBatch(daymarkFirestore);
        rootBatch.set(root, serialized.root);
        await rootBatch.commit();
      }

      activeGeneration = state.generationId;
    }

    async function queueMergeDeltaWrite(uid: string, cloud: TrackerState, merged: TrackerState) {
      const delta = serializeTrackerDelta(cloud, merged);
      const children: Array<{ reference: DocumentReference<DocumentData>; data: DocumentData }> = [
        ...delta.habits.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'habits', id),
          data,
        })),
        ...delta.entries.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'entries', id),
          data,
        })),
      ];
      const writes: Array<Promise<void>> = [];
      for (let index = 0; index < children.length; index += WRITE_BATCH_SIZE) {
        const batch = writeBatch(daymarkFirestore);
        children.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
        writes.push(batch.commit());
      }
      if (delta.root) {
        writes.push(updateDoc(rootReference(uid), {
          profile: delta.root.profile,
          updatedAt: delta.root.updatedAt,
          profileGenerationId: merged.generationId,
        }));
      }
      await Promise.all(writes);
    }

    function queueMutation(uid: string, mutation: TrackerMutation) {
      const current = localStateRef.current;
      if (!current) return;

      // A replacement generation is an answer to the conflict in itself: the
      // owner imported or reset deliberately, and that state becomes cloud.
      if (pendingConflict && mutation.type !== 'replace') {
        showConflict();
        return;
      }
      if (pendingConflict) {
        pendingConflict = null;
        setConflict(null);
      }

      if (mutation.type === 'replace') {
        activeGeneration = mutation.state.generationId;
        pendingGeneration = mutation.state.generationId;
        // Invalidate a bootstrap that may already be publishing an older
        // generation. Its write can finish, but it cannot resume listeners or
        // apply an acknowledgement over this replacement.
        stopAllListeners();
        if (navigator.onLine) setStatus('syncing');
        const publication = trackWrite(writeCoordinator.enqueuePublication(
          mutation.state.generationId,
          () => queueFullStateWrite(uid, mutation.state),
        ));
        void publication
          .then(() => {
            const latest = localStateRef.current;
            const acknowledged = acknowledgePublishedGeneration(
              latest,
              mutation.state.generationId,
            );
            if (!acknowledged) return;
            // Listeners are stopped while a conflict is parked; the replacement
            // answered it, so bring them back on the published generation.
            if (!rootUnsubscribe) {
              startRootListener(uid);
              startDataListeners(uid, serializeRootDocument(acknowledged));
            }
            localStateRef.current = acknowledged;
            store.applySyncedState(acknowledged);
          })
          .finally(() => {
            if (pendingGeneration === mutation.state.generationId) pendingGeneration = null;
          })
          .catch(recoverFromWriteRejection);
        return;
      }

      if (current.generationId === LEGACY_LOCAL_GENERATION_ID || !activeGeneration) {
        updateConnectionStatus();
        return;
      }

      if (mutation.type === 'entry') {
        const serialized = serializeEntryDocument(
          mutation.dateKey,
          mutation.habitId,
          mutation.entry,
          current.generationId,
        );
        void trackWrite(setDoc(
          doc(daymarkFirestore, 'daymark_users', uid, 'entries', serialized.id),
          serialized.data,
        )).catch(recoverFromWriteRejection);
        return;
      }

      if (mutation.type === 'habits') {
        const batch = writeBatch(daymarkFirestore);
        mutation.habits.forEach((habit) => {
          const serialized = serializeHabitDocument(habit, current.generationId);
          batch.set(doc(daymarkFirestore, 'daymark_users', uid, 'habits', serialized.id), serialized.data);
        });
        void trackWrite(batch.commit()).catch(recoverFromWriteRejection);
        return;
      }

      queueProfileWrite(uid, current);
    }

    /**
     * `hasConsistentGeneration()` in the shared rules compares the incoming
     * `profileGenerationId` against the root's `generationId`, so this write
     * carries the generation the edit was actually made on and lands only
     * while that is still the published generation. Adding `generationId` to
     * the payload would satisfy the rule the other way — by rewriting the
     * root's generation pointer, letting a stale device undo another device's
     * reset — so the rejection is kept and treated as real instead: the edit
     * is replayed after re-resolving against the cloud, and the badge never
     * claims "Synced" while it is outstanding.
     */
    function queueProfileWrite(uid: string, state: TrackerState) {
      if (navigator.onLine) setStatus('syncing');
      setMessage(undefined);
      void writeCoordinator.enqueueProfileWrite(state.generationId, async () => {
        // Use the newest profile after the barrier, and never let an old queued
        // edit follow the device onto a different generation.
        const latest = localStateRef.current;
        if (!latest || latest.generationId !== state.generationId || pendingConflict) return;
        const serializedRoot = serializeRootDocument(latest);
        await trackWrite(updateDoc(rootReference(uid), {
          profile: serializedRoot.profile,
          updatedAt: serializedRoot.updatedAt,
          profileGenerationId: latest.generationId,
        }));
      }).catch(recoverFromWriteRejection);
    }

    const unsubscribeMutations = store.subscribeMutations((mutation) => {
      if (!activeUid) return;
      queueMutation(activeUid, mutation);
    });

    function remoteGenerationWins(local: TrackerState, remote: CloudUserDocument, fromCache: boolean) {
      if (local.generationId === remote.generationId) return true;
      if (local.generationPending || pendingGeneration === local.generationId) return false;
      if (!fromCache) return true;
      if (local.generationId === LEGACY_LOCAL_GENERATION_ID) return true;
      const order = timestampOrder(remote.generationUpdatedAt, local.generationUpdatedAt);
      return order > 0 || (order === 0 && remote.generationId.localeCompare(local.generationId) > 0);
    }

    function maybeApplyCloudState() {
      if (!rootDocument || !habitsReady || !entriesReady) return;
      try {
        const cloud = parseTrackerState(materializeCloudState(rootDocument, habitDocuments, entryDocuments));
        const local = localStateRef.current;
        if (!local || !remoteGenerationWins(local, rootDocument, rootFromCache)) return;

        // A live snapshot can carry a generation this device never adopted (a
        // reset elsewhere). Applying it would erase every local write made
        // since the split, so park it for the owner instead.
        if (local.generationId !== cloud.generationId && activeUid) {
          const work = findUnsyncedLocalWork(local, cloud);
          if (hasUnsyncedLocalWork(work)) {
            raiseConflict(activeUid, cloud, describeGenerationConflict(local, cloud, work));
            return;
          }
        }

        const hasPendingWrites = pendingWriteCount > 0
          || rootHasPendingWrites
          || habitsHavePendingWrites
          || entriesHavePendingWrites;
        const fromCache = rootFromCache || habitsFromCache || entriesFromCache;
        // Within one generation the merge is always the safe move: entries and
        // habits are only ever added or updated, never deleted, so the union
        // can resurrect nothing — while replacing outright would drop any local
        // write the cloud has not accepted yet (a rejected write, an edit made
        // before this listener attached).
        const next = local.generationId === cloud.generationId
          ? mergeSameGeneration(local, cloud)
          : cloud;
        localStateRef.current = next;
        store.applySyncedState(next);
        activeGeneration = next.generationId;

        if (!navigator.onLine || fromCache) {
          setStatus('offline');
          setMessage('Showing the latest record available on this device.');
        } else if (hasPendingWrites) {
          setStatus('syncing');
          setMessage(undefined);
        } else {
          markSynced();
        }
      } catch (error) {
        showError(error);
      }
    }

    function startDataListeners(uid: string, root: CloudUserDocument, snapshotFromCache = false, snapshotPending = false) {
      rootDocument = root;
      rootFromCache = snapshotFromCache;
      rootHasPendingWrites = snapshotPending;
      if (subscribedGeneration === root.generationId) {
        maybeApplyCloudState();
        return;
      }

      stopDataListeners();
      subscribedGeneration = root.generationId;
      rootDocument = root;
      rootFromCache = snapshotFromCache;
      rootHasPendingWrites = snapshotPending;
      const habitsQuery = query(
        collection(daymarkFirestore, 'daymark_users', uid, 'habits'),
        where('generationId', '==', root.generationId),
      );
      const entriesQuery = query(
        collection(daymarkFirestore, 'daymark_users', uid, 'entries'),
        where('generationId', '==', root.generationId),
      );

      habitUnsubscribe = onSnapshot(habitsQuery, { includeMetadataChanges: true }, (snapshot) => {
        habitDocuments = snapshot.docs.map((item) => item.data() as CloudHabitDocument);
        habitsReady = true;
        habitsFromCache = snapshot.metadata.fromCache;
        habitsHavePendingWrites = snapshot.metadata.hasPendingWrites;
        maybeApplyCloudState();
      }, showError);

      entryUnsubscribe = onSnapshot(entriesQuery, { includeMetadataChanges: true }, (snapshot) => {
        entryDocuments = snapshot.docs.map((item) => item.data() as CloudEntryDocument);
        entriesReady = true;
        entriesFromCache = snapshot.metadata.fromCache;
        entriesHavePendingWrites = snapshot.metadata.hasPendingWrites;
        maybeApplyCloudState();
      }, showError);
    }

    function startRootListener(uid: string) {
      rootUnsubscribe?.();
      rootUnsubscribe = onSnapshot(rootReference(uid), { includeMetadataChanges: true }, (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (!isCloudRoot(data)) {
          showError(new Error('The cloud profile has an unsupported format.'));
          return;
        }
        const local = localStateRef.current;
        if (local && !remoteGenerationWins(local, data, snapshot.metadata.fromCache)) return;
        startDataListeners(uid, data, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
      }, showError);
    }

    async function readCloudState(uid: string) {
      const rootSnapshot = await getDoc(rootReference(uid));
      if (!rootSnapshot.exists()) return null;
      const root = rootSnapshot.data();
      if (!isCloudRoot(root)) throw new Error('The cloud profile has an unsupported format.');
      const [habitSnapshot, entrySnapshot] = await Promise.all([
        getDocs(query(
          collection(daymarkFirestore, 'daymark_users', uid, 'habits'),
          where('generationId', '==', root.generationId),
        )),
        getDocs(query(
          collection(daymarkFirestore, 'daymark_users', uid, 'entries'),
          where('generationId', '==', root.generationId),
        )),
      ]);
      return parseTrackerState(materializeCloudState(
        root,
        habitSnapshot.docs.map((item) => item.data() as CloudHabitDocument),
        entrySnapshot.docs.map((item) => item.data() as CloudEntryDocument),
      ));
    }

    async function publishResolvedState(
      uid: string,
      cloud: TrackerState | null,
      state: TrackerState,
      writeMode: 'delta' | 'full',
    ) {
      const isGenerationWrite = writeMode === 'full' || !cloud;
      if (isGenerationWrite) pendingGeneration = state.generationId;
      try {
        const trackedWrite = isGenerationWrite
          ? trackWrite(writeCoordinator.enqueuePublication(
            state.generationId,
            () => queueFullStateWrite(uid, state),
          ))
          : trackWrite(queueMergeDeltaWrite(uid, cloud!, state));
        await trackedWrite;
        rejectedWrite = false;
        if (isGenerationWrite) {
          // The owner can keep editing while a large generation upload is in
          // flight. Acknowledge the newest in-memory copy, not the pre-upload
          // snapshot, or this completion handler would roll those edits back.
          const latest = localStateRef.current;
          const acknowledged = acknowledgePublishedGeneration(latest, state.generationId);
          if (acknowledged) {
            localStateRef.current = acknowledged;
            store.applySyncedState(acknowledged);
          }
        }
      } finally {
        if (isGenerationWrite && pendingGeneration === state.generationId) pendingGeneration = null;
      }
    }

    async function bootstrap(authUser: User) {
      if (bootstrapInFlight || disposed) return;
      bootstrapInFlight = true;
      const sequence = ++bootstrapSequence;
      if (pendingConflict) showConflict();
      else {
        setStatus(navigator.onLine ? 'syncing' : 'offline');
        setMessage(undefined);
      }
      try {
        const cloud = await readCloudState(authUser.uid);
        if (disposed || sequence !== bootstrapSequence) return;
        const local = localStateRef.current;
        if (!local) return;
        const now = new Date().toISOString();
        const resolution = resolveInitialSync(local, cloud, {
          firstUploadGenerationId: makeGenerationId(),
          now,
        });

        // Nothing is applied and nothing is written until the owner answers.
        if (resolution.mode === 'conflict' && resolution.conflict && cloud) {
          raiseConflict(authUser.uid, cloud, resolution.conflict);
          return;
        }

        pendingConflict = null;
        setConflict(null);
        localStateRef.current = resolution.state;
        store.applySyncedState(resolution.state);
        activeGeneration = resolution.state.generationId;
        // This resolution either republishes the changes an earlier write was
        // rejected for or supersedes them, so nothing is outstanding now. A
        // failure inside the write below sets the flag again.
        rejectedWrite = false;

        if (resolution.shouldWriteCloud) {
          await publishResolvedState(
            authUser.uid,
            cloud,
            resolution.state,
            resolution.mode === 'merge' ? 'delta' : 'full',
          );
          if (disposed || sequence !== bootstrapSequence) return;
        }
        startRootListener(authUser.uid);
        startDataListeners(authUser.uid, serializeRootDocument(localStateRef.current ?? resolution.state));
        if (navigator.onLine && pendingWriteCount === 0) markSynced();
        else updateConnectionStatus();
      } catch (error) {
        showError(error);
      } finally {
        bootstrapInFlight = false;
      }
    }

    /**
     * Applies the owner's answer to a parked generation conflict. The cloud is
     * re-read first so the decision lands on the current record, and the local
     * state used is whatever this device holds now — entries logged while the
     * conflict was open are included, never stranded.
     */
    async function resolveConflictNow(choice: GenerationConflictChoice) {
      const parked = pendingConflict;
      const authUser = activeUserRef.current;
      const local = localStateRef.current;
      if (!parked || !authUser || !local) return;
      // Cancels any bootstrap still in flight so it cannot re-park the answer.
      stopAllListeners();
      setStatus(navigator.onLine ? 'syncing' : 'offline');
      setMessage(undefined);
      try {
        const cloud = (navigator.onLine ? await readCloudState(parked.uid) : null) ?? parked.cloud;
        if (disposed) return;
        const resolution = resolveGenerationConflict(local, cloud, choice, {
          now: new Date().toISOString(),
        });
        pendingConflict = null;
        setConflict(null);
        localStateRef.current = resolution.state;
        store.applySyncedState(resolution.state);
        activeGeneration = resolution.state.generationId;
        rejectedWrite = false;

        if (resolution.shouldWriteCloud && resolution.writeMode !== 'none') {
          await publishResolvedState(parked.uid, cloud, resolution.state, resolution.writeMode);
        }
        startRootListener(parked.uid);
        startDataListeners(parked.uid, serializeRootDocument(localStateRef.current ?? resolution.state));
        if (navigator.onLine && pendingWriteCount === 0) markSynced();
        else updateConnectionStatus();
      } catch (error) {
        // The conflict stays parked so this device's copy is still protected.
        if (!pendingConflict) pendingConflict = parked;
        setConflict(parked.summary);
        setStatus('action-needed');
        setMessage(`${friendlySyncError(error)} This device’s copy is untouched — try again.`);
      }
    }
    resolveConflictRef.current = resolveConflictNow;
    bootstrapActiveUserRef.current = () => {
      if (activeUserRef.current) void bootstrap(activeUserRef.current);
    };

    async function startSession(authUser: User, sequence: number) {
      const eligibility = await describeAccountEligibility(authUser);
      if (disposed || sequence !== authSequence) return;
      if (!eligibility.ok) {
        activeUid = null;
        setStatus('action-needed');
        setMessage(eligibility.message);
        // Consumed by the signed-out branch below so the reason survives.
        blockedAccountMessage = eligibility.message;
        await firebaseSignOut(firebaseAuth).catch(() => undefined);
        return;
      }

      activeUserRef.current = authUser;
      setUser(authUser);
      activeUid = authUser.uid;
      activeGeneration = localStateRef.current?.generationId === LEGACY_LOCAL_GENERATION_ID
        ? null
        : localStateRef.current?.generationId ?? null;
      void bootstrap(authUser);
    }

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (authUser) => {
      if (disposed) return;
      const sequence = ++authSequence;
      stopAllListeners();
      activeUid = null;
      activeGeneration = null;
      activeUserRef.current = null;
      setUser(null);
      pendingConflict = null;
      setConflict(null);
      rejectedWrite = false;

      if (!authUser) {
        const reason = blockedAccountMessage;
        blockedAccountMessage = null;
        setStatus(navigator.onLine ? 'action-needed' : 'offline');
        setMessage(reason ?? (navigator.onLine ? 'Sign in once on this device to turn on automatic sync.' : 'You are offline. Local tracking is still available.'));
        return;
      }

      void startSession(authUser, sequence);
    });

    function handleOffline() {
      updateConnectionStatus();
    }

    function handleOnline() {
      if (activeUserRef.current && rootUnsubscribe) {
        setStatus('syncing');
        setMessage(undefined);
      } else if (activeUserRef.current) void bootstrap(activeUserRef.current);
      else {
        setStatus('action-needed');
        setMessage('Sign in once on this device to turn on automatic sync.');
      }
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      authSequence += 1;
      unsubscribeAuth();
      unsubscribeMutations();
      stopAllListeners();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      bootstrapActiveUserRef.current = () => undefined;
      resolveConflictRef.current = async () => undefined;
    };
  }, [store.applySyncedState, store.subscribeMutations]);

  useEffect(() => {
    if (store.state) bootstrapActiveUserRef.current();
  }, [Boolean(store.state)]);

  const signIn = useCallback(async () => {
    setStatus(navigator.onLine ? 'syncing' : 'offline');
    setMessage(undefined);
    if (!navigator.onLine) {
      setMessage('Connect to the internet for the one-time Google sign-in.');
      return;
    }
    try {
      await authPersistenceReady;
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const eligibility = await describeAccountEligibility(result.user);
      if (!eligibility.ok) {
        await firebaseSignOut(firebaseAuth);
        throw new Error(eligibility.message);
      }
    } catch (error) {
      setStatus('action-needed');
      setMessage(friendlySyncError(error));
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!activeUserRef.current) return;
    if (!navigator.onLine) {
      setStatus('action-needed');
      setMessage('Reconnect before signing out so Daymark can confirm every pending change reached the cloud.');
      return;
    }
    if (await otherTabsOpenRef.current()) {
      setStatus('action-needed');
      setMessage('Close other open Daymark tabs, then sign out again so every local cache can be removed safely.');
      return;
    }
    setStatus('syncing');
    setMessage('Finishing pending writes before removing this device’s copy…');
    let authSessionEnded = false;
    try {
      await finishSafeSignOut({
        waitForPendingWrites: async () => {
          await Promise.race([
            waitForPendingWrites(daymarkFirestore),
            new Promise<never>((_, reject) => window.setTimeout(
              () => reject(new Error('Sync is taking longer than expected. Keep this tab open and try sign-out again after it shows Synced.')),
              20_000,
            )),
          ]);
          stopAllListenersRef.current();
        },
        signOutAuth: async () => {
          await firebaseSignOut(firebaseAuth);
          authSessionEnded = true;
        },
        clearLocalData: store.clearLocalData,
        clearFirestoreCache: async () => {
          await terminate(daymarkFirestore);
          await clearIndexedDbPersistence(daymarkFirestore);
        },
      });
      store.applySyncedState(createInitialState());
      window.location.reload();
    } catch (error) {
      if (authSessionEnded) {
        await store.clearLocalData().catch(() => undefined);
        store.applySyncedState(createInitialState());
      }
      setStatus('action-needed');
      setMessage(authSessionEnded
        ? 'The account is signed out and Daymark hid this device’s record, but the browser cache could not be fully released. Reload after closing other Daymark tabs.'
        : friendlySyncError(error));
    }
  }, [store.applySyncedState, store.clearLocalData]);

  const resolveConflict = useCallback(async (choice: GenerationConflictChoice) => {
    await resolveConflictRef.current(choice);
  }, []);

  return { status, user, lastSyncedAt, message, conflict, resolveConflict, signIn, signOut };
}
