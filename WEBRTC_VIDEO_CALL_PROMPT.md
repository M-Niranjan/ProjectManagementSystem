# Real WebRTC Video Call Engine & Universal Incoming Call Notification System

## Task Overview
Replace the fake call simulation modal in `frontend/src/pages/Messages.tsx` with a genuine, production-grade WebRTC audio/video calling engine and an app-wide incoming call notification popup.

---

## 1. Problem Statement & Root Cause Diagnosis

### Current Buggy Behavior
1. In `frontend/src/pages/Messages.tsx` (lines 1762–1780), initiating a call triggers a 2-second JavaScript timer:
   ```typescript
   setTimeout(() => {
     setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
   }, 2000);
   ```
2. The duration timer (`callTimerRef`) starts counting seconds (`00:01`, `00:02`, ...) locally in the browser without network confirmation or recipient approval.
3. No network event or signaling message is dispatched to the recipient (Device B). Device B receives no incoming call alert, chime, or modal.
4. The call overlay (lines 4230–4286) only renders a static `<img>` avatar and dummy `showToast()` triggers on the microphone and camera buttons. No actual webcam feed or remote video stream is displayed.

---

## 2. Technical Architecture & Implementation Plan

### Architecture Diagram
```
[Device A: Caller]                         [Firestore Signaling]                       [Device B: Opponent]
       │                                            │                                            │
       ├──── Initiates Call (Status: "ringing") ───>│                                            │
       │     (Duration stays 00:00, Ringing state)  ├───── Universal Incoming Call Popup ───────>│
       │                                            │      (Displays Green Accept & Red Decline) │
       │                                            │                                            │
       │                                            │<──── Opponent clicks ACCEPT (SDP Answer) ──┤
       │<─── Connection State = "connected" ────────┤                                            │
       │                                                                                         │
  [TIMER STARTS (00:01, 00:02...)]                                                [TIMER STARTS (00:01, 00:02...)]
  [LIVE LOCAL WEBCAM & REMOTE VIDEO STREAM]                                       [LIVE LOCAL WEBCAM & REMOTE VIDEO STREAM]
```

---

## 3. Detailed Specifications

### A. Real-Time Signaling Channel (Cloud Firestore)
- **Collection:** `/calls/{callId}`
- **Document Structure:**
  ```typescript
  interface CallSessionData {
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
  ```
- **Candidate Subcollections:**
  - `/calls/{callId}/callerCandidates`
  - `/calls/{callId}/calleeCandidates`
- **STUN Configuration:**
  ```javascript
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
  ```
- **Security Rules (`firestore.rules`):**
  Add authenticated read/write rules for `/calls/{callId}` and subcollections.

---

### B. Universal App-Wide Incoming Call Popup (`<IncomingCallPopup />`)
- Mount globally in `frontend/src/App.tsx`.
- Create a background listener watching for calls where:
  `receiverId == currentUserId && status == 'ringing'`
- When Device A calls Device B, Device B receives a floating notification card across **all modules** (Dashboard, Tasks, Projects, Teams, Documents, Settings, etc.) without forcing a page redirect.
- The popup displays:
  1. Caller's name and avatar (with initial fallback).
  2. Call type badge (`Video Call` or `Audio Call`).
  3. Looping ringing audio chime generated via the Web Audio API.
  4. **Accept Button (Green):**
     - Stops the ring chime.
     - Acquires local camera and microphone.
     - Sets caller's offer as remote description, generates WebRTC answer, and updates Firestore status to `'connecting'`.
     - Opens the live WebRTC video room.
  5. **Decline Button (Red):**
     - Stops the ring chime.
     - Updates Firestore call status to `'rejected'`.
     - Dismisses the popup without interrupting current work.
     - Caller receives the rejected status, displays "Call declined", and closes.

---

### C. Live WebRTC Video & Audio Engine (`<ActiveVideoCallModal />`)
- **Remote Video Viewport:** Render remote peer's live stream using `<video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />`.
- **Local Video Viewport:** Render local webcam in a mirrored Picture-in-Picture (PiP) viewport using `<video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />`.
- **Avatar Fallback:** Display profile picture only when the camera is toggled off or while waiting for connection.
- **Hardware Controls:**
  - Microphone Toggle: Live mute/unmute audio tracks (`localStream.getAudioTracks().forEach(t => t.enabled = !isMuted)`).
  - Camera Toggle: Live toggle video tracks (`localStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff)`).
  - End Call Button: Terminates call, stops all hardware media tracks (`track.stop()`), closes `peerConnection.close()`, releases camera/mic device locks, and marks call `'ended'` in Firestore.
- **Hardware Error Handling:** Gracefully catch and display clear alerts for `NotAllowedError`, `NotFoundError`, and `NotReadableError`.

---

### D. Strict Call Lifecycle & Timer Synchronization
- Completely remove `setTimeout(..., 2000)` and fake local `setInterval`.
- Call status strictly follows:
  `RINGING` ➔ `CONNECTING` ➔ `CONNECTED` (only when `peerConnection.connectionState === 'connected'`) ➔ `ENDED` / `REJECTED`.
- **Timer Rule:** The duration timer starts counting (`00:01`, `00:02`, ...) strictly after the WebRTC connection state reaches `'connected'`.

---

## 4. Files to Create / Modify

| File | Purpose |
|---|---|
| `firestore.rules` | Add read/write rules for `/calls/{callId}` and subcollections |
| `frontend/src/utils/ringtone.ts` | Web Audio API ringtone synthesizer and call sound effects |
| `frontend/src/services/webrtc.ts` | WebRTC peer connection, STUN servers, offer/answer, and candidate exchange |
| `frontend/src/store/useCallStore.ts` | Zustand store for active/incoming call state, media streams, and listeners |
| `frontend/src/components/communication/IncomingCallPopup.tsx` | Universal incoming call card with Accept and Decline actions |
| `frontend/src/components/communication/ActiveVideoCallModal.tsx` | Live WebRTC video modal with mirrored PiP and hardware controls |
| `frontend/src/App.tsx` | Mount `<IncomingCallPopup />` and `<ActiveVideoCallModal />` globally |
| `frontend/src/pages/Messages.tsx` | Wire call button to `useCallStore.initiateCall` and remove simulation overlay |

---

## 5. Verification Checklist
- [ ] Device A calling Device B displays `Ringing...` on Device A with timer held at `00:00`.
- [ ] Device B receives floating `<IncomingCallPopup />` with ringing chime regardless of current route.
- [ ] Clicking **Decline** on Device B stops chime, dismisses card, and notifies Device A ("Call declined").
- [ ] Clicking **Accept** on Device B connects both devices via WebRTC.
- [ ] Live webcam video displays in mirrored PiP; remote participant live video displays in main viewport.
- [ ] Timer starts counting strictly after peer connection state is `'connected'`.
- [ ] Microphone and Camera buttons actually enable/disable hardware tracks.
- [ ] Ending the call stops all hardware tracks (`track.stop()`), closes peer connection, and clears UI on both devices.
- [ ] `tsc -b && vite build` compiles with 0 errors.
