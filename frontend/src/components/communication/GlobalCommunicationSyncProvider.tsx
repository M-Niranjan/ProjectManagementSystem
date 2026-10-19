import React, { useEffect, useRef } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useCommunicationStore } from '../../store/useCommunicationStore';
import { firebaseDb } from '../../services/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';

/**
 * GlobalCommunicationSyncProvider
 * 
 * Provides background real-time communication synchronization:
 * 1. Independent User Presence Lifecycle:
 *    - Heartbeat updates lastActiveAt & lastSeen every 25s
 *    - Detects tab close, pagehide, beforeunload, visibilitychange, and offline
 *    - Automatically marks offline upon tab close or network disconnect
 * 2. Real-Time Delivery Acknowledgment (✓ -> ✓✓):
 *    - Listens for messages sent to currentUid that are currently in status 'sent'
 *    - When recipient's active client receives them:
 *      - If recipient is currently inside that conversation -> marks 'read' with readAt
 *      - Otherwise -> marks 'delivered' with deliveredAt
 *    - Runs across the entire application (Dashboard, Projects, Messages, etc.)
 *    - Completely independent of online presence and timer simulations!
 */
export const GlobalCommunicationSyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, token, activeOrganization } = useAuthStore();
  const currentOpenConversationId = useCommunicationStore((s) => s.currentOpenConversationId);

  const currentUid = user ? String((user as any).firebaseUid || user.id) : null;
  const orgId = String(
    (user as any)?.organizationId ||
    activeOrganization?.organizationId ||
    activeOrganization?.id ||
    ''
  ).trim();

  // Ref to hold delivery listener unsubscribe
  const deliveryUnsubRef = useRef<(() => void) | null>(null);

  // 1. PRESENCE LIFECYCLE & HEARTBEAT
  useEffect(() => {
    if (!firebaseDb || !currentUid || !token) return;

    const userDocRef = doc(firebaseDb, 'users', currentUid);

    const markOnline = () => {
      if (!navigator.onLine) return;
      try {
        setDoc(
          userDocRef,
          {
            uid: currentUid,
            isOnline: true,
            status: 'online',
            lastSeen: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
            ...(orgId ? { organizationId: orgId } : {}),
            name: user?.name || undefined,
            email: user?.email || undefined,
            role: user?.role || undefined,
            profilePhoto: user?.profilePhoto || undefined,
          },
          { merge: true }
        ).catch(() => {});
      } catch (e) {}
    };

    const markOffline = () => {
      try {
        setDoc(
          userDocRef,
          {
            isOnline: false,
            status: 'offline',
            lastSeen: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
      } catch (e) {}
    };

    // Mark online immediately upon mount/login
    markOnline();

    // Heartbeat every 25 seconds while active
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        markOnline();
      }
    }, 25000);

    // Visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markOnline();
      } else {
        // Record lastSeen when tab becomes hidden
        markOffline();
      }
    };

    // Network status handlers
    const handleOnline = () => markOnline();
    const handleOffline = () => markOffline();

    // Unload & pagehide handlers
    const handleBeforeUnload = () => markOffline();
    const handlePageHide = () => markOffline();

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      markOffline();
    };
  }, [currentUid, orgId, token, user?.name, user?.email, user?.role, user?.profilePhoto]);

  // 2. REAL-TIME DELIVERY ACKNOWLEDGMENT (✓ -> ✓✓)
  useEffect(() => {
    if (!firebaseDb || !currentUid || !token || !orgId) {
      if (deliveryUnsubRef.current) {
        deliveryUnsubRef.current();
        deliveryUnsubRef.current = null;
      }
      return;
    }

    try {
      // Query for incoming messages destined for this user that are still marked as 'sent'
      const qIncoming = query(
        collection(firebaseDb, 'messages'),
        where('organizationId', '==', orgId),
        where('receiverId', '==', currentUid),
        where('status', '==', 'sent')
      );

      const unsubscribe = onSnapshot(
        qIncoming,
        (snapshot) => {
          if (snapshot.empty) return;

          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            const senderId = String(data.senderId || '');

            // Don't deliver own messages
            if (senderId === currentUid) return;

            const convId = data.conversationId;
            const isCurrentlyViewingConv =
              currentOpenConversationId && currentOpenConversationId === convId;

            if (isCurrentlyViewingConv) {
              // Recipient is looking at the conversation right now -> Mark as READ directly!
              updateDoc(doc(firebaseDb, 'messages', docSnap.id), {
                status: 'read',
                isRead: true,
                readAt: serverTimestamp(),
                readBy: arrayUnion(currentUid),
              }).catch(() => {});

              if (convId) {
                updateDoc(doc(firebaseDb, 'conversations', convId), {
                  lastMessageIsRead: true,
                  lastMessageStatus: 'read',
                  [`unreadCounts.${currentUid}`]: 0,
                }).catch(() => {});
              }
            } else {
              // Recipient is elsewhere in app -> Acknowledge DELIVERY!
              updateDoc(doc(firebaseDb, 'messages', docSnap.id), {
                status: 'delivered',
                deliveredAt: serverTimestamp(),
                deliveredTo: arrayUnion(currentUid),
              }).catch(() => {});

              if (convId) {
                updateDoc(doc(firebaseDb, 'conversations', convId), {
                  lastMessageStatus: 'delivered',
                }).catch(() => {});
              }
            }
          });
        },
        (err) => {
          console.warn('Delivery acknowledgment subscription notice:', err.message);
        }
      );

      deliveryUnsubRef.current = unsubscribe;
    } catch (err) {
      console.warn('Could not establish delivery acknowledgment listener:', err);
    }

    return () => {
      if (deliveryUnsubRef.current) {
        deliveryUnsubRef.current();
        deliveryUnsubRef.current = null;
      }
    };
  }, [currentUid, orgId, token, currentOpenConversationId]);

  // 3. REAL-TIME APP-WIDE UNREAD CONVERSATION COUNTER
  // Runs everywhere (Dashboard, Tasks, Settings, Profile) so footer dock and header bell update instantly
  useEffect(() => {
    if (!firebaseDb || !currentUid || !token) return;

    const myIds = Array.from(new Set([
      String(currentUid || ''),
      String(user?.id || ''),
      String(user?.uid || ''),
      String((user as any)?.firebaseUid || ''),
      String(user?.email || '').toLowerCase(),
    ].filter(Boolean)));

    const orgFilter = Array.from(new Set([orgId, 'org_default', 'default-org'].filter(Boolean)));

    try {
      const qConversations = query(
        collection(firebaseDb, 'conversations'),
        where('organizationId', 'in', orgFilter)
      );

      const unsubscribe = onSnapshot(
        qConversations,
        (snapshot) => {
          const distinctUnreads: Record<string, number> = {};

          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            let unreadForMe = 0;

            for (const id of myIds) {
              // 1. Nested map check
              if (data.unreadCounts && typeof data.unreadCounts === 'object' && typeof data.unreadCounts[id] === 'number') {
                unreadForMe = Math.max(unreadForMe, data.unreadCounts[id]);
              }
              // 2. Flat dot-notation key check
              const flatKey = `unreadCounts.${id}`;
              if (typeof data[flatKey] === 'number') {
                unreadForMe = Math.max(unreadForMe, data[flatKey]);
              }
            }

            // If user currently has this exact conversation open, unread count is 0
            if (currentOpenConversationId && currentOpenConversationId === docSnap.id) {
              unreadForMe = 0;
            }

            distinctUnreads[docSnap.id] = unreadForMe;
          });

          useCommunicationStore.getState().setUnreadCounts(distinctUnreads);
        },
        (err) => {
          console.warn('Global unread count listener notice:', err);
        }
      );

      return () => unsubscribe();
    } catch (e) {}
  }, [currentUid, orgId, token, currentOpenConversationId, user?.id, user?.uid, (user as any)?.firebaseUid, user?.email]);

  return <>{children}</>;
};

export default GlobalCommunicationSyncProvider;
