import { create } from 'zustand';
import { webrtcService, CallSessionData } from '../services/webrtc';
import { useAuthStore } from './useAuthStore';
import { firebaseDb } from '../services/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  Unsubscribe,
  orderBy,
  limit,
} from 'firebase/firestore';
import {
  startRingtone,
  stopRingtone,
  playConnectedTone,
  playCallEndTone,
} from '../utils/ringtone';
import { useUIStore } from './useUIStore';

export interface ActiveCall {
  callId: string;
  role: 'caller' | 'callee';
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  receiverId: string;
  receiverName: string;
  receiverAvatar?: string;
  callType: 'video' | 'audio';
  status: 'ringing' | 'connecting' | 'connected' | 'ended' | 'rejected';
  duration: number;
  errorMessage?: string;
}

export interface IncomingCall {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  receiverId: string;
  callType: 'video' | 'audio';
  organizationId?: string;
  createdAt?: any;
}

interface CallStoreState {
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  callTimerInterval: number | null;
  listenerUnsubs: Unsubscribe[];

  // Actions
  setupIncomingCallListener: (currentUserId: string, alternateId?: string) => () => void;
  initiateCall: (params: {
    receiverId: string;
    receiverName: string;
    receiverAvatar?: string;
    callType?: 'video' | 'audio';
  }) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  dismissError: () => void;
}

