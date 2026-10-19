/**
 * Genuine WebRTC Live Video & Audio Engine
 * Real-time peer-to-peer streaming with Google public STUN servers and Cloud Firestore signaling.
 */

import { firebaseDb } from './firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  addDoc,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';

export interface CallSessionData {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  receiverId: string;
  receiverName?: string;
  receiverAvatar?: string;
  callType: 'video' | 'audio';
  status: 'ringing' | 'connecting' | 'active' | 'rejected' | 'ended';
  offer?: { type: string; sdp: string };
  answer?: { type: string; sdp: string };
  organizationId?: string;
  createdAt?: any;
  endedAt?: any;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private callDocUnsub: Unsubscribe | null = null;
  private candidateUnsub: Unsubscribe | null = null;
  private currentCallId: string | null = null;
  private isCaller: boolean = false;
  private candidateQueue: RTCIceCandidateInit[] = [];

  // Callbacks to notify store
  private onRemoteStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onConnectionStateChangeCallback: ((state: RTCPeerConnectionState) => void) | null = null;
  private onCallStatusChangeCallback: ((status: CallSessionData['status']) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  public setCallbacks(callbacks: {
    onRemoteStream?: (stream: MediaStream) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
    onCallStatusChange?: (status: CallSessionData['status']) => void;
    onError?: (error: string) => void;
  }) {
    if (callbacks.onRemoteStream) this.onRemoteStreamCallback = callbacks.onRemoteStream;
    if (callbacks.onConnectionStateChange) this.onConnectionStateChangeCallback = callbacks.onConnectionStateChange;
    if (callbacks.onCallStatusChange) this.onCallStatusChangeCallback = callbacks.onCallStatusChange;
    if (callbacks.onError) this.onErrorCallback = callbacks.onError;
  }

  /**
   * Acquire local webcam and microphone hardware
   */
  public async getLocalMedia(callType: 'video' | 'audio'): Promise<MediaStream> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          callType === 'video'
            ? {
                width: { ideal: 1280, min: 640 },
                height: { ideal: 720, min: 480 },
                facingMode: 'user',
              }
            : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      return stream;
    } catch (err: any) {
      console.error('Error getting local media:', err);
      let errorMsg = 'Failed to access camera/microphone.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = 'Camera and microphone permissions were denied. Please allow camera/microphone access in your browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = 'No camera or microphone device found on your device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg = 'Camera or microphone is already in use by another application.';
      } else if (err.name === 'OverconstrainedError') {
        // Fallback to simpler constraints
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: callType === 'video',
          });
          this.localStream = fallbackStream;
          return fallbackStream;
        } catch (fallbackErr: any) {
          errorMsg = 'Media constraints failed: ' + (fallbackErr.message || fallbackErr.name);
        }
      }
      if (this.onErrorCallback) this.onErrorCallback(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Initialize standard RTCPeerConnection and attach tracks
   */
  private createPeerConnection(): RTCPeerConnection {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnection = pc;
    this.remoteStream = new MediaStream();

    // Attach local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log('WebRTC ontrack received:', event.track.kind);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        // Fallback: add track to remote stream if stream object not present
        if (!this.remoteStream) this.remoteStream = new MediaStream();
        this.remoteStream.addTrack(event.track);
      }
      if (this.onRemoteStreamCallback && this.remoteStream) {
        this.onRemoteStreamCallback(this.remoteStream);
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      console.log('WebRTC peer connection state:', pc.connectionState);
      if (this.onConnectionStateChangeCallback) {
        this.onConnectionStateChangeCallback(pc.connectionState);
      }
      if (pc.connectionState === 'connected') {
        if (this.onCallStatusChangeCallback) {
          this.onCallStatusChangeCallback('active');
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Connection lost
        if (pc.connectionState === 'failed') {
          console.warn('WebRTC connection failed');
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('WebRTC ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (this.onCallStatusChangeCallback) {
          this.onCallStatusChangeCallback('active');
        }
      }
    };

    return pc;
  }

  /**
   * Flush queued ICE candidates after remote description is set
   */
  private async flushCandidateQueue() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.candidateQueue.length > 0) {
      const candidateInit = this.candidateQueue.shift();
      if (candidateInit) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (e) {
          console.warn('Error adding queued ICE candidate:', e);
        }
      }
    }
  }

  /**
   * Caller: Create Call, Generate Offer, and Listen for Answer + Callee ICE Candidates
   */
  public async startCall(params: {
    callerId: string;
    callerName: string;
    callerAvatar?: string;
    receiverId: string;
    receiverName?: string;
    receiverAvatar?: string;
    callType: 'video' | 'audio';
    organizationId?: string;
  }): Promise<string> {
    this.isCaller = true;
    this.candidateQueue = [];

    // 1. Acquire media
    await this.getLocalMedia(params.callType);

    // 2. Setup RTCPeerConnection
    const pc = this.createPeerConnection();

    // 3. Prepare Firestore Call Document
    const callDocRef = doc(collection(firebaseDb, 'calls'));
    const callId = callDocRef.id;
    this.currentCallId = callId;

    const callerCandidatesCollection = collection(firebaseDb, 'calls', callId, 'callerCandidates');
    const calleeCandidatesCollection = collection(firebaseDb, 'calls', callId, 'calleeCandidates');

    // 4. Send ICE Candidates to Firestore
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(callerCandidatesCollection, event.candidate.toJSON()).catch((err) =>
          console.warn('Error saving caller ICE candidate:', err)
        );
      }
    };

    // 5. Create Offer
    const offerDescription = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: params.callType === 'video',
    });
    await pc.setLocalDescription(offerDescription);

    const callData: CallSessionData = {
      callId,
      callerId: params.callerId,
      callerName: params.callerName,
      callerAvatar: params.callerAvatar || '',
      receiverId: params.receiverId,
      receiverName: params.receiverName || '',
      receiverAvatar: params.receiverAvatar || '',
      callType: params.callType,
      status: 'ringing',
      offer: {
        type: offerDescription.type,
        sdp: offerDescription.sdp || '',
      },
      organizationId: params.organizationId || '',
      createdAt: serverTimestamp(),
    };

    await setDoc(callDocRef, callData);

    // 6. Listen for Remote Answer and Status Changes
    this.callDocUnsub = onSnapshot(callDocRef, async (snapshot) => {
      const data = snapshot.data() as CallSessionData | undefined;
      if (!data) return;

      if (data.status && this.onCallStatusChangeCallback) {
        this.onCallStatusChangeCallback(data.status);
      }

      // Check for answer
      if (data.answer && pc && !pc.currentRemoteDescription) {
        try {
          const answerDesc = new RTCSessionDescription(data.answer as RTCSessionDescriptionInit);
          await pc.setRemoteDescription(answerDesc);
          await this.flushCandidateQueue();
        } catch (err) {
          console.error('Error setting remote description on caller:', err);
        }
      }

      // Terminate if callee rejected or call ended
      if (data.status === 'rejected' || data.status === 'ended') {
        this.teardownCall(false);
      }
    });

    // 7. Listen for Callee ICE Candidates
    this.candidateUnsub = onSnapshot(calleeCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const candidateData = change.doc.data();
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
              console.warn('Error adding callee ICE candidate:', e);
            }
          } else {
            this.candidateQueue.push(candidateData as RTCIceCandidateInit);
          }
        }
      });
    });

    return callId;
  }

  /**
   * Callee: Accept Call, Set Remote Description (Offer), Generate Answer, and Exchange Candidates
   */
  public async answerCall(callId: string, callType: 'video' | 'audio'): Promise<void> {
    this.isCaller = false;
    this.currentCallId = callId;
    this.candidateQueue = [];

    // 1. Acquire media
    await this.getLocalMedia(callType);

    // 2. Setup RTCPeerConnection
    const pc = this.createPeerConnection();

    const callDocRef = doc(firebaseDb, 'calls', callId);
    const callerCandidatesCollection = collection(firebaseDb, 'calls', callId, 'callerCandidates');
    const calleeCandidatesCollection = collection(firebaseDb, 'calls', callId, 'calleeCandidates');

    // 3. Send Callee ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(calleeCandidatesCollection, event.candidate.toJSON()).catch((err) =>
          console.warn('Error saving callee ICE candidate:', err)
        );
      }
    };

    // 4. Fetch Call Offer
    const callSnap = await getDoc(callDocRef);
    if (!callSnap.exists()) {
      throw new Error('Call session not found or already ended.');
    }
    const callData = callSnap.data() as CallSessionData;

    if (!callData.offer) {
      throw new Error('Offer not present in call session.');
    }

    // 5. Set Remote Description (Offer)
    const offerDesc = new RTCSessionDescription(callData.offer as RTCSessionDescriptionInit);
    await pc.setRemoteDescription(offerDesc);

    // 6. Create Answer
    const answerDesc = await pc.createAnswer();
    await pc.setLocalDescription(answerDesc);

    // 7. Update Call Document with Answer and 'connecting' status
    await updateDoc(callDocRef, {
      answer: {
        type: answerDesc.type,
        sdp: answerDesc.sdp || '',
      },
      status: 'connecting',
    });

    // 8. Listen for Caller ICE Candidates
    this.candidateUnsub = onSnapshot(callerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const candidateData = change.doc.data();
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
              console.warn('Error adding caller ICE candidate:', e);
            }
          } else {
            this.candidateQueue.push(candidateData as RTCIceCandidateInit);
          }
        }
      });
    });

    // Flush any early candidates
    await this.flushCandidateQueue();

    // 9. Listen for status changes (e.g. caller ends call)
    this.callDocUnsub = onSnapshot(callDocRef, (snapshot) => {
      const data = snapshot.data() as CallSessionData | undefined;
      if (!data) return;

      if (data.status && this.onCallStatusChangeCallback) {
        this.onCallStatusChangeCallback(data.status);
      }

      if (data.status === 'ended' || data.status === 'rejected') {
        this.teardownCall(false);
      }
    });
  }

  /**
   * Reject incoming call
   */
  public async rejectCall(callId: string): Promise<void> {
    try {
      const callDocRef = doc(firebaseDb, 'calls', callId);
      await updateDoc(callDocRef, {
        status: 'rejected',
        endedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Error marking call as rejected:', e);
    }
    this.teardownCall(false);
  }

  /**
   * End call gracefully
   */
  public async endCall(): Promise<void> {
    if (this.currentCallId) {
      try {
        const callDocRef = doc(firebaseDb, 'calls', this.currentCallId);
        await updateDoc(callDocRef, {
          status: 'ended',
          endedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Error marking call as ended:', e);
      }
    }
    this.teardownCall(true);
  }

  /**
   * Release hardware, stop tracks, close RTCPeerConnection, unsubscribe Firestore
   */
  public teardownCall(notify: boolean = true) {
    // 1. Stop all local tracks to release hardware locks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.localStream = null;
    }

    // 2. Stop remote tracks
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.remoteStream = null;
    }

    // 3. Close Peer Connection
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }

    // 4. Unsubscribe listeners
    if (this.callDocUnsub) {
      this.callDocUnsub();
      this.callDocUnsub = null;
    }
    if (this.candidateUnsub) {
      this.candidateUnsub();
      this.candidateUnsub = null;
    }

    this.candidateQueue = [];
    this.currentCallId = null;

    if (notify && this.onCallStatusChangeCallback) {
      this.onCallStatusChangeCallback('ended');
    }
  }

  /**
   * Toggle Audio Mute
   */
  public toggleMute(muted: boolean): boolean {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    audioTracks.forEach((t) => {
      t.enabled = !muted;
    });
    return muted;
  }

  /**
   * Toggle Video On / Off
   */
  public toggleVideo(videoOff: boolean): boolean {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach((t) => {
      t.enabled = !videoOff;
    });
    return videoOff;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }
}

// Global Singleton Instance
export const webrtcService = new WebRTCService();