export const useCallStore = create<CallStoreState>((set, get) => {
  // Wire webrtcService callbacks to store
  webrtcService.setCallbacks({
    onRemoteStream: (stream) => {
      console.log('WebRTC Store received remote stream with tracks:', stream.getTracks().length);
      set({ remoteStream: stream });
    },
    onConnectionStateChange: (state) => {
      console.log('WebRTC Store peer connection state update:', state);
      if (state === 'connected') {
        stopRingtone();
        playConnectedTone();

        const currentActive = get().activeCall;
        if (currentActive && currentActive.status !== 'connected') {
          // Start actual duration timer
          if (get().callTimerInterval) {
            clearInterval(get().callTimerInterval!);
          }
          const timer = window.setInterval(() => {
            set((prev) => {
              if (prev.activeCall && prev.activeCall.status === 'connected') {
                return {
                  activeCall: {
                    ...prev.activeCall,
                    duration: prev.activeCall.duration + 1,
                  },
                };
              }
              return prev;
            });
          }, 1000);

          set({
            callTimerInterval: timer,
            activeCall: {
              ...currentActive,
              status: 'connected',
            },
          });
        }
      } else if (state === 'disconnected' || state === 'failed') {
        const currentActive = get().activeCall;
        if (currentActive && currentActive.status === 'connected') {
          useUIStore.getState().showToast('Call connection lost', 'warning');
        }
      } else if (state === 'closed') {
        get().endCall();
      }
    },
    onCallStatusChange: (status) => {
      const currentActive = get().activeCall;
      if (!currentActive) return;

      if (status === 'rejected') {
        stopRingtone();
        playCallEndTone();
        useUIStore.getState().showToast('Call declined', 'info');
        if (get().callTimerInterval) clearInterval(get().callTimerInterval!);
        set({
          activeCall: { ...currentActive, status: 'rejected' },
          callTimerInterval: null,
          localStream: null,
          remoteStream: null,
        });
        setTimeout(() => {
          set({ activeCall: null });
        }, 1500);
      } else if (status === 'ended') {
        stopRingtone();
        playCallEndTone();
        if (get().callTimerInterval) clearInterval(get().callTimerInterval!);
        set({
          activeCall: { ...currentActive, status: 'ended' },
          callTimerInterval: null,
          localStream: null,
          remoteStream: null,
        });
        setTimeout(() => {
          set({ activeCall: null });
        }, 1200);
      } else if (status === 'connecting' && currentActive.status !== 'connected') {
        set({ activeCall: { ...currentActive, status: 'connecting' } });
      }
    },
    onError: (errorMsg) => {
      useUIStore.getState().showToast(errorMsg, 'error');
      const currentActive = get().activeCall;
      if (currentActive) {
        set({
          activeCall: {
            ...currentActive,
            errorMessage: errorMsg,
          },
        });
      }
    },
  });

  return {
    activeCall: null,
    incomingCall: null,
    localStream: null,
    remoteStream: null,
    isMuted: false,
    isVideoOff: false,
    callTimerInterval: null,
    listenerUnsubs: [],

    setupIncomingCallListener: (currentUserId: string, alternateId?: string) => {
      if (!firebaseDb || !currentUserId) return () => {};

      // Clean up previous listeners
      get().listenerUnsubs.forEach((u) => u());
      set({ listenerUnsubs: [] });

      const handleCallSnapshot = (snapshot: any) => {
        let foundIncoming: IncomingCall | null = null;

        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as CallSessionData;
          if (data && data.status === 'ringing' && data.callerId !== currentUserId) {
            foundIncoming = {
              callId: docSnap.id,
              callerId: data.callerId,
              callerName: data.callerName || 'Colleague',
              callerAvatar: data.callerAvatar,
              receiverId: data.receiverId,
              callType: data.callType || 'video',
              organizationId: data.organizationId,
              createdAt: data.createdAt,
            };
          }
        });

        const prevIncoming = get().incomingCall;
        const currentActive = get().activeCall;

        if (foundIncoming) {
          // If already in an active connected call, don't override active call, but could show busy
          if (!currentActive) {
            set({ incomingCall: foundIncoming });
            startRingtone();
          }
        } else {
          // Ringing call was either cancelled, rejected, or answered
          if (prevIncoming) {
            stopRingtone();
            set({ incomingCall: null });
          }
        }
      };

      const idsToListen = [currentUserId];
      if (alternateId && alternateId !== currentUserId) {
        idsToListen.push(alternateId);
      }

      const unsubs: Unsubscribe[] = [];

      idsToListen.forEach((targetId) => {
        try {
          const q = query(
            collection(firebaseDb, 'calls'),
            where('receiverId', '==', targetId),
            where('status', '==', 'ringing')
          );
          const unsub = onSnapshot(q, handleCallSnapshot, (err) => {
            console.warn('Incoming call listener warning:', err);
          });
          unsubs.push(unsub);
        } catch (err) {
          console.warn('Could not setup incoming call query for ID', targetId, err);
        }
      });

      set({ listenerUnsubs: unsubs });

      return () => {
        unsubs.forEach((u) => u());
        set({ listenerUnsubs: [] });
      };
    },

    initiateCall: async ({ receiverId, receiverName, receiverAvatar, callType = 'video' }) => {
      const authUser = useAuthStore.getState().user;
      if (!authUser) {
        useUIStore.getState().showToast('Please sign in to make a call', 'warning');
        return;
      }

      const callerId = String((authUser as any).firebaseUid || authUser.uid || authUser.id);
      const callerName = authUser.name || 'You';
      const callerAvatar = authUser.profilePhoto || '';
      const orgId = authUser.organizationId || '';

      // Reset mute/video off flags
      set({
        isMuted: false,
        isVideoOff: false,
        activeCall: {
          callId: '',
          role: 'caller',
          callerId,
          callerName,
          callerAvatar,
          receiverId,
          receiverName,
          receiverAvatar,
          callType,
          status: 'ringing',
          duration: 0,
        },
      });

      // Play soft ringtone chime for caller while waiting for recipient
      startRingtone();

      try {
        const callId = await webrtcService.startCall({
          callerId,
          callerName,
          callerAvatar,
          receiverId,
          receiverName,
          receiverAvatar,
          callType,
          organizationId: orgId,
        });

        const localStream = webrtcService.getLocalStream();
        set((prev) => ({
          localStream,
          activeCall: prev.activeCall ? { ...prev.activeCall, callId } : null,
        }));
      } catch (err: any) {
        stopRingtone();
        console.error('Failed to initiate call:', err);
        useUIStore.getState().showToast(err.message || 'Call failed to start', 'error');
        set({ activeCall: null, localStream: null, remoteStream: null });
      }
    },

    acceptCall: async () => {
      stopRingtone();
      const incoming = get().incomingCall;
      if (!incoming) return;

      const authUser = useAuthStore.getState().user;
      const receiverName = authUser?.name || 'You';
      const receiverAvatar = authUser?.profilePhoto || '';

      set({
        incomingCall: null,
        isMuted: false,
        isVideoOff: false,
        activeCall: {
          callId: incoming.callId,
          role: 'callee',
          callerId: incoming.callerId,
          callerName: incoming.callerName,
          callerAvatar: incoming.callerAvatar,
          receiverId: incoming.receiverId,
          receiverName,
          receiverAvatar,
          callType: incoming.callType,
          status: 'connecting',
          duration: 0,
        },
      });

      try {
        await webrtcService.answerCall(incoming.callId, incoming.callType);
        const localStream = webrtcService.getLocalStream();
        set({ localStream });
      } catch (err: any) {
        console.error('Failed to answer call:', err);
        useUIStore.getState().showToast(err.message || 'Failed to connect to call', 'error');
        webrtcService.teardownCall(true);
        set({ activeCall: null, localStream: null, remoteStream: null });
      }
    },

    rejectCall: async () => {
      stopRingtone();
      playCallEndTone();
      const incoming = get().incomingCall;
      if (incoming) {
        await webrtcService.rejectCall(incoming.callId);
      }
      set({ incomingCall: null });
    },

    endCall: async () => {
      stopRingtone();
      playCallEndTone();

      if (get().callTimerInterval) {
        clearInterval(get().callTimerInterval!);
      }

      await webrtcService.endCall();

      set({
        activeCall: null,
        incomingCall: null,
        localStream: null,
        remoteStream: null,
        callTimerInterval: null,
        isMuted: false,
        isVideoOff: false,
      });
    },

    toggleMute: () => {
      const nextMuted = !get().isMuted;
      webrtcService.toggleMute(nextMuted);
      set({ isMuted: nextMuted });
      useUIStore.getState().showToast(nextMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
    },

    toggleVideo: () => {
      const nextVideoOff = !get().isVideoOff;
      webrtcService.toggleVideo(nextVideoOff);
      set({ isVideoOff: nextVideoOff });
      useUIStore.getState().showToast(nextVideoOff ? 'Camera turned off' : 'Camera turned on', 'info');
    },

    dismissError: () => {
      const active = get().activeCall;
      if (active) {
        set({ activeCall: { ...active, errorMessage: undefined } });
      }
    },
  };
});
