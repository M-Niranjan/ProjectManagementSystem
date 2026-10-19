import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardPathForRole } from '../services/authRoles';
import {
  MessageSquare,
  Send,
  Paperclip,
  Smile,
  Search,
  Hash,
  Users,
  Radio,
  CheckCheck,
  Info,
  User,
  Plus,
  X,
  Lock,
  Pin,
  Heart,
  ThumbsUp,
  Flame,
  Zap,
  MoreVertical,
  Edit2,
  Trash2,
  Reply,
  Bell,
  BellOff,
  ChevronLeft,
  ChevronDown,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Download,
  Loader2,
  Video,
  FileText,
  Star,
  Settings,
  Mic,
  PhoneOff,
  Phone,
  UserPlus,
  Shield,
  Layers,
  ArrowRight,
  LogOut,
  Sliders,
  Eye,
  Check,
  Volume2,
  Clock,
  Share2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Play,
  Pause,
  Camera,
  MessageSquarePlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../services/api';
import {
  firebaseDb,
  firebaseAuth,
  fetchFirestoreProjects,
  fetchFirestoreUserDoc,
  upsertFirestoreUserDoc,
  fetchFirestoreUsersByOrg
} from '../services/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  limit,
  arrayUnion,
  increment
} from 'firebase/firestore';
import { resolveAvatar } from '../services/avatar';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { useCallStore } from '../store/useCallStore';
import { formatRoleName, normalizeRole } from '../services/authRoles';
import LuxurySelect, { LuxurySelectOption } from '../components/common/LuxurySelect';
import {
  useCommunicationStore,
  ChatMessage,
  ChannelItem,
  ContactItem
} from '../store/useCommunicationStore';
import CreateChannelModal, { ChannelFormData } from '../components/communication/CreateChannelModal';
import ConversationDetailsPanel from '../components/communication/ConversationDetailsPanel';
import MessageComposer from '../components/communication/MessageComposer';
import PremiumPdfViewerModal from '../components/common/PremiumPdfViewerModal';
import MessageStatus from '../components/communication/MessageStatus';

// Team Channel Item Interface
export interface TeamChannelItem {
  id: string | number;
  name: string;
  description: string;
  department: string;
  membersCount: number;
}

// Dedicated AI Assistant Constant
const AI_ASSISTANT_ID = 'ai_copilot_assistant';
const AI_CONTACT: ContactItem = {
  id: AI_ASSISTANT_ID,
  name: 'Project AI Assistant',
  email: 'ai-copilot@taskflow.internal',
  role: 'AI Assistant',
  designation: 'Workspace Copilot',
  department: 'Intelligent Automation',
  profilePhoto: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
  isOnline: true
};

// Deterministic 1-to-1 Conversation ID Generator (Requirement 2: Sorted UIDs)
export const getDirectConversationId = (uid1: string | number, uid2: string | number): string => {
  const u1 = String(uid1 || '').trim();
  const u2 = String(uid2 || '').trim();
  if (!u1 || !u2) {
    return [u1 || 'unknown_a', u2 || 'unknown_b'].sort().join('_');
  }
  return [u1, u2].sort().join('_');
};

export const getConversationId = (
  type: 'channel' | 'dm' | 'team' | 'ai',
  orgId: string,
  targetId: string | number,
  currentUid?: string | number
): string => {
  const cleanOrg = String(orgId || 'org_default').trim();
  if (type === 'channel') {
    return `ch_${cleanOrg}_${targetId}`;
  }
  if (type === 'team') {
    return `team_${cleanOrg}_${targetId}`;
  }
  if (type === 'ai') {
    return `ai_${cleanOrg}_${currentUid || 'user'}`;
  }
  // For Direct Messages (DMs): Sort UIDs deterministically: [uid1, uid2].sort().join("_")
  return getDirectConversationId(currentUid || '', targetId);
};

// Synthesize pleasant notification chime using Web Audio API (Requirement 26 & 27)
const playChime = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
};

export default function Messages() {
  const navigate = useNavigate();
  const { user, activeOrganizationId, activeOrganization, logout, updateProfile } = useAuthStore();
  const { chatContactId, setChatContactId, showToast: triggerGlobalToast } = useUIStore();

  // Communication Store
  const {
    searchQuery,
    setSearchQuery,
    messageSearchQuery,
    setMessageSearchQuery,
    detailsPanelOpen,
    toggleDetailsPanel,
    replyToMessage,
    setReplyToMessage,
    editingMessage,
    setEditingMessage,
    onlineUsers,
    setOnlineStatus
  } = useCommunicationStore();

  // Organization & Current User (Firebase Auth UID as Primary Identity - Requirement 1)
  const orgId = activeOrganizationId || activeOrganization?.organizationId || 'default-org';
  const currentUid = firebaseAuth.currentUser?.uid || user?.uid || (typeof user?.id === 'string' && isNaN(Number(user?.id)) ? user.id : String(user?.id || 'unknown-user'));
  const userRoleNorm = normalizeRole(user?.role);

  // Conversation Selection State
  const [selectedConversationType, setSelectedConversationType] = useState<'channel' | 'dm' | 'team' | 'ai' | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | number | null>(null);

  // Navigation rail tab & filter
  const [navRailTab, setNavRailTab] = useState<'chats' | 'teams' | 'channels' | 'calls' | 'ai' | 'starred' | 'settings'>('chats');
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'dms' | 'teams' | 'channels'>('all');
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // Lock document scroll and rubber-banding on mobile so page is 100% constant / immoveable
  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
    };
  }, []);



  // Network Offline Banner State (Requirement 39)
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Channels, Teams, Contacts & Messages
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [teams, setTeams] = useState<TeamChannelItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([AI_CONTACT]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | number | null>(null);

  // Real-Time Conversation Activity Metadata (Requirement 3 & 4)
  const [convMetaMap, setConvMetaMap] = useState<Record<string, {
    lastMessageText: string;
    lastMessageAt: string;
    lastSenderId: string | number;
    lastSenderName: string;
    lastMessageIsRead?: boolean;
    lastMessageStatus?: string;
    unreadCount?: number;
  }>>(() => {
    try {
      const cached = localStorage.getItem(`pms_conv_meta_${orgId}`);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return {};
  });

  const setCurrentOpenConversationId = useCommunicationStore((s) => s.setCurrentOpenConversationId);

  // Real-Time Typing State (Requirement 10: Temporary realtime presence per conversation)
  const [typingUserInActiveConv, setTypingUserInActiveConv] = useState<string | null>(null);
  const typingTimerRef = useRef<any>(null);

  // Synchronize active open conversation ID for accurate background delivery vs read logic
  useEffect(() => {
    setCurrentOpenConversationId(selectedConversationId);
    return () => {
      setCurrentOpenConversationId(null);
    };
  }, [selectedConversationId, setCurrentOpenConversationId]);

  // Settings State (Persisted in localStorage & Firestore user doc)
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('pms_comm_settings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      soundEnabled: true,
      desktopNotifications: true,
      enterToSend: true,
      readReceipts: true,
      onlineStatusVisible: true
    };
  });

  // Presence / Availability Status
  const [userStatus, setUserStatus] = useState<'online' | 'away' | 'busy' | 'offline'>('online');

  // Enterprise PDF Viewer Modal State (Requirement 18)
  const [selectedPdfToView, setSelectedPdfToView] = useState<{
    isOpen: boolean;
    url: string;
    fileName: string;
    fileSize: string;
    uploadedBy: string;
    uploadedAt: string;
    project: string;
    organization: string;
    accessLevel: string;
  }>({
    isOpen: false,
    url: '',
    fileName: '',
    fileSize: '',
    uploadedBy: '',
    uploadedAt: '',
    project: '',
    organization: '',
    accessLevel: ''
  });

  // Fullscreen Image Lightbox Modal State (Requirement 17)
  const [activeImageLightbox, setActiveImageLightbox] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
  }>({
    isOpen: false,
    url: '',
    title: '',
  });

  // Forward Message Modal State (Requirement 14)
  const [forwardModalData, setForwardModalData] = useState<{
    isOpen: boolean;
    messageText: string;
  }>({
    isOpen: false,
    messageText: '',
  });

  // Delete Confirmation Modal State (Requirement 12)
  const [deleteConfirmMsgId, setDeleteConfirmMsgId] = useState<string | number | null>(null);

  // Audio Playback state for voice messages (Requirement 22)
  const [playingAudioId, setPlayingAudioId] = useState<string | number | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});

  // Modals & Panels
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const [isDocumentPickerOpen, setIsDocumentPickerOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isViewProfileModalOpen, setIsViewProfileModalOpen] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [selectedDocToSend, setSelectedDocToSend] = useState<any | null>(null);
  const [docRecipientType, setDocRecipientType] = useState<'channel' | 'dm'>('channel');
  const [docRecipientId, setDocRecipientId] = useState<string | number>('');

  // Action Menu, Dropdown Context Menu & Emoji Reaction Tray
  const [activeMessageActionId, setActiveMessageActionId] = useState<string | number | null>(null);
  const [activeContextMenuMsgId, setActiveContextMenuMsgId] = useState<string | number | null>(null);
  const [activeReactionTrayMsgId, setActiveReactionTrayMsgId] = useState<string | number | null>(null);
  const [showThreadSearch, setShowThreadSearch] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  const threadSearchContainerRef = useRef<HTMLDivElement>(null);
  const threadSearchButtonRef = useRef<HTMLButtonElement>(null);

  // Close context menu & emoji tray on click outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setActiveContextMenuMsgId(null);
      setActiveReactionTrayMsgId(null);
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  // Auto-close In-Thread Search when clicking anywhere outside the search bar
  useEffect(() => {
    if (!showThreadSearch) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        threadSearchContainerRef.current &&
        !threadSearchContainerRef.current.contains(target) &&
        threadSearchButtonRef.current &&
        !threadSearchButtonRef.current.contains(target)
      ) {
        setShowThreadSearch(false);
        setMessageSearchQuery('');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowThreadSearch(false);
        setMessageSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showThreadSearch, setMessageSearchQuery]);

  // Edit Profile Form State
  const [editName, setEditName] = useState(user?.name || '');
  const [editDesignation, setEditDesignation] = useState(user?.designation || '');
  const [editDepartment, setEditDepartment] = useState(user?.department || '');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const firestoreUnsubscribeRef = useRef<(() => void) | null>(null);
  const conversationListenerRef = useRef<(() => void) | null>(null);

  const showToast = (msg: string) => {
    triggerGlobalToast(msg, 'info');
  };

  // Online / Offline listener (Requirement 39)
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      showToast('Back online. Synchronizing chats...');
    };
    const handleOffline = () => {
      setIsOffline(true);
      showToast('You are currently offline. Actions will be cached.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update presence in Firestore & periodic heartbeat (Requirement 20)
  useEffect(() => {
    if (!firebaseDb || !currentUid || currentUid === 'unknown-user') return;
    const userDocRef = doc(firebaseDb, 'users', currentUid);

    const updatePresence = () => {
      try {
        setDoc(userDocRef, {
          isOnline: settings.onlineStatusVisible ? (userStatus !== 'offline') : false,
          status: userStatus,
          lastSeen: serverTimestamp(),
          organizationId: orgId,
        }, { merge: true }).catch(() => {});
      } catch (e) {}
    };

    updatePresence();

    const interval = setInterval(() => {
      if (userStatus !== 'offline') {
        updatePresence();
      }
    }, 25000);

    const handleBeforeUnload = () => {
      try {
        setDoc(userDocRef, {
          isOnline: false,
          status: 'offline',
          lastSeen: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      } catch (e) {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUid, userStatus, settings.onlineStatusVisible]);

  // Save Settings
  const handleSaveSettings = (newSettings: typeof settings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('pms_comm_settings', JSON.stringify(newSettings));
    } catch (e) {}
    setIsSettingsModalOpen(false);
    showToast('Settings saved successfully');
  };

  // 1. LOAD ORGANIZATION MEMBERS & CHANNELS (Requirement 1: Real Firebase Auth UIDs)
  const loadOrganizationData = useCallback(async () => {
    try {
      const memberList: ContactItem[] = [];
      const seenIds = new Set<string>();

      // 1. Query Cloud Firestore 'users' collection FILTERED BY organizationId (ORGANIZATION ISOLATION)
      if (firebaseDb && orgId && orgId !== 'default-org') {
        try {
          const orgUsersQuery = query(
            collection(firebaseDb, 'users'),
            where('organizationId', '==', orgId)
          );
          const usersSnap = await getDocs(orgUsersQuery);
          const now = Date.now();
          usersSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const memberUid = String(docSnap.id || data.uid || '');
            if (memberUid && memberUid !== String(currentUid) && !seenIds.has(memberUid)) {
              seenIds.add(memberUid);

              let lastSeenMs = 0;
              let lastSeenDate: any = null;
              if (data.lastSeen?.toMillis) {
                lastSeenMs = data.lastSeen.toMillis();
                lastSeenDate = data.lastSeen.toDate();
              } else if (data.lastSeen?.seconds) {
                lastSeenMs = data.lastSeen.seconds * 1000;
                lastSeenDate = new Date(lastSeenMs);
              } else if (data.lastSeen) {
                const parsed = new Date(data.lastSeen).getTime();
                if (!isNaN(parsed)) {
                  lastSeenMs = parsed;
                  lastSeenDate = new Date(parsed);
                }
              }

              let isUserOnline = false;
              let effectiveStatus: 'online' | 'away' | 'busy' | 'offline' = 'offline';

              if (data.status !== 'offline' && data.isOnline !== false) {
                const hasRecentHeartbeat = lastSeenMs > 0 && (now - lastSeenMs < 120000);
                isUserOnline = data.isOnline === true && (lastSeenMs === 0 || hasRecentHeartbeat);
                effectiveStatus = isUserOnline ? (data.status || 'online') : 'offline';
              }

              memberList.push({
                id: memberUid,
                uid: memberUid,
                name: data.name || data.displayName || (data.email ? data.email.split('@')[0] : 'Member'),
                email: data.email || '',
                role: data.role || data.roleCode || 'ROLE_EMPLOYEE',
                designation: data.designation || 'Team Member',
                department: data.department || 'Engineering',
                profilePhoto: data.profilePhoto,
                isOnline: isUserOnline,
                status: effectiveStatus,
                lastSeen: lastSeenDate
              });
            }
          });
        } catch (err) {}
      }

      // 2. Query Firestore organizationMembers collection
      if (firebaseDb) {
        try {
          const qMembers = query(
            collection(firebaseDb, 'organizationMembers'),
            where('organizationId', '==', orgId)
          );
          const snap = await getDocs(qMembers);
          snap.forEach((d) => {
            const data = d.data();
            const memberUid = String(data.userId || data.uid || '');
            if (memberUid && memberUid !== String(currentUid) && !seenIds.has(memberUid)) {
              seenIds.add(memberUid);
              memberList.push({
                id: memberUid,
                uid: memberUid,
                name: data.userName || (data.userEmail ? data.userEmail.split('@')[0] : 'Member'),
                email: data.userEmail || '',
                role: data.role || data.roleCode || 'ROLE_EMPLOYEE',
                designation: data.designation || 'Team Member',
                department: data.department || 'Engineering',
                profilePhoto: data.profilePhoto,
                isOnline: false,
                status: 'offline'
              });
            }
          });
        } catch (err) {}
      }

      // 3. Try Backend API
      try {
        const res = await api.get(`/api/organizations/${orgId}/members`);
        if (Array.isArray(res.data) && res.data.length > 0) {
          res.data.forEach((m: any) => {
            const memberUid = String(m.uid || m.userId || (typeof m.id === 'string' && isNaN(Number(m.id)) ? m.id : ''));
            if (memberUid && memberUid !== String(currentUid) && !seenIds.has(memberUid)) {
              seenIds.add(memberUid);
              const isOnline = Boolean(m.isOnline);
              memberList.push({
                id: memberUid,
                uid: memberUid,
                name: m.name || m.userName || (m.email ? m.email.split('@')[0] : 'Member'),
                email: m.email || m.userEmail || '',
                role: m.role || m.orgRole || 'ROLE_EMPLOYEE',
                designation: m.designation || 'Team Member',
                department: m.department || 'Engineering',
                profilePhoto: m.profilePhoto,
                isOnline,
                status: isOnline ? 'online' : 'offline'
              });
            }
          });
        }
      } catch (err) {}

      setContacts([AI_CONTACT, ...memberList]);
    } catch (e) {}

    // Channels / Projects
    try {
      const channelList: ChannelItem[] = [
        {
          id: 'general-workspace',
          name: 'general-workspace',
          description: 'Organization announcements, sprint updates, and open collaboration',
          isPrivate: false,
          membersCount: 8
        },
        {
          id: 'frontend-dev',
          name: 'frontend-dev',
          description: 'UI components, styling tokens, and frontend architecture',
          isPrivate: false,
          membersCount: 5
        },
        {
          id: 'design-sprint',
          name: 'design-sprint',
          description: 'Design system, Figma reviews, and UX specs',
          isPrivate: false,
          membersCount: 4
        }
      ];

      const isLeadership = userRoleNorm === 'ROLE_ADMIN' || userRoleNorm === 'ROLE_MANAGER';
      channelList.push({
        id: 'leadership-private',
        name: 'leadership-private',
        description: 'Confidential executive reviews and strategic roadmaps',
        isPrivate: true,
        membersCount: 3
      });

      // Append projects from Firestore
      try {
        const fireProjects = await fetchFirestoreProjects(orgId);
        fireProjects.forEach((p: any) => {
          const chName = String(p.name || 'project').toLowerCase().replace(/\s+/g, '-');
          if (!channelList.some((c) => c.name === chName)) {
            channelList.push({
              id: p.id,
              name: chName,
              description: p.description || 'Project workspace channel',
              isPrivate: false,
              membersCount: p.membersCount || 6
            });
          }
        });
      } catch (err) {}

      setChannels(channelList);

      // Teams (Requirement 28: Team Chat)
      const teamList: TeamChannelItem[] = [
        {
          id: 'team-frontend',
          name: 'Frontend Team',
          description: 'Client architecture, UI components, and state management',
          department: 'Engineering',
          membersCount: 4
        },
        {
          id: 'team-backend',
          name: 'Backend & APIs',
          description: 'REST endpoints, database models, and service integration',
          department: 'Engineering',
          membersCount: 4
        },
        {
          id: 'team-design',
          name: 'Product Design',
          description: 'Figma prototypes, design tokens, and user experience',
          department: 'Design',
          membersCount: 3
        },
        {
          id: 'team-devops',
          name: 'DevOps & Cloud',
          description: 'CI/CD pipelines, containerization, and infrastructure',
          department: 'Infrastructure',
          membersCount: 2
        }
      ];
      setTeams(teamList);
    } catch (e) {}
  }, [orgId, currentUid, userRoleNorm]);

  useEffect(() => {
    loadOrganizationData();
  }, [loadOrganizationData]);

  // Real-Time Users Presence & Live Status Listener (Requirement 20 & 44)
  useEffect(() => {
    if (!firebaseDb || !orgId || orgId === 'default-org') return;

    try {
      // ORGANIZATION ISOLATION: Only listen to users within this organization
      const usersOrgQuery = query(
        collection(firebaseDb, 'users'),
        where('organizationId', '==', orgId)
      );
      const unsubscribe = onSnapshot(
        usersOrgQuery,
        (snapshot) => {
          const now = Date.now();
          const presenceMap: Record<string, {
            isOnline: boolean;
            status: 'online' | 'away' | 'busy' | 'offline';
            lastSeen?: any;
            profilePhoto?: string;
            name?: string;
            role?: string;
            organizationId?: string;
          }> = {};

          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            const uid = String(docSnap.id || data.uid || '');
            if (!uid) return;

            // DOUBLE-CHECK: Skip users not belonging to this organization
            if (data.organizationId && data.organizationId !== orgId) return;

            let lastSeenMs = 0;
            let lastSeenDate: any = null;
            if (data.lastSeen?.toMillis) {
              lastSeenMs = data.lastSeen.toMillis();
              lastSeenDate = data.lastSeen.toDate();
            } else if (data.lastSeen?.seconds) {
              lastSeenMs = data.lastSeen.seconds * 1000;
              lastSeenDate = new Date(lastSeenMs);
            } else if (data.lastSeen) {
              const parsed = new Date(data.lastSeen).getTime();
              if (!isNaN(parsed)) {
                lastSeenMs = parsed;
                lastSeenDate = new Date(parsed);
              }
            }

            let isUserOnline = false;
            let effectiveStatus: 'online' | 'away' | 'busy' | 'offline' = 'offline';

            if (data.status !== 'offline' && data.isOnline !== false) {
              const hasRecentHeartbeat = lastSeenMs > 0 && (now - lastSeenMs < 120000);
              if (uid === String(currentUid)) {
                isUserOnline = userStatus !== 'offline';
                effectiveStatus = userStatus;
              } else {
                isUserOnline = data.isOnline === true && (lastSeenMs === 0 || hasRecentHeartbeat);
                effectiveStatus = isUserOnline ? (data.status || 'online') : 'offline';
              }
            }

            presenceMap[uid] = {
              isOnline: isUserOnline,
              status: effectiveStatus,
              lastSeen: lastSeenDate,
              profilePhoto: data.profilePhoto,
              name: data.name || data.displayName,
              role: data.role || data.roleCode,
              organizationId: data.organizationId
            };
          });

          setContacts((prevContacts) => {
            const seenIds = new Set(prevContacts.map((c) => String(c.uid || c.id)));
            const updated = prevContacts.map((c) => {
              if (c.id === AI_ASSISTANT_ID) return c;
              const contactUid = String(c.uid || c.id);
              const live = presenceMap[contactUid];
              if (!live) return c;
              return {
                ...c,
                isOnline: live.isOnline,
                status: live.status,
                lastSeen: live.lastSeen || (c as any).lastSeen,
                profilePhoto: live.profilePhoto || c.profilePhoto,
                name: live.name || c.name,
                role: live.role || c.role
              };
            });

            const newMembers: ContactItem[] = [];
            Object.entries(presenceMap).forEach(([uid, info]) => {
              if (uid !== String(currentUid) && !seenIds.has(uid)) {
                // STRICT: Only add users whose organizationId exactly matches
                if (info.organizationId === orgId) {
                  seenIds.add(uid);
                  newMembers.push({
                    id: uid,
                    uid,
                    name: info.name || 'Member',
                    email: '',
                    role: info.role || 'ROLE_EMPLOYEE',
                    isOnline: info.isOnline,
                    status: info.status,
                    lastSeen: info.lastSeen,
                    profilePhoto: info.profilePhoto,
                  });
                }
              }
            });

            return newMembers.length > 0 ? [...updated, ...newMembers] : updated;
          });
        },
        (err) => {
          console.warn('Users presence subscription notice:', err.message);
        }
      );

      return () => {
        unsubscribe();
      };
    } catch (e) {}
  }, [currentUid, userStatus, orgId]);

  // Real-Time Conversation Activity Metadata Listener (Requirements 3 & 4)
  // Ensures newest message moves the conversation to the top across all clients
  useEffect(() => {
    if (!firebaseDb || !orgId) return;

    if (conversationListenerRef.current) {
      conversationListenerRef.current();
      conversationListenerRef.current = null;
    }

    try {
      const orgFilter = Array.from(new Set([orgId, 'org_default', 'default-org'].filter(Boolean)));
      const qConversations = query(
        collection(firebaseDb, 'conversations'),
        where('organizationId', 'in', orgFilter)
      );

      const unsubscribe = onSnapshot(
        qConversations,
        (snapshot) => {
          const newMetaMap: Record<string, any> = {};
          const newUnreads: Record<string, number> = {};

          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            let lastAt = new Date().toISOString();
            if (data.lastMessageAt?.toDate) {
              lastAt = data.lastMessageAt.toDate().toISOString();
            } else if (data.lastMessageAt?.seconds) {
              lastAt = new Date(data.lastMessageAt.seconds * 1000).toISOString();
            } else if (typeof data.lastMessageAt === 'string') {
              lastAt = data.lastMessageAt;
            } else if (data.lastMessageAtIso) {
              lastAt = data.lastMessageAtIso;
            }

            const myIds = Array.from(new Set([
              String(currentUid || ''),
              String(user?.id || ''),
              String(user?.uid || ''),
              String((user as any)?.firebaseUid || ''),
              String(user?.email || '').toLowerCase()
            ].filter(Boolean)));

            let unreadForMe = 0;
            // 1. Nested map check
            if (data.unreadCounts && typeof data.unreadCounts === 'object') {
              for (const id of myIds) {
                if (typeof data.unreadCounts[id] === 'number') {
                  unreadForMe = Math.max(unreadForMe, data.unreadCounts[id]);
                }
              }
            }
            // 2. Flat dot-notation check
            for (const id of myIds) {
              const flatKey = `unreadCounts.${id}`;
              if (typeof data[flatKey] === 'number') {
                unreadForMe = Math.max(unreadForMe, data[flatKey]);
              }
            }

            // Key by conversation ID
            newUnreads[docSnap.id] = unreadForMe;

            // Also key by the other participant's ID so contact list rows map reliably
            if (Array.isArray(data.participants)) {
              data.participants.forEach((p: any) => {
                const pid = String(p || '');
                if (!myIds.includes(pid)) {
                  newUnreads[pid] = unreadForMe;
                }
              });
            }
            if (Array.isArray(data.participantUids)) {
              data.participantUids.forEach((p: any) => {
                const pid = String(p || '');
                if (!myIds.includes(pid)) {
                  newUnreads[pid] = unreadForMe;
                }
              });
            }
            if (data.targetId && !myIds.includes(String(data.targetId))) {
              newUnreads[String(data.targetId)] = unreadForMe;
            }

            newMetaMap[docSnap.id] = {
              lastMessageText: data.lastMessageText || data.lastMessage || '',
              lastMessageAt: lastAt,
              lastSenderId: data.lastSenderId,
              lastSenderName: data.lastSenderName || 'Member',
              lastMessageIsRead: Boolean(data.lastMessageIsRead),
              lastMessageStatus: data.lastMessageStatus || (data.lastMessageIsRead ? 'read' : 'sent'),
              unreadCount: unreadForMe
            };
          });

          setConvMetaMap((prev) => {
            const merged = { ...prev, ...newMetaMap };
            try {
              localStorage.setItem(`pms_conv_meta_${orgId}`, JSON.stringify(merged));
            } catch (e) {}
            return merged;
          });

          setUnreadMap((prev) => ({ ...prev, ...newUnreads }));

          const distinctStoreUnreads: Record<string, number> = {};
          snapshot.docs.forEach((docSnap) => {
            distinctStoreUnreads[docSnap.id] = newUnreads[docSnap.id] || 0;
          });
          useCommunicationStore.getState().setUnreadCounts(distinctStoreUnreads);
        },
        (err) => {
          console.warn('Conversations real-time subscription notice:', err.message);
        }
      );

      conversationListenerRef.current = unsubscribe;
      return () => {
        if (conversationListenerRef.current) {
          conversationListenerRef.current();
          conversationListenerRef.current = null;
        }
      };
    } catch (e) {}
  }, [orgId, currentUid]);

  // Real-Time Typing Handlers (Requirement 10: Specific to selected conversation)
  const handleUserTyping = useCallback(() => {
    if (!firebaseDb || !selectedConversationId || !currentUid) return;

    try {
      const typingDocRef = doc(firebaseDb, 'typing', `${selectedConversationId}_${currentUid}`);
      setDoc(
        typingDocRef,
        {
          conversationId: selectedConversationId,
          userId: String(currentUid),
          userName: user?.name || 'Someone',
          organizationId: orgId,
          isTyping: true,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch(() => {});

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }

      typingTimerRef.current = setTimeout(() => {
        try {
          setDoc(
            typingDocRef,
            {
              organizationId: orgId,
              isTyping: false,
              updatedAt: serverTimestamp()
            },
            { merge: true }
          ).catch(() => {});
        } catch (e) {}
      }, 2500);
    } catch (e) {}
  }, [selectedConversationId, currentUid, user?.name, orgId]);

  const clearUserTyping = useCallback(() => {
    if (!firebaseDb || !selectedConversationId || !currentUid) return;
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    try {
      const typingDocRef = doc(firebaseDb, 'typing', `${selectedConversationId}_${currentUid}`);
      setDoc(
        typingDocRef,
        {
          organizationId: orgId,
          isTyping: false,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ).catch(() => {});
    } catch (e) {}
  }, [selectedConversationId, currentUid, orgId]);

  // Real-time listener for typing indicator in active conversation
  useEffect(() => {
    if (!firebaseDb || !selectedConversationId) {
      setTypingUserInActiveConv(null);
      return;
    }

    try {
      const qTyping = query(
        collection(firebaseDb, 'typing'),
        where('conversationId', '==', selectedConversationId)
      );

      const unsub = onSnapshot(
        qTyping,
        (snapshot) => {
          const now = Date.now();
          let activeTyper: string | null = null;

          snapshot.docs.forEach((d) => {
            const data = d.data();
            if (data.organizationId && data.organizationId !== orgId) return;
            if (String(data.userId) !== String(currentUid) && data.isTyping === true) {
              let updatedMs = 0;
              if (data.updatedAt?.toMillis) {
                updatedMs = data.updatedAt.toMillis();
              } else if (data.updatedAt?.seconds) {
                updatedMs = data.updatedAt.seconds * 1000;
              } else if (data.updatedAt) {
                updatedMs = new Date(data.updatedAt).getTime();
              }

              // Verify freshness within 6 seconds
              if (updatedMs === 0 || now - updatedMs < 6000) {
                activeTyper = data.userName || 'Teammate';
              }
            }
          });

          setTypingUserInActiveConv(activeTyper);
        },
        () => {
          setTypingUserInActiveConv(null);
        }
      );

      return () => {
        unsub();
        clearUserTyping();
      };
    } catch (e) {
      return () => {};
    }
  }, [selectedConversationId, currentUid, clearUserTyping]);

  // Handle external navigation directly to a contact chat
  useEffect(() => {
    if (chatContactId !== null) {
      handleSelectConversation('dm', chatContactId);
      setChatContactId(null);
    }
  }, [chatContactId]);

  // 2. CONVERSATION SELECTION HANDLER (Requirements 2, 5, 6, 7 & 8)
  const handleSelectConversation = (
    type: 'channel' | 'dm' | 'team' | 'ai',
    targetId: string | number
  ) => {
    // Security check for private leadership channels
    if (type === 'channel' && String(targetId) === 'leadership-private') {
      const isAuthorized = userRoleNorm === 'ROLE_ADMIN' || userRoleNorm === 'ROLE_MANAGER';
      if (!isAuthorized) {
        showToast('Access restricted: Private leadership channel requires Admin or Team Leader privileges.');
        return;
      }
    }

    // Step 1: Synchronously cancel any active listener to isolate previous chat immediately (Requirement 5)
    if (firestoreUnsubscribeRef.current) {
      firestoreUnsubscribeRef.current();
      firestoreUnsubscribeRef.current = null;
    }

    // Step 2: Synchronously purge previous messages state so no messages bleed across users (Requirement 6)
    setMessages([]);
    setIsLoadingMessages(true);
    setShowThreadSearch(false);
    setMessageSearchQuery('');

    // Step 3: Compute deterministic 1-to-1 conversationId (Requirement 2)
    const convId = getConversationId(type, orgId, targetId, currentUid);

    setSelectedConversationType(type);
    setSelectedConversationId(convId);

    if (type === 'channel') {
      setSelectedChannelId(targetId);
      setSelectedTeamId(null);
      setSelectedUserId(null);
    } else if (type === 'team') {
      setSelectedTeamId(targetId);
      setSelectedChannelId(null);
      setSelectedUserId(null);
    } else if (type === 'dm') {
      setSelectedUserId(targetId);
      setSelectedChannelId(null);
      setSelectedTeamId(null);
    } else if (type === 'ai') {
      setSelectedUserId(AI_ASSISTANT_ID);
      setSelectedChannelId(null);
      setSelectedTeamId(null);
    }

    setMobileView('chat');

    // Clear unread count for this user in Firestore conversation doc (Requirement 9)
    setUnreadMap((prev) => {
      const next = { ...prev };
      delete next[convId];
      return next;
    });

    if (firebaseDb) {
      try {
        const myIds = Array.from(new Set([
          String(currentUid || ''),
          String(user?.id || ''),
          String(user?.uid || ''),
          String((user as any)?.firebaseUid || ''),
          String(user?.email || '').toLowerCase()
        ].filter(Boolean)));

        const clearUpdates: Record<string, any> = {};
        myIds.forEach((id) => {
          clearUpdates[`unreadCounts.${id}`] = 0;
        });

        const convRef = doc(firebaseDb, 'conversations', convId);
        updateDoc(convRef, clearUpdates).catch(() => {});
      } catch (e) {}
    }
  };

  // 3. REAL-TIME FIRESTORE MESSAGE LISTENER & SYNC (Requirements 4, 5, 6, 8, 44)
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setIsLoadingMessages(false);
      return;
    }

    setIsLoadingMessages(true);

    // Clean up any existing listener to guarantee ZERO duplicate listeners (Requirement 5 & 44)
    if (firestoreUnsubscribeRef.current) {
      firestoreUnsubscribeRef.current();
      firestoreUnsubscribeRef.current = null;
    }

    // Verify local cache: strictly load ONLY messages matching current selectedConversationId (Requirement 6)
    const localCacheKey = `pms_chat_cache_${orgId}_${selectedConversationId}`;
    try {
      const cached = localStorage.getItem(localCacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const isValid = parsed.every((m: any) => !m.conversationId || m.conversationId === selectedConversationId);
          if (isValid) {
            setMessages(parsed);
          } else {
            // Contaminated cache detected -> purge immediately
            localStorage.removeItem(localCacheKey);
            setMessages([]);
          }
        } else {
          setMessages([]);
        }
      } else {
        if (selectedConversationType === 'ai') {
          const aiInitial: ChatMessage[] = [
            {
              id: 'ai-init-9001',
              conversationId: selectedConversationId,
              organizationId: orgId,
              content: `Hello ${user?.name || 'there'}! I am your Project AI Assistant. How can I assist your team in ${activeOrganization?.organizationName || 'the workspace'} today? You can ask me to summarize tasks, draft sprint goals, or verify documents.`,
              sender: { id: AI_ASSISTANT_ID, name: 'Project AI Assistant', role: 'AI Assistant', profilePhoto: AI_CONTACT.profilePhoto },
              createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
              isRead: true
            }
          ];
          setMessages(aiInitial);
        } else if (selectedConversationType === 'channel' && String(selectedChannelId) === 'general-workspace') {
          const genInitial: ChatMessage[] = [
            {
              id: 'gen-init-8001',
              conversationId: selectedConversationId,
              organizationId: orgId,
              content: 'Welcome to #general-workspace! All organizational updates, sprint milestones, and documents are tracked here.',
              sender: { id: 'admin-1', name: 'System Administrator', role: 'ROLE_ADMIN' },
              createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
              isRead: true
            },
            {
              id: 'gen-init-8002',
              conversationId: selectedConversationId,
              organizationId: orgId,
              content: 'Please review the updated sprint requirements document before standup. Task #101 has been prioritized.',
              sender: { id: 'emp-101', name: 'Rahul Sharma', role: 'ROLE_MANAGER' },
              createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
              fileName: 'Sprint_Planning_Guidelines.pdf',
              fileUrl: '#',
              fileSize: 1420000,
              isRead: true
            }
          ];
          setMessages(genInitial);
        } else {
          setMessages([]);
        }
      }
    } catch (e) {
      setMessages([]);
    }

    // Set up real-time listener strictly scoped to conversationId AND organizationId (ORGANIZATION ISOLATION)
    try {
      if (firebaseDb) {
        const q = query(
          collection(firebaseDb, 'messages'),
          where('conversationId', '==', selectedConversationId),
          where('organizationId', '==', orgId),
          limit(100)
        );

        const unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            setIsLoadingMessages(false);
            if (!snapshot.empty) {
              const unreadDocIdsToMark: string[] = [];
              const seenMsgIds = new Set<string>();

              const loadedMessages: ChatMessage[] = [];

              snapshot.docs.forEach((docSnap) => {
                const data = docSnap.data();

                // STRICT ISOLATION GUARD: Verify conversationId matches exactly
                if (data.conversationId && data.conversationId !== selectedConversationId) {
                  return; // Skip message belonging to another conversation
                }

                // Organization verification guard (Requirement 10)
                if (data.organizationId && orgId && data.organizationId !== orgId) {
                  return; // Skip message from another organization
                }

                if (seenMsgIds.has(docSnap.id)) return;
                seenMsgIds.add(docSnap.id);

                const createdAtRaw = data.createdAt;
                let createdAtStr = new Date().toISOString();
                if (typeof createdAtRaw === 'string') {
                  createdAtStr = createdAtRaw;
                } else if (createdAtRaw && typeof createdAtRaw.toDate === 'function') {
                  createdAtStr = createdAtRaw.toDate().toISOString();
                } else if (createdAtRaw && createdAtRaw.seconds) {
                  createdAtStr = new Date(createdAtRaw.seconds * 1000).toISOString();
                }

                const senderUid = String(data.senderId || '');
                const isMe = senderUid === String(currentUid);
                const readByList: string[] = Array.isArray(data.readBy) ? data.readBy.map(String) : [];
                const isRead = data.isRead === true || (readByList.length > 1 && !readByList.every(id => id === senderUid));

                // Mark received unread message as read by current user (Requirement 9)
                if (!isMe && !readByList.includes(String(currentUid))) {
                  unreadDocIdsToMark.push(docSnap.id);
                }

                loadedMessages.push({
                  id: docSnap.id,
                  messageId: docSnap.id,
                  conversationId: data.conversationId || selectedConversationId,
                  organizationId: data.organizationId || orgId,
                  senderId: senderUid,
                  receiverId: data.receiverId || data.recipientId,
                  recipientId: data.recipientId || data.receiverId,
                  content: data.text || data.content || data.message || '',
                  text: data.text || data.content || data.message || '',
                  status: data.status || 'sent',
                  type: data.type || data.messageType || 'text',
                  messageType: data.messageType || data.type || 'text',
                  sender: {
                    id: senderUid,
                    name: data.senderName || 'Member',
                    profilePhoto: data.senderPhoto,
                    role: data.senderRole
                  },
                  createdAt: createdAtStr,
                  fileUrl: data.fileUrl,
                  fileName: data.fileName,
                  fileType: data.fileType,
                  fileSize: data.fileSize,
                  isRead,
                  isEdited: data.isEdited || false,
                  isDeleted: data.isDeleted || false,
                  replyTo: data.replyTo || null,
                  reactions: data.reactions || {}
                });
              });

              // Mark messages as read in Firestore
              if (unreadDocIdsToMark.length > 0) {
                unreadDocIdsToMark.forEach((id) => {
                  updateDoc(doc(firebaseDb, 'messages', id), {
                    isRead: true,
                    status: 'read',
                    readBy: arrayUnion(String(currentUid)),
                  }).catch(() => {});
                });
                if (selectedConversationId) {
                  const clearPayload: Record<string, any> = {
                    lastMessageIsRead: true,
                    lastMessageStatus: 'read',
                    [`unreadCounts.${currentUid}`]: 0,
                  };
                  if (user?.id) clearPayload[`unreadCounts.${user.id}`] = 0;
                  if (user?.uid) clearPayload[`unreadCounts.${user.uid}`] = 0;
                  updateDoc(doc(firebaseDb, 'conversations', selectedConversationId), clearPayload).catch(() => {});

                  setUnreadMap((prev) => ({
                    ...prev,
                    [selectedConversationId]: 0,
                    ...(selectedUserId ? { [String(selectedUserId)]: 0 } : {}),
                  }));
                  useCommunicationStore.getState().clearUnread(selectedConversationId);
                }
              }

              // Sort ascending by creation time
              loadedMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

              setMessages(loadedMessages);

              try {
                localStorage.setItem(localCacheKey, JSON.stringify(loadedMessages));
              } catch (e) {}
            } else {
              // Empty conversation: immediately set messages to empty and clear cache (Requirement 6)
              setMessages([]);
              try {
                localStorage.removeItem(localCacheKey);
              } catch (e) {}
            }
          },
          (err) => {
            console.warn('Firestore messages subscription notice:', err.message);
            setIsLoadingMessages(false);
          }
        );

        firestoreUnsubscribeRef.current = unsubscribe;
      } else {
        setIsLoadingMessages(false);
      }
    } catch (err) {
      console.warn('Could not establish Firestore listener:', err);
      setIsLoadingMessages(false);
    }

    // Cleanup on conversation change or unmount (Requirement 5 & 44)
    return () => {
      if (firestoreUnsubscribeRef.current) {
        firestoreUnsubscribeRef.current();
        firestoreUnsubscribeRef.current = null;
      }
    };
  }, [selectedConversationId, selectedConversationType, selectedChannelId, orgId, currentUid, user?.name, activeOrganization?.organizationName]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 4. SEND MESSAGE HANDLER WITH FIRESTORE PERSISTENCE (Requirements 3, 7, 8, 10, 13, 14)
  const handleSendMessage = async (content: string, fileAttachment?: { name: string; url: string; size: number }) => {
    if (!content.trim() && !fileAttachment) return;
    if (!selectedConversationId) return;

    // Handle Edit Mode
    if (editingMessage) {
      const editId = String(editingMessage.id);
      setMessages((prev) =>
        prev.map((m) => (String(m.id) === editId ? { ...m, content, text: content, isEdited: true } : m))
      );
      setEditingMessage(null);
      showToast('Message updated');

      if (firebaseDb) {
        try {
          await updateDoc(doc(firebaseDb, 'messages', editId), {
            content,
            text: content,
            message: content,
            isEdited: true,
            updatedAt: serverTimestamp()
          });
        } catch (e) {}
      }
      return;
    }

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const nowIso = new Date().toISOString();

    const targetUserId = selectedConversationType === 'dm' ? String(selectedUserId) : null;
    const participants = selectedConversationType === 'dm' ? [String(currentUid), String(selectedUserId)].sort() : [];

    const msgType = fileAttachment ? (fileAttachment.name.endsWith('.webm') ? 'audio' : 'file') : 'text';
    const fileMime = fileAttachment
      ? (fileAttachment.name.endsWith('.pdf')
          ? 'application/pdf'
          : fileAttachment.name.endsWith('.webm')
          ? 'audio/webm'
          : 'application/octet-stream')
      : null;

    const newMsg: ChatMessage = {
      id: tempId,
      messageId: tempId,
      conversationId: selectedConversationId,
      organizationId: orgId,
      senderId: String(currentUid),
      receiverId: targetUserId || undefined,
      recipientId: targetUserId || undefined,
      content,
      text: content,
      message: content,
      status: (!navigator.onLine || isOffline) ? 'failed' : 'sending',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      type: msgType,
      messageType: msgType,
      sender: {
        id: currentUid as any,
        name: user?.name || 'You',
        profilePhoto: user?.profilePhoto,
        role: user?.role
      },
      createdAt: nowIso,
      fileUrl: fileAttachment?.url,
      fileName: fileAttachment?.name,
      fileType: fileMime || undefined,
      fileSize: fileAttachment?.size,
      isRead: false,
      replyTo: replyToMessage
        ? { id: replyToMessage.id, senderName: replyToMessage.sender.name, content: replyToMessage.content }
        : null
    };

    // Immediate optimistic local update with sending/failed state (Requirements 2, 6, 17)
    setMessages((prev) => {
      const sanitizedPrev = prev.filter(m => !m.conversationId || m.conversationId === selectedConversationId);
      const next = [...sanitizedPrev, newMsg];
      try {
        localStorage.setItem(`pms_chat_cache_${orgId}_${selectedConversationId}`, JSON.stringify(next));
      } catch (e) {}
      return next;
    });

    setReplyToMessage(null);
    clearUserTyping();

    // Play chime sound if enabled in settings
    if (settings.soundEnabled) {
      playChime();
    }

    const convPreview = content || (fileAttachment ? (fileAttachment.name.endsWith('.webm') ? '🎙️ Voice message' : `Attachment: ${fileAttachment.name}`) : 'File shared');

    // Update local metadata immediately so latest conversation moves to top instantly (Requirement 8 & 13)
    setConvMetaMap((prev) => {
      const next = {
        ...prev,
        [selectedConversationId]: {
          lastMessageText: convPreview,
          lastMessageAt: nowIso,
          lastSenderId: String(currentUid),
          lastSenderName: user?.name || 'You',
          lastMessageIsRead: selectedConversationType === 'ai',
          lastMessageStatus: (!navigator.onLine || isOffline) ? 'failed' : 'sending',
        }
      };
      try {
        localStorage.setItem(`pms_conv_meta_${orgId}`, JSON.stringify(next));
      } catch (e) {}
      return next;
    });

    if (!navigator.onLine || isOffline) {
      showToast('Network disconnected. Message queued to retry.');
      return;
    }

    // Save to Firestore (Real-Time Store - Requirements 3, 7, 8, 10, 13, 14)
    try {
      if (firebaseDb) {
        // Save message document with actual 'sent' state and timestamps
        const docRef = await addDoc(collection(firebaseDb, 'messages'), {
          conversationId: selectedConversationId,
          organizationId: orgId,
          senderId: String(currentUid),
          receiverId: targetUserId,
          recipientId: targetUserId,
          senderName: user?.name || 'You',
          senderPhoto: user?.profilePhoto || null,
          senderRole: user?.role || 'ROLE_EMPLOYEE',
          channelId: selectedConversationType === 'channel' ? String(selectedChannelId) : null,
          teamId: selectedConversationType === 'team' ? String(selectedTeamId) : null,
          text: content,
          content,
          message: content,
          status: 'sent',
          sentAt: serverTimestamp(),
          deliveredAt: null,
          readAt: null,
          deliveredTo: [],
          type: msgType,
          messageType: msgType,
          fileName: fileAttachment?.name || null,
          fileUrl: fileAttachment?.url || null,
          fileType: fileMime,
          fileSize: fileAttachment?.size || null,
          replyTo: replyToMessage
            ? { id: replyToMessage.id, senderName: replyToMessage.sender.name, content: replyToMessage.content }
            : null,
          readBy: [String(currentUid)],
          isRead: false,
          isEdited: false,
          isDeleted: false,
          createdAt: nowIso,
          timestamp: serverTimestamp()
        });

        if (docRef?.id) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, id: docRef.id, messageId: docRef.id, status: 'sent', sentAt: nowIso } : m
            )
          );
        }

        const targetIds = Array.from(new Set([
          String(targetUserId || ''),
          String(selectedUserId || ''),
          String(activeContactObj?.id || ''),
          String(activeContactObj?.uid || ''),
          String((activeContactObj as any)?.firebaseUid || '')
        ].filter(Boolean)));

        const unreadUpdates: Record<string, any> = {};
        targetIds.forEach((tid) => {
          unreadUpdates[`unreadCounts.${tid}`] = increment(1);
        });

        // Update conversation metadata document with participants, timestamp, status & unread counters
        await setDoc(doc(firebaseDb, 'conversations', selectedConversationId), {
          id: selectedConversationId,
          conversationId: selectedConversationId,
          organizationId: orgId,
          type: selectedConversationType,
          participants,
          participantUids: participants,
          targetId: selectedConversationType === 'channel' ? String(selectedChannelId) : (selectedConversationType === 'team' ? String(selectedTeamId) : (selectedConversationType === 'dm' ? String(selectedUserId) : 'ai')),
          title: activeChannelObj?.name || activeTeamObj?.name || activeContactObj?.name || 'Conversation',
          lastMessageText: convPreview,
          lastMessage: convPreview,
          lastMessageAt: serverTimestamp(),
          lastMessageAtIso: nowIso,
          lastSenderId: String(currentUid),
          lastSenderName: user?.name || 'You',
          lastMessageIsRead: selectedConversationType === 'ai',
          lastMessageStatus: 'sent',
          ...unreadUpdates,
          updatedAt: serverTimestamp()
        }, { merge: true });

        try {
          await updateDoc(doc(firebaseDb, 'conversations', selectedConversationId), unreadUpdates);
        } catch (e) {}

        // AI Assistant Response Automation (Requirement 1)
        if (selectedConversationType === 'ai') {
          setTimeout(() => {
            const queryLower = content.toLowerCase();
            let aiResponse = "I've reviewed your request against current project deliverables: You have 3 active tasks in sprint tracking. Everything is currently running on schedule!";

            if (queryLower.includes('task') || queryLower.includes('sprint') || queryLower.includes('progress')) {
              aiResponse = "Sprint Analysis: The team has completed 75% of target user stories for the current milestone. Primary blocker: Backend verification API endpoint pending review.";
            } else if (queryLower.includes('document') || queryLower.includes('file') || queryLower.includes('requirement')) {
              aiResponse = "Document Repository Synced: The latest 'Sprint Planning Guidelines.pdf' and 'Architecture Specification' were indexed recently.";
            } else if (queryLower.includes('hi') || queryLower.includes('hello')) {
              aiResponse = `Greetings ${user?.name || 'teammate'}! I am your Project AI Copilot. How can I assist with tasks, team updates, or documents today?`;
            }

            const aiMsg: ChatMessage = {
              id: `ai_${Date.now()}`,
              content: aiResponse,
              sender: {
                id: AI_ASSISTANT_ID,
                name: 'Project AI Assistant',
                role: 'AI Assistant',
                profilePhoto: AI_CONTACT.profilePhoto
              },
              createdAt: new Date().toISOString(),
              isRead: true
            };

            setMessages((prev) => {
              const next = [...prev, aiMsg];
              try {
                localStorage.setItem(`pms_chat_cache_${orgId}_${selectedConversationId}`, JSON.stringify(next));
              } catch (e) {}
              return next;
            });

            if (settings.soundEnabled) {
              playChime();
            }
          }, 700);
        }
      }
    } catch (fireErr) {
      console.warn('Firestore write failed:', fireErr);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
      );
      showToast('Failed to send message. Please tap Retry.');
    }
  };

  // 4b. RETRY SENDING FAILED MESSAGE (Requirement 17: Failed -> Sending -> Sent)
  const handleRetryMessage = async (failedMsg: ChatMessage) => {
    if (!navigator.onLine || isOffline) {
      showToast('Network offline. Reconnect to retry sending.');
      return;
    }

    const failedId = failedMsg.id;
    setMessages((prev) =>
      prev.map((m) => (m.id === failedId ? { ...m, status: 'sending' } : m))
    );

    const nowIso = new Date().toISOString();
    const targetUserId = selectedConversationType === 'dm' ? String(selectedUserId) : null;
    const participants = selectedConversationType === 'dm' ? [String(currentUid), String(selectedUserId)].sort() : [];

    try {
      if (firebaseDb) {
        const docRef = await addDoc(collection(firebaseDb, 'messages'), {
          conversationId: failedMsg.conversationId || selectedConversationId,
          organizationId: failedMsg.organizationId || orgId,
          senderId: String(currentUid),
          receiverId: failedMsg.receiverId || targetUserId,
          recipientId: failedMsg.recipientId || targetUserId,
          senderName: user?.name || 'You',
          senderPhoto: user?.profilePhoto || null,
          senderRole: user?.role || 'ROLE_EMPLOYEE',
          channelId: selectedConversationType === 'channel' ? String(selectedChannelId) : null,
          teamId: selectedConversationType === 'team' ? String(selectedTeamId) : null,
          text: failedMsg.content,
          content: failedMsg.content,
          message: failedMsg.content,
          status: 'sent',
          sentAt: serverTimestamp(),
          deliveredAt: null,
          readAt: null,
          deliveredTo: [],
          type: failedMsg.type || 'text',
          messageType: failedMsg.type || 'text',
          fileName: failedMsg.fileName || null,
          fileUrl: failedMsg.fileUrl || null,
          fileType: failedMsg.fileType || null,
          fileSize: failedMsg.fileSize || null,
          readBy: [String(currentUid)],
          isRead: false,
          isEdited: false,
          isDeleted: false,
          createdAt: nowIso,
          timestamp: serverTimestamp()
        });

        if (docRef?.id) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === failedId
                ? { ...m, id: docRef.id, messageId: docRef.id, status: 'sent', sentAt: nowIso }
                : m
            )
          );

          if (selectedConversationId) {
            await setDoc(doc(firebaseDb, 'conversations', selectedConversationId), {
              id: selectedConversationId,
              conversationId: selectedConversationId,
              organizationId: orgId,
              type: selectedConversationType,
              participants,
              participantUids: participants,
              lastMessageText: failedMsg.content,
              lastMessage: failedMsg.content,
              lastMessageAt: serverTimestamp(),
              lastMessageAtIso: nowIso,
              lastSenderId: String(currentUid),
              lastSenderName: user?.name || 'You',
              lastMessageIsRead: selectedConversationType === 'ai',
              lastMessageStatus: 'sent',
              ...(targetUserId ? { [`unreadCounts.${targetUserId}`]: increment(1) } : {}),
              updatedAt: serverTimestamp()
            }, { merge: true });
          }
        }
      }
    } catch (err) {
      console.warn('Retry send failed:', err);
      setMessages((prev) =>
        prev.map((m) => (m.id === failedId ? { ...m, status: 'failed' } : m))
      );
      showToast('Retry failed. Please check network and try again.');
    }
  };

  // Reactions (Requirement 10: Persist in Firestore)
  const handleToggleReaction = async (msgId: string | number, emoji: string) => {
    const currentUidStr = String(currentUid);
    let nextReactionsMap: Record<string, (string | number)[]> = {};

    setMessages((prev) =>
      prev.map((m) => {
        if (String(m.id) !== String(msgId)) return m;
        const currentReactions = m.reactions || {};
        const userList = (currentReactions[emoji] || []).map(String);
        const hasReacted = userList.includes(currentUidStr);
        const nextUserList: (string | number)[] = hasReacted ? userList.filter((id) => id !== currentUidStr) : [...userList, currentUidStr];
        const nextReactions: Record<string, (string | number)[]> = { ...currentReactions, [emoji]: nextUserList };
        if (nextUserList.length === 0) delete nextReactions[emoji];
        nextReactionsMap = nextReactions;
        return { ...m, reactions: nextReactions };
      })
    );

    if (firebaseDb && typeof msgId === 'string' && !msgId.startsWith('temp_')) {
      try {
        await updateDoc(doc(firebaseDb, 'messages', msgId), {
          reactions: nextReactionsMap
        });
      } catch (e) {}
    }
  };

  // Delete Message with Soft Delete (Requirement 12: "This message was deleted")
  const handleConfirmDeleteMessage = async () => {
    if (!deleteConfirmMsgId) return;
    const msgId = deleteConfirmMsgId;
    setDeleteConfirmMsgId(null);

    // Update in-memory state
    setMessages((prev) =>
      prev.map((m) =>
        String(m.id) === String(msgId)
          ? { ...m, isDeleted: true, content: 'This message was deleted' }
          : m
      )
    );
    showToast('Message deleted');

    if (firebaseDb && typeof msgId === 'string' && !msgId.startsWith('temp_')) {
      try {
        await updateDoc(doc(firebaseDb, 'messages', msgId), {
          isDeleted: true,
          content: 'This message was deleted',
          fileUrl: null,
          fileName: null,
          updatedAt: serverTimestamp()
        });
      } catch (e) {}
    }
  };

  // Clear Chat (Requirement 13)
  const handleClearChat = async () => {
    setMessages([]);
    try {
      localStorage.removeItem(`pms_chat_cache_${orgId}_${selectedConversationId}`);
    } catch (e) {}
    showToast('Chat cleared');
  };

  // Forward Message (Requirement 14)
  const handleForwardMessage = (targetConvType: 'channel' | 'dm' | 'team', targetId: string | number) => {
    const textToForward = forwardModalData.messageText;
    setForwardModalData({ isOpen: false, messageText: '' });
    handleSelectConversation(targetConvType, targetId);
    setTimeout(() => {
      handleSendMessage(`↳ [Forwarded]: ${textToForward}`);
    }, 200);
  };

  // Copy Message Content (Requirement 15)
  const handleCopyMessage = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  };

  // Real WebRTC Call Action
  const initiateCall = useCallStore((s) => s.initiateCall);

  const handleStartCall = (type: 'video' | 'audio') => {
    if (selectedConversationType === 'dm' && selectedUserId) {
      const targetUser = activeContactObj;
      const receiverId = String(targetUser?.uid || targetUser?.id || selectedUserId);
      const receiverName = targetUser?.name || 'Teammate';
      const receiverAvatar = targetUser?.profilePhoto;

      initiateCall({
        receiverId,
        receiverName,
        receiverAvatar,
        callType: type,
      });
    } else {
      showToast('Calls are supported for 1-on-1 direct conversations');
    }
  };

  // Channel Creation
  const handleCreateChannel = async (formData: ChannelFormData) => {
    const chName = formData.name.toLowerCase().replace(/\s+/g, '-');
    const newChan: ChannelItem = {
      id: chName,
      name: chName,
      description: formData.description || 'Project workspace channel',
      isPrivate: formData.isPrivate,
      membersCount: (formData.selectedMembers?.length || 0) + 1
    };

    setChannels((prev) => [...prev, newChan]);
    handleSelectConversation('channel', chName);
    setIsCreateChannelOpen(false);
    showToast(`Channel #${chName} created!`);
  };

  // Retrieve Available Documents (Requirement 25)
  const getAvailableDocuments = () => {
    return [
      { id: 'doc-1', title: 'Product_Roadmap_Q4.pdf', type: 'pdf', size: '1.4 MB' },
      { id: 'doc-2', title: 'System_Architecture_Spec.docx', type: 'docx', size: '820 KB' },
      { id: 'doc-3', title: 'Design_System_Tokens.pdf', type: 'pdf', size: '2.8 MB' },
      { id: 'doc-4', title: 'API_v2_Integration_Specs.json', type: 'json', size: '340 KB' }
    ];
  };

  // Handle Confirm Send Document
  const handleConfirmSendDoc = () => {
    if (!selectedDocToSend) {
      showToast('Please select a document to send');
      return;
    }

    const target = docRecipientType === 'channel'
      ? (docRecipientId || channels[0]?.id || 'general-workspace')
      : (docRecipientId || contacts[1]?.id || 'emp-101');

    handleSelectConversation(docRecipientType, target);
    setTimeout(() => {
      handleSendMessage(`Shared project document: ${selectedDocToSend.title}`, {
        name: selectedDocToSend.title,
        url: '#',
        size: 1400000
      });
    }, 150);

    setIsDocumentPickerOpen(false);
    setSelectedDocToSend(null);
    showToast(`Document "${selectedDocToSend.title}" shared!`);
  };

  // Edit Profile Save (Requirement 32)
  const handleSaveProfile = async () => {
    if (updateProfile) {
      await updateProfile({
        name: editName,
        designation: editDesignation,
        department: editDepartment
      });
    }
    setIsEditProfileModalOpen(false);
    showToast('Profile updated successfully');
  };

  // Active Conversation Objects
  const activeChannelObj = channels.find((c) => String(c.id) === String(selectedChannelId)) || 
    (selectedConversationType === 'channel' && selectedChannelId ? { id: selectedChannelId, name: String(selectedChannelId), description: 'Project Channel', isPrivate: false, membersCount: 5 } : null);

  const activeTeamObj = teams.find((t) => String(t.id) === String(selectedTeamId)) || 
    (selectedConversationType === 'team' && selectedTeamId ? { id: selectedTeamId, name: String(selectedTeamId), description: 'Team Workspace Channel', department: 'Engineering', membersCount: 4 } : null);

  const activeContactObj = contacts.find((c) => String(c.id) === String(selectedUserId) || (c.uid && String(c.uid) === String(selectedUserId))) || 
    (selectedConversationType === 'dm' && selectedUserId ? { id: selectedUserId, uid: String(selectedUserId), name: String(selectedUserId), email: '', role: 'ROLE_EMPLOYEE', isOnline: false, status: 'offline' as const } : null) ||
    (selectedConversationType === 'ai' ? AI_CONTACT : null);

  const hasActiveConversation = Boolean(selectedConversationId && (selectedConversationType === 'ai' || activeChannelObj || activeContactObj || activeTeamObj));

  // Back navigation handler: returns to conversation directory on mobile, or back to dashboard
  const handleBackNavigation = () => {
    if (mobileView === 'chat' && hasActiveConversation) {
      setMobileView('list');
      setSelectedConversationId(null);
    } else if (mobileView === 'chat') {
      setMobileView('list');
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(getDashboardPathForRole(user?.role) || '/');
    }
  };

  // Sync mobile chat open state with document class so MobileBottomNav knows to hide during active chat ONLY
  useEffect(() => {
    if (mobileView === 'chat' && hasActiveConversation) {
      document.body.classList.add('mobile-chat-open');
    } else {
      document.body.classList.remove('mobile-chat-open');
    }
    window.dispatchEvent(new Event('mobile-chat-state-changed'));
    return () => {
      document.body.classList.remove('mobile-chat-open');
      window.dispatchEvent(new Event('mobile-chat-state-changed'));
    };
  }, [mobileView, hasActiveConversation]);

  // On mobile devices, if there is no active conversation selected, automatically ensure mobileView stays 'list'
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768 && mobileView === 'chat' && !hasActiveConversation) {
      setMobileView('list');
    }
  }, [mobileView, hasActiveConversation]);

  const filteredMessages = messages.filter((m) =>
    m.content.toLowerCase().includes(messageSearchQuery.toLowerCase())
  );

  // Helper: Format relative timestamp (Requirement 33: "10:35 AM", "Yesterday", "01 Oct 2026")
  const formatRelativeTime = (dateStr?: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0 && now.getDate() === d.getDate()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays <= 1) {
      return 'Yesterday';
    }
    if (diffDays < 7) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Helper: Format real-time Last Seen timestamp with local timezone (Requirement 9)
  const formatLastSeen = (lastSeenRaw?: any): string => {
    if (!lastSeenRaw) return 'Offline';
    let d: Date;
    if (lastSeenRaw instanceof Date) {
      d = lastSeenRaw;
    } else if (typeof lastSeenRaw?.toDate === 'function') {
      d = lastSeenRaw.toDate();
    } else if (lastSeenRaw?.seconds) {
      d = new Date(lastSeenRaw.seconds * 1000);
    } else if (typeof lastSeenRaw === 'number') {
      d = new Date(lastSeenRaw);
    } else if (typeof lastSeenRaw === 'string') {
      d = new Date(lastSeenRaw);
    } else {
      return 'Offline';
    }

    if (isNaN(d.getTime())) return 'Offline';

    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - d.getTime()) / (1000 * 60));

    // If within last 2 minutes
    if (diffMinutes < 2) {
      return 'Last seen recently';
    }

    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) {
      return `Last seen today at ${timeStr}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) {
      return `Last seen yesterday at ${timeStr}`;
    }

    const monthDayStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Last seen ${monthDayStr}, ${timeStr}`;
  };

  // Render message body with interactive clickable Task references
  const renderMessageBody = (content: string) => {
    if (!content) return null;
    const taskRegex = /(?:(?:Task|task)\s*#|#)(\d+)/g;
    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = taskRegex.exec(content)) !== null) {
      const matchIndex = match.index;
      const matchLength = match[0].length;
      const taskId = match[1];

      if (matchIndex > lastIndex) {
        parts.push(content.slice(lastIndex, matchIndex));
      }

      parts.push(
        <button
          key={`task-ref-${taskId}-${matchIndex}`}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent('open-task-detail', {
                detail: { id: Number(taskId), title: `Task #${taskId}` }
              })
            );
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-bold text-xs underline decoration-dotted cursor-pointer transition-colors mx-0.5"
          title={`Click to open Task #${taskId} details`}
        >
          <span>Task #{taskId}</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      );

      lastIndex = matchIndex + matchLength;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  };

  // Unified Conversation Item Definition
  interface UnifiedConvItem {
    convId: string;
    type: 'channel' | 'team' | 'dm' | 'ai';
    targetId: string | number;
    name: string;
    description?: string;
    avatar?: string;
    isOnline?: boolean;
    status?: 'online' | 'away' | 'busy' | 'offline';
    lastSeen?: any;
    isPrivate?: boolean;
    membersCount?: number;
    department?: string;
    role?: string;
    lastTime: number;
    formattedTime: string;
    previewText: string;
    unreadCount: number;
    isLastMe: boolean;
    isLastRead: boolean;
    lastMessageStatus?: string;
  }

  // Combine Channels, Teams, Contacts, and AI Assistant
  const allConversations: UnifiedConvItem[] = useMemo(() => {
    const list: UnifiedConvItem[] = [];

    // 1. AI Assistant
    const aiConvId = getConversationId('ai', orgId, AI_ASSISTANT_ID, currentUid);
    const aiMeta = convMetaMap[aiConvId];
    const aiLastTime = aiMeta?.lastMessageAt ? new Date(aiMeta.lastMessageAt).getTime() : Date.now() - 3600000;
    list.push({
      convId: aiConvId,
      type: 'ai',
      targetId: AI_ASSISTANT_ID,
      name: AI_CONTACT.name,
      description: 'Workspace Copilot',
      avatar: AI_CONTACT.profilePhoto,
      isOnline: true,
      status: 'online',
      lastTime: aiLastTime,
      formattedTime: formatRelativeTime(aiMeta?.lastMessageAt),
      previewText: aiMeta?.lastMessageText || 'Ask about sprint tasks, documents, or team updates',
      unreadCount: unreadMap[aiConvId] || 0,
      isLastMe: String(aiMeta?.lastSenderId) === String(currentUid),
      isLastRead: true,
      lastMessageStatus: 'read'
    });

    // 2. Channels
    channels.forEach((ch) => {
      const convId = getConversationId('channel', orgId, ch.id, currentUid);
      const meta = convMetaMap[convId];
      const lastTime = meta?.lastMessageAt ? new Date(meta.lastMessageAt).getTime() : 1000;
      list.push({
        convId,
        type: 'channel',
        targetId: ch.id,
        name: ch.name,
        description: ch.description,
        isPrivate: ch.isPrivate,
        membersCount: ch.membersCount,
        lastTime,
        formattedTime: formatRelativeTime(meta?.lastMessageAt),
        previewText: meta?.lastMessageText || ch.description || 'Public channel',
        unreadCount: unreadMap[convId] || 0,
        isLastMe: String(meta?.lastSenderId) === String(currentUid),
        isLastRead: Boolean(meta?.lastMessageIsRead),
        lastMessageStatus: meta?.lastMessageStatus || (meta?.lastMessageIsRead ? 'read' : 'sent')
      });
    });

    // 3. Teams (Requirement 28: Team Chat)
    teams.forEach((t) => {
      const convId = getConversationId('team', orgId, t.id, currentUid);
      const meta = convMetaMap[convId];
      const lastTime = meta?.lastMessageAt ? new Date(meta.lastMessageAt).getTime() : 1000;
      list.push({
        convId,
        type: 'team',
        targetId: t.id,
        name: t.name,
        description: t.description,
        department: t.department,
        membersCount: t.membersCount,
        lastTime,
        formattedTime: formatRelativeTime(meta?.lastMessageAt),
        previewText: meta?.lastMessageText || t.description || 'Team channel',
        unreadCount: unreadMap[convId] || 0,
        isLastMe: String(meta?.lastSenderId) === String(currentUid),
        isLastRead: Boolean(meta?.lastMessageIsRead),
        lastMessageStatus: meta?.lastMessageStatus || (meta?.lastMessageIsRead ? 'read' : 'sent')
      });
    });

    // 4. Contacts (Direct Messages - Requirement 2)
    contacts.filter((c) => c.id !== AI_ASSISTANT_ID).forEach((c) => {
      const contactUid = String(c.uid || c.id);
      const convId = getConversationId('dm', orgId, contactUid, currentUid);
      const meta = convMetaMap[convId];
      const lastTime = meta?.lastMessageAt ? new Date(meta.lastMessageAt).getTime() : 1000;
      list.push({
        convId,
        type: 'dm',
        targetId: contactUid,
        name: c.name,
        avatar: c.profilePhoto,
        isOnline: Boolean(c.isOnline),
        status: c.status || (c.isOnline ? 'online' : 'offline'),
        lastSeen: c.lastSeen,
        role: c.role,
        department: c.department,
        lastTime,
        formattedTime: formatRelativeTime(meta?.lastMessageAt),
        previewText: meta?.lastMessageText || formatRoleName(c.role, 'title') || c.designation || 'Workspace Member',
        unreadCount: unreadMap[convId] || unreadMap[contactUid] || unreadMap[String(c.id)] || unreadMap[String(c.uid)] || unreadMap[String((c as any).firebaseUid || '')] || unreadMap[String(c.email || '').toLowerCase()] || 0,
        isLastMe: String(meta?.lastSenderId) === String(currentUid),
        isLastRead: Boolean(meta?.lastMessageIsRead),
        lastMessageStatus: meta?.lastMessageStatus || (meta?.lastMessageIsRead ? 'read' : 'sent')
      });
    });

    return list;
  }, [channels, teams, contacts, convMetaMap, unreadMap, orgId, currentUid]);

  // Sort by latest conversation activity (Requirement 3: Most recent chat moves to top)
  const unifiedSortedList = useMemo(() => {
    return [...allConversations]
      .filter((item) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q)) ||
          (item.previewText && item.previewText.toLowerCase().includes(q)) ||
          (item.role && item.role.toLowerCase().includes(q))
        );
      })
      .filter((item) => {
        if (chatFilter === 'unread') return item.unreadCount > 0;
        if (chatFilter === 'channels') return item.type === 'channel';
        if (chatFilter === 'teams') return item.type === 'team';
        if (chatFilter === 'dms') return item.type === 'dm' || item.type === 'ai';
        return true;
      })
      .sort((a, b) => b.lastTime - a.lastTime);
  }, [allConversations, searchQuery, chatFilter]);

  // Unread counts
  const totalUnreadCount = Object.values(unreadMap).reduce((a, b) => a + b, 0);

  const dmUnreadCount = useMemo(() => {
    return allConversations.filter((i) => i.type === 'dm' || i.type === 'ai').reduce((sum, i) => sum + i.unreadCount, 0);
  }, [allConversations]);

  const teamUnreadCount = useMemo(() => {
    return allConversations.filter((i) => i.type === 'team').reduce((sum, i) => sum + i.unreadCount, 0);
  }, [allConversations]);

  const channelUnreadCount = useMemo(() => {
    return allConversations.filter((i) => i.type === 'channel').reduce((sum, i) => sum + i.unreadCount, 0);
  }, [allConversations]);

  return (
    <div className="h-full w-full flex bg-[#111b21] text-[#e9edef] rounded-none sm:rounded-2xl border-0 sm:border border-[#202c33] overflow-hidden relative shadow-2xl select-none font-sans overscroll-none">
      
      {/* Offline Alert Banner (Requirement 39) */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 bg-amber-600/90 text-white rounded-full text-xs font-bold shadow-xl flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4" />
            <span>You're offline. Messages will synchronize upon reconnection.</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* ZONE 1: SLIM LEFT VERTICAL ICON RAIL (~56px - 64px)                       */}
      {/* ========================================================================= */}
      <aside className="hidden md:flex w-14 sm:w-16 bg-[#202c33] border-r border-[#2a3942] flex-col items-center justify-between py-3.5 shrink-0 z-30 h-full select-none">
        
        {/* Top: Primary Navigation Icons */}
        <div className="flex flex-col items-center gap-3 w-full">
          <button
            onClick={() => {
              setSelectedConversationId(null);
              setSelectedConversationType(null);
              setSelectedChannelId(null);
              setSelectedUserId(null);
              setMobileView('list');
            }}
            className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/20 hover:scale-105 active:scale-95 transition-all mb-1 cursor-pointer"
            title="Project Communication Hub"
          >
            <Layers className="w-5 h-5 text-white" />
          </button>

          <div className="w-7 h-px bg-[#2a3942] mb-1" />

          {/* Direct Messages Icon */}
          <button
            onClick={() => {
              setNavRailTab('chats');
              setChatFilter('dms');
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center relative transition-all cursor-pointer ${
              navRailTab === 'chats'
                ? 'bg-[#2a3942] text-blue-400'
                : 'text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#2a3942]/60'
            }`}
            title="Direct Messages"
          >
            <MessageSquare className="w-5 h-5" />
            {dmUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-blue-600 text-white text-[9px] font-black rounded-full shadow-xs">
                {dmUnreadCount}
              </span>
            )}
          </button>

          {/* Team Chats Icon (Requirement 28) */}
          <button
            onClick={() => {
              setNavRailTab('teams');
              setChatFilter('teams');
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center relative transition-all cursor-pointer ${
              navRailTab === 'teams'
                ? 'bg-[#2a3942] text-blue-400'
                : 'text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#2a3942]/60'
            }`}
            title="Team Chats (Departments & Teams)"
          >
            <Users className="w-5 h-5" />
            {teamUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-blue-600 text-white text-[9px] font-black rounded-full shadow-xs">
                {teamUnreadCount}
              </span>
            )}
          </button>

          {/* Team & Project Channels Icon (Requirement 29) */}
          <button
            onClick={() => {
              setNavRailTab('channels');
              setChatFilter('channels');
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center relative transition-all cursor-pointer ${
              navRailTab === 'channels'
                ? 'bg-[#2a3942] text-blue-400'
                : 'text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#2a3942]/60'
            }`}
            title="Team & Project Channels"
          >
            <Hash className="w-5 h-5" />
            {channelUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-blue-600 text-white text-[9px] font-black rounded-full shadow-xs">
                {channelUnreadCount}
              </span>
            )}
          </button>

          {/* AI Assistant Icon */}
          <button
            onClick={() => handleSelectConversation('ai', AI_ASSISTANT_ID)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              selectedConversationType === 'ai'
                ? 'bg-[#2a3942] text-purple-400'
                : 'text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#2a3942]/60'
            }`}
            title="Project AI Assistant"
          >
            <Sparkles className="w-5 h-5 text-purple-400" />
          </button>
        </div>

        {/* Bottom Rail Icons: Starred, Settings, Profile */}
        <div className="flex flex-col items-center gap-3 w-full">
          {/* Settings Button (Requirement 26) */}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[#8696a0] hover:text-blue-400 hover:bg-[#2a3942]/60 transition-all cursor-pointer"
            title="Communication Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* User Profile Avatar with Online Status Indicator (Requirement 20, 32) */}
          <div className="relative">
            <button
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="relative pt-1 cursor-pointer focus:outline-none"
              title="Your Profile & Status"
            >
              <img
                src={resolveAvatar(user?.profilePhoto, user?.name || 'You', (user as any)?.gender)}
                alt="avatar"
                className="w-9 h-9 rounded-full object-cover ring-2 ring-blue-500/40 hover:ring-blue-500 transition-all"
              />
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#202c33] ${
                  userStatus === 'online'
                    ? 'bg-emerald-500'
                    : userStatus === 'away'
                    ? 'bg-amber-400'
                    : userStatus === 'busy'
                    ? 'bg-rose-500'
                    : 'bg-slate-400'
                }`}
              />
            </button>

            {/* Profile Popup Menu */}
            <AnimatePresence>
              {isProfileMenuOpen && user && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setIsProfileMenuOpen(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95, x: -10 }}
                    className="absolute left-full ml-3.5 bottom-0 w-64 max-w-[calc(100vw-5rem)] bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl p-2 z-50 text-xs font-semibold"
                  >
                    <div className="p-2 border-b border-[#2a3942] flex items-center gap-2.5 mb-1">
                      <img
                        src={resolveAvatar(user.profilePhoto, user.name, user.gender)}
                        alt="avatar"
                        className="w-10 h-10 rounded-full object-cover ring-2 ring-blue-500"
                      />
                      <div className="truncate">
                        <p className="font-bold text-sm text-[#e9edef] truncate">{user.name}</p>
                        <p className="text-[11px] text-[#8696a0] truncate">{user.email}</p>
                        <p className="text-[10px] text-blue-400 uppercase font-bold tracking-wider">
                          {formatRoleName(user.role)} • {activeOrganization?.organizationName || 'Workspace'}
                        </p>
                      </div>
                    </div>

                    {/* Status Switcher (Requirement 20) */}
                    <div className="py-1 border-b border-[#2a3942]">
                      <span className="text-[10px] font-bold text-[#8696a0] uppercase px-2 tracking-wider">
                        Availability Status
                      </span>
                      <div className="grid grid-cols-2 gap-1 mt-1 px-1">
                        <button
                          onClick={() => {
                            setUserStatus('online');
                            setIsProfileMenuOpen(false);
                            showToast('Status set to Online');
                          }}
                          className={`px-2 py-1 rounded-lg flex items-center gap-1.5 text-[11px] ${
                            userStatus === 'online' ? 'bg-blue-500/20 text-blue-400 font-bold' : 'hover:bg-[#2a3942]'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Online</span>
                        </button>
                        <button
                          onClick={() => {
                            setUserStatus('away');
                            setIsProfileMenuOpen(false);
                            showToast('Status set to Away');
                          }}
                          className={`px-2 py-1 rounded-lg flex items-center gap-1.5 text-[11px] ${
                            userStatus === 'away' ? 'bg-amber-500/20 text-amber-400 font-bold' : 'hover:bg-[#2a3942]'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                          <span>Away</span>
                        </button>
                        <button
                          onClick={() => {
                            setUserStatus('busy');
                            setIsProfileMenuOpen(false);
                            showToast('Status set to Busy / DND');
                          }}
                          className={`px-2 py-1 rounded-lg flex items-center gap-1.5 text-[11px] ${
                            userStatus === 'busy' ? 'bg-rose-500/20 text-rose-400 font-bold' : 'hover:bg-[#2a3942]'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-rose-500" />
                          <span>Busy</span>
                        </button>
                        <button
                          onClick={() => {
                            setUserStatus('offline');
                            setIsProfileMenuOpen(false);
                            showToast('Status set to Offline');
                          }}
                          className={`px-2 py-1 rounded-lg flex items-center gap-1.5 text-[11px] ${
                            userStatus === 'offline' ? 'bg-slate-500/20 text-slate-300 font-bold' : 'hover:bg-[#2a3942]'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-slate-400" />
                          <span>Offline</span>
                        </button>
                      </div>
                    </div>

                    <div className="pt-1 space-y-0.5">
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          setIsViewProfileModalOpen(true);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg hover:bg-[#2a3942] text-left flex items-center gap-2 text-[#d1d7db]"
                      >
                        <User className="w-4 h-4 text-blue-400" />
                        <span>View Profile</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          setEditName(user.name || '');
                          setEditDesignation(user.designation || '');
                          setEditDepartment(user.department || '');
                          setIsEditProfileModalOpen(true);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg hover:bg-[#2a3942] text-left flex items-center gap-2 text-[#d1d7db]"
                      >
                        <Edit2 className="w-4 h-4 text-blue-400" />
                        <span>Edit Profile</span>
                      </button>
                      <div className="w-full h-px bg-[#2a3942] my-1" />
                      <button
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          if (firebaseDb && currentUid && currentUid !== 'unknown-user') {
                            setDoc(doc(firebaseDb, 'users', currentUid), {
                              isOnline: false,
                              status: 'offline',
                              lastSeen: serverTimestamp(),
                            }, { merge: true }).catch(() => {}).finally(() => logout());
                          } else {
                            logout();
                          }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg hover:bg-rose-500/20 text-left flex items-center gap-2 text-rose-400"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Logout</span>
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* ZONE 2: CHATS DIRECTORY PANEL (~340px - 380px)                            */}
      {/* ========================================================================= */}
      <div
        className={`${
          mobileView === 'chat' ? 'hidden md:flex' : 'flex'
        } w-full md:w-[340px] lg:w-[380px] border-r border-[#2a3942] bg-[#111b21] flex-col shrink-0 z-10 transition-all duration-200 h-full overflow-hidden relative`}
      >
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          
          {/* Mobile Chat Header (md:hidden) */}
          <div className="md:hidden px-4 pt-3.5 pb-2.5 bg-[#111b21] border-b border-[#202c33]/80 flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBackNavigation}
                className="p-1.5 -ml-2 rounded-full hover:bg-[#202c33] text-[#8696a0] hover:text-[#e9edef] transition-colors cursor-pointer flex items-center justify-center"
                title="Back to Dashboard"
              >
                <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
              </button>
              <h1 className="text-xl font-bold text-[#e9edef] tracking-tight">
                Chat
              </h1>
            </div>
            <div className="flex items-center gap-1.5 text-[#e9edef]">
              <button
                type="button"
                onClick={() => {
                  if (chatFilter === 'channels') {
                    setIsCreateChannelOpen(true);
                  } else {
                    setIsAddContactModalOpen(true);
                  }
                }}
                className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                title={chatFilter === 'channels' ? 'New Channel' : 'New Direct Message'}
              >
                <Plus className="w-5 h-5 font-black stroke-[3]" />
              </button>
              <button
                type="button"
                onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)}
                className="p-1.5 rounded-full hover:bg-[#202c33] text-[#8696a0] hover:text-[#e9edef] transition-colors cursor-pointer"
                title="More options"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Desktop Header (hidden md:flex) */}
          <div className="hidden md:flex p-3.5 sm:p-4 border-b border-[#202c33] bg-[#202c33] items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-xl text-[#e9edef] tracking-tight">
                {chatFilter === 'channels'
                  ? 'Team Channels'
                  : chatFilter === 'teams'
                  ? 'Team Chats'
                  : chatFilter === 'unread'
                  ? 'Unread Messages'
                  : chatFilter === 'dms'
                  ? 'Direct Messages'
                  : 'All Messages'}
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-[#111b21] border border-[#2a3942] text-[11px] font-bold text-[#8696a0]">
                {unifiedSortedList.length}
              </span>
            </div>
            
            {/* Desktop Header Action Buttons */}
            <div className="flex items-center gap-1.5 relative">
              <button
                onClick={() => {
                  if (chatFilter === 'channels') {
                    setIsCreateChannelOpen(true);
                  } else {
                    setIsAddContactModalOpen(true);
                  }
                }}
                className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                title={chatFilter === 'channels' ? 'New Channel' : 'New Direct Message'}
              >
                <Plus className="w-5 h-5 font-black stroke-[3]" />
              </button>

              <button
                onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)}
                className="p-1.5 rounded-full hover:bg-[#2a3942] text-[#aebac1] hover:text-white transition-colors cursor-pointer"
                title="Options"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Header Dropdown Menu (Shared by both Mobile and Desktop) */}
          <AnimatePresence>
            {isHeaderMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsHeaderMenuOpen(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute right-3 top-13 w-52 bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl py-1.5 z-50 text-xs font-semibold"
                >
                  <button
                    onClick={() => {
                      setIsAddContactModalOpen(true);
                      setIsHeaderMenuOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#2a3942] flex items-center gap-2.5 text-[#d1d7db] cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 text-blue-400" />
                    <span>New chat</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsCreateChannelOpen(true);
                      setIsHeaderMenuOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#2a3942] flex items-center gap-2.5 text-[#d1d7db] cursor-pointer"
                  >
                    <Hash className="w-4 h-4 text-blue-400" />
                    <span>New group channel</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsDocumentPickerOpen(true);
                      setIsHeaderMenuOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#2a3942] flex items-center gap-2.5 text-[#d1d7db] cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-blue-400" />
                    <span>Shared files</span>
                  </button>
                  <div className="w-full h-px bg-[#2a3942] my-1" />
                  <button
                    onClick={() => {
                      setIsSettingsModalOpen(true);
                      setIsHeaderMenuOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#2a3942] flex items-center gap-2.5 text-[#8696a0] hover:text-[#d1d7db] cursor-pointer"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Settings</span>
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Search Input */}
          <div className="px-3 py-2 bg-[#111b21] shrink-0">
            <div className="relative flex items-center bg-[#202c33] rounded-full px-4 py-2 focus-within:ring-1 focus-within:ring-blue-500/50">
              <Search className="w-4 h-4 text-[#8696a0] mr-2.5 shrink-0" />
              <input
                type="text"
                placeholder="Search chats, contacts, or channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-xs font-normal outline-none text-[#e9edef] placeholder:text-[#8696a0]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-[#8696a0] hover:text-white cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Filter Chips Bar */}
          <div className="px-3 pb-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 border-b border-[#202c33]/80">
            {[
              { id: 'all', label: 'All', count: 0 },
              { id: 'unread', label: 'Unread', count: totalUnreadCount },
              { id: 'dms', label: 'Direct', count: dmUnreadCount },
              { id: 'teams', label: 'Groups', count: teamUnreadCount },
              { id: 'channels', label: 'Channels', count: channelUnreadCount },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setChatFilter(f.id as any);
                  if (f.id === 'dms') setNavRailTab('chats');
                  if (f.id === 'teams') setNavRailTab('teams');
                  if (f.id === 'channels') setNavRailTab('channels');
                }}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                  chatFilter === f.id
                    ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/25 border border-blue-400/30'
                    : 'bg-[#202c33] text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#2a3942]'
                }`}
              >
                <span>{f.label}</span>
                {f.count > 0 && (
                  <span className={`text-[11px] font-black ${chatFilter === f.id ? 'text-white' : 'text-[#8696a0]'}`}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Dynamic Scrollable Conversation List */}
          <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-[#202c33]/60 custom-scroll-area pb-24">
            {unifiedSortedList.map((item) => {
              const isSelected = selectedConversationId === item.convId;

              return (
                <button
                  key={item.convId}
                  onClick={() => handleSelectConversation(item.type, item.targetId)}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-all cursor-pointer ${
                    isSelected ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    {item.type === 'ai' ? (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500 flex items-center justify-center shadow-md">
                        <Sparkles className="w-6 h-6 text-white" />
                      </div>
                    ) : item.type === 'channel' ? (
                      <div className="w-12 h-12 rounded-full bg-[#1e293b] border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                        {item.isPrivate ? <Lock className="w-5 h-5 text-amber-400" /> : <Hash className="w-6 h-6" />}
                      </div>
                    ) : item.type === 'team' ? (
                      <div className="w-12 h-12 rounded-full bg-[#1e293b] border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5" />
                      </div>
                    ) : (
                      <img
                        src={resolveAvatar(item.avatar, item.name)}
                        alt={item.name}
                        className="w-12 h-12 rounded-full object-cover ring-1 ring-[#2a3942]"
                      />
                    )}
                    {item.type === 'dm' && (
                      <span
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#111b21] ${
                          item.status === 'busy'
                            ? 'bg-rose-500'
                            : item.status === 'away'
                            ? 'bg-amber-400'
                            : item.isOnline
                            ? 'bg-emerald-500'
                            : 'bg-[#8696a0]'
                        }`}
                      />
                    )}
                    {item.type === 'ai' && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#111b21]" />
                    )}
                  </div>

                  {/* Conversation Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-bold text-sm text-[#e9edef] truncate flex items-center gap-1.5">
                        {item.type === 'channel' && <span className="text-blue-400">#</span>}
                        <span>{item.name}</span>
                        {item.type === 'ai' && (
                          <span className="px-1.5 py-0.2 bg-purple-500/20 text-purple-300 text-[9px] font-black rounded-sm uppercase tracking-wider">
                            AI
                          </span>
                        )}
                        {item.type === 'team' && (
                          <span className="px-1.5 py-0.2 bg-blue-500/20 text-blue-300 text-[9px] font-black rounded-sm uppercase tracking-wider">
                            Team
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-[#8696a0] shrink-0 font-medium">
                        {item.formattedTime || (item.type === 'ai' ? 'Live' : '')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className={`text-xs truncate flex items-center gap-1 ${item.unreadCount > 0 ? 'text-white font-medium' : 'text-[#8696a0]'}`}>
                        {item.isLastMe && (
                          <MessageStatus
                            status={item.lastMessageStatus}
                            isRead={item.isLastRead}
                            isMe={true}
                            showFailedAction={false}
                            className="shrink-0"
                          />
                        )}
                        <span className="truncate">{item.previewText}</span>
                      </p>
                      {item.unreadCount > 0 && (
                        <span className="ml-2 min-w-[20px] h-5 px-1.5 bg-emerald-500 text-white text-[11px] font-black rounded-full flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                          {item.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {unifiedSortedList.length === 0 && (
              <div className="p-8 text-center text-[#8696a0] space-y-2">
                <Search className="w-8 h-8 mx-auto opacity-40 mb-2" />
                <p className="text-xs font-bold text-[#d1d7db]">
                  {searchQuery ? `No results matching "${searchQuery}"` : 'No conversations found'}
                </p>
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-2 px-3 py-1 bg-[#202c33] hover:bg-[#2a3942] rounded-lg text-xs font-semibold text-blue-400 cursor-pointer"
                  >
                    Clear search
                  </button>
                ) : (
                  <button
                    onClick={() => setIsAddContactModalOpen(true)}
                    className="mt-2 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 shadow-md shadow-blue-500/25"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Start Direct Message</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Floating Action Button */}
          <button
            onClick={() => {
              if (chatFilter === 'channels') {
                setIsCreateChannelOpen(true);
              } else {
                setIsAddContactModalOpen(true);
              }
            }}
            className="md:hidden absolute bottom-22 right-4 w-13 h-13 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-[0_8px_25px_rgba(59,130,246,0.45)] flex items-center justify-center cursor-pointer transition-transform active:scale-95 z-30"
            title="New Chat"
          >
            <MessageSquarePlus className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ZONE 3: MAIN CANVAS (EMPTY STATE vs ACTIVE CHAT)                          */}
      {/* ========================================================================= */}
      <div
        className={`${
          mobileView === 'chat' ? 'flex' : 'hidden md:flex'
        } flex-1 min-w-0 flex-col justify-between overflow-hidden bg-[#0b141a] relative h-full`}
      >
        {!hasActiveConversation ? (
          /* EMPTY STATE SCREEN */
          <div className="h-full w-full flex flex-col items-center justify-center p-6 sm:p-10 text-center bg-[#111b21] relative select-none">
            {/* Top Navigation Bar with Back Button */}
            <div className="absolute top-0 left-0 right-0 p-3.5 flex items-center justify-between z-20">
              <button
                type="button"
                onClick={handleBackNavigation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#202c33]/90 hover:bg-[#2a3942] border border-[#2a3942] text-[#d1d7db] hover:text-blue-400 text-xs font-semibold shadow-md transition-all active:scale-95 cursor-pointer"
                title="Back"
              >
                <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
                <span>Back</span>
              </button>
            </div>

            <div className="mb-6 relative">
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-blue-600/20 via-[#202c33] to-indigo-600/30 border-2 border-blue-500/40 flex items-center justify-center shadow-2xl shadow-blue-500/20">
                <div className="w-16 h-16 rounded-full bg-[#202c33] flex items-center justify-center shadow-inner">
                  <MessageSquare className="w-8 h-8 text-blue-400" />
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/30">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-[#e9edef] tracking-tight mb-2">
              Project System Communication
            </h1>
            <p className="text-xs sm:text-sm text-[#8696a0] max-w-lg leading-relaxed mb-8">
              Select an employee or project channel from the directory to start messaging. Send project files, collaborate with teammates, or consult the AI Assistant.
            </p>

            <div className="grid grid-cols-3 gap-6 sm:gap-10 max-w-md w-full mb-12">
              <button
                onClick={() => setIsDocumentPickerOpen(true)}
                className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#202c33] group-hover:bg-[#2a3942] border border-blue-500/40 text-blue-400 flex items-center justify-center shadow-lg transition-all duration-200 group-hover:scale-110 active:scale-95">
                  <FileText className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>
                <div className="text-center">
                  <span className="block text-xs sm:text-sm font-semibold text-[#e9edef] group-hover:text-blue-400 transition-colors">
                    Send document
                  </span>
                  <span className="text-[10px] text-[#8696a0]">Share workspace files</span>
                </div>
              </button>

              <button
                onClick={() => setIsAddContactModalOpen(true)}
                className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#202c33] group-hover:bg-[#2a3942] border border-blue-500/40 text-blue-400 flex items-center justify-center shadow-lg transition-all duration-200 group-hover:scale-110 active:scale-95">
                  <UserPlus className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>
                <div className="text-center">
                  <span className="block text-xs sm:text-sm font-semibold text-[#e9edef] group-hover:text-blue-400 transition-colors">
                    Add contact
                  </span>
                  <span className="text-[10px] text-[#8696a0]">Start direct message</span>
                </div>
              </button>

              <button
                onClick={() => handleSelectConversation('ai', AI_ASSISTANT_ID)}
                className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#202c33] group-hover:bg-[#2a3942] border border-purple-500/40 text-purple-400 flex items-center justify-center shadow-lg transition-all duration-200 group-hover:scale-110 active:scale-95">
                  <Sparkles className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>
                <div className="text-center">
                  <span className="block text-xs sm:text-sm font-semibold text-[#e9edef] group-hover:text-purple-400 transition-colors">
                    Ask AI Assistant
                  </span>
                  <span className="text-[10px] text-[#8696a0]">Project queries & tips</span>
                </div>
              </button>
            </div>

            {/* Mobile Button: View Conversations List */}
            <button
              type="button"
              onClick={() => setMobileView('list')}
              className="md:hidden -mt-4 mb-8 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-500/25 transition-all active:scale-95 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
              <span>Back to Conversations List</span>
            </button>

            <div className="absolute bottom-6 flex items-center gap-1.5 text-xs text-[#8696a0]">
              <Lock className="w-3.5 h-3.5 text-blue-400" />
              <span>Multi-tenant organization security active • {activeOrganization?.organizationName || 'PMS'}</span>
            </div>
          </div>
        ) : (
          /* ACTIVE CHAT SCREEN */
          <>
            {/* Active Chat Header */}
            <div className="h-15 border-b border-[#2a3942] px-4 sm:px-5 flex items-center justify-between shrink-0 bg-[#202c33] z-10">
              <div className="flex items-center gap-3 min-w-0">
                {/* Mobile Back Button */}
                <button
                  onClick={() => {
                    setMobileView('list');
                    setSelectedConversationId(null);
                  }}
                  className="p-1 -ml-1 text-[#d1d7db] hover:text-blue-400 md:hidden cursor-pointer"
                  title="Back to conversations"
                >
                  <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
                </button>

                {/* Avatar and Channel/Team/Contact Details (Click to open conversation details) */}
                <div 
                  onClick={toggleDetailsPanel}
                  className="cursor-pointer group flex items-center gap-3 min-w-0 select-none"
                  title="View conversation info"
                >
                  {selectedConversationType === 'channel' ? (
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-[#1e293b] border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        {activeChannelObj?.isPrivate ? <Lock className="w-5 h-5 text-amber-400" /> : <Hash className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#e9edef] group-hover:text-blue-400 transition-colors truncate">
                          #{activeChannelObj?.name || 'channel'}
                        </h3>
                        <p className="text-[11px] text-[#8696a0] truncate">
                          {activeChannelObj?.description || `${activeChannelObj?.membersCount || 6} members`}
                        </p>
                      </div>
                    </div>
                  ) : selectedConversationType === 'team' ? (
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-[#1e293b] border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#e9edef] group-hover:text-blue-400 transition-colors truncate flex items-center gap-2">
                          <span>{activeTeamObj?.name || 'Team Workspace'}</span>
                          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                            {activeTeamObj?.department || 'Team'}
                          </span>
                        </h3>
                        <p className="text-[11px] text-[#8696a0] truncate">
                          {activeTeamObj?.description || `${activeTeamObj?.membersCount || 4} team members`}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0 group-hover:scale-105 transition-transform">
                        <img
                          src={resolveAvatar(activeContactObj?.profilePhoto, activeContactObj?.name || 'Contact', (activeContactObj as any)?.gender)}
                          alt="avatar"
                          className="w-10 h-10 rounded-full object-cover ring-1 ring-[#2a3942]"
                        />
                        <span
                          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#202c33] ${
                            activeContactObj?.id === AI_ASSISTANT_ID
                              ? 'bg-purple-500'
                              : (activeContactObj as any)?.status === 'busy'
                              ? 'bg-rose-500'
                              : (activeContactObj as any)?.status === 'away'
                              ? 'bg-amber-400'
                              : activeContactObj?.isOnline
                              ? 'bg-emerald-500'
                              : 'bg-[#8696a0]'
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#e9edef] group-hover:text-blue-400 transition-colors truncate">
                          {activeContactObj?.name || 'Teammate'}
                        </h3>
                        <div className="text-[11px] truncate flex items-center gap-1.5">
                          {activeContactObj?.id === AI_ASSISTANT_ID ? (
                            <span className="text-purple-400 font-medium">AI Copilot Active</span>
                          ) : typingUserInActiveConv ? (
                            <span className="text-blue-400 font-medium flex items-center gap-1">
                              <span>typing</span>
                              <span className="flex items-center gap-0.5 ml-0.5">
                                <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce" />
                              </span>
                            </span>
                          ) : (activeContactObj as any)?.status === 'busy' ? (
                            <span className="text-rose-400 font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                              Busy • Do Not Disturb
                            </span>
                          ) : (activeContactObj as any)?.status === 'away' ? (
                            <span className="text-amber-400 font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              Away
                            </span>
                          ) : activeContactObj?.isOnline ? (
                            <span className="text-emerald-400 font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Online
                            </span>
                          ) : (
                            <span className="text-[#8696a0]">
                              {formatLastSeen((activeContactObj as any)?.lastSeen)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Header Action Icons — Video & Audio Call for Direct Messages */}
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {selectedConversationType === 'dm' && (
                  <>
                    <button
                      onClick={() => handleStartCall('audio')}
                      className="p-2 rounded-full hover:bg-[#2a3942] text-[#aebac1] hover:text-emerald-400 transition-colors cursor-pointer"
                      title="Audio Call"
                    >
                      <Phone className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleStartCall('video')}
                      className="p-2 rounded-full hover:bg-[#2a3942] text-[#aebac1] hover:text-blue-400 transition-colors cursor-pointer"
                      title="Video Call"
                    >
                      <Video className="w-5 h-5" />
                    </button>
                  </>
                )}
                <button
                  ref={threadSearchButtonRef}
                  onClick={() => {
                    const next = !showThreadSearch;
                    setShowThreadSearch(next);
                    if (!next) setMessageSearchQuery('');
                  }}
                  className={`p-2 rounded-full transition-colors cursor-pointer ${
                    showThreadSearch ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-[#2a3942] text-[#aebac1] hover:text-white'
                  }`}
                  title={showThreadSearch ? "Close search" : "Search in conversation"}
                >
                  <Search className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* In-Thread Search Input */}
            <AnimatePresence>
              {showThreadSearch && (
                <motion.div
                  ref={threadSearchContainerRef}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="px-4 py-2 border-b border-[#2a3942] bg-[#202c33] flex items-center gap-2.5 z-10 shrink-0 shadow-inner"
                >
                  <Search className="w-4 h-4 text-[#8696a0] shrink-0" />
                  <input
                    type="text"
                    placeholder="Search in this chat..."
                    value={messageSearchQuery}
                    onChange={(e) => setMessageSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowThreadSearch(false);
                        setMessageSearchQuery('');
                      }
                    }}
                    className="w-full bg-transparent text-xs font-medium outline-none text-[#e9edef] placeholder:text-[#8696a0]"
                    autoFocus
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      setShowThreadSearch(false);
                      setMessageSearchQuery('');
                    }} 
                    className="p-1 rounded-full text-[#8696a0] hover:text-white hover:bg-[#2a3942] transition-colors cursor-pointer shrink-0"
                    title="Close search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Message Feed Area */}
            <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6 space-y-3 bg-[#0b141a] custom-scroll-area">
              {isLoadingMessages ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-[#8696a0]">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-400" />
                  <p className="text-xs font-semibold">Synchronizing messages with Firestore...</p>
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-3">
                  <div className="w-14 h-14 rounded-full bg-[#202c33] border border-[#2a3942] flex items-center justify-center text-blue-400">
                    <Lock className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#e9edef]">
                      {selectedConversationType === 'channel'
                        ? `Welcome to #${activeChannelObj?.name || 'channel'}`
                        : `Direct conversation with ${activeContactObj?.name || 'teammate'}`}
                    </h4>
                    <p className="text-xs text-[#8696a0] mt-1">
                      This is the beginning of your encrypted conversation. Send a message to start collaborating!
                    </p>
                  </div>
                </div>
              ) : (
                filteredMessages.map((msg, index) => {
                  const isMe = String(msg.sender.id) === String(currentUid) || msg.sender.name === user?.name;
                  const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  const isImage = msg.fileUrl && (
                    msg.fileName?.match(/\.(png|jpe?g|webp|gif|svg)$/i) ||
                    msg.fileUrl.startsWith('data:image/')
                  );

                  const isVoice = msg.fileUrl && (
                    msg.fileName?.match(/\.(webm|mp3|wav|ogg|m4a)$/i) ||
                    msg.fileName?.toLowerCase().includes('voice_note')
                  );

                  const isHighlighted = String(highlightedMsgId) === String(msg.id);

                  return (
                    <div
                      key={msg.id || index}
                      id={`msg-${msg.id}`}
                      className={`flex items-start gap-2 group relative transition-all duration-300 ${
                        isMe ? 'flex-row-reverse' : 'flex-row'
                      } ${isHighlighted ? 'bg-blue-500/20 p-2 rounded-2xl ring-2 ring-blue-500' : ''}`}
                      onMouseEnter={() => setActiveMessageActionId(msg.id)}
                      onMouseLeave={() => setActiveMessageActionId(null)}
                    >
                      {/* Message Bubble Container */}
                      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-[70%]`}>
                        {/* Sender Name in Channels/Teams for other users */}
                        {!isMe && (selectedConversationType === 'channel' || selectedConversationType === 'team') && (
                          <span className="text-[11px] font-bold text-[#53bdeb] mb-0.5 px-1">
                            {msg.sender.name}
                          </span>
                        )}

                        {/* Quoted Reply Banner */}
                        {msg.replyTo && (
                          <div
                            onClick={() => {
                              const targetElement = document.getElementById(`msg-${msg.replyTo?.id}`);
                              if (targetElement) {
                                targetElement.scrollIntoView({ behavior: 'smooth' });
                                setHighlightedMsgId(msg.replyTo?.id || null);
                                setTimeout(() => setHighlightedMsgId(null), 1800);
                              }
                            }}
                            className="mb-1 px-3 py-1.5 bg-[#111b21]/70 border-l-3 border-blue-500 rounded-r-lg text-[11px] text-[#8696a0] max-w-full truncate cursor-pointer hover:bg-[#111b21] transition-colors"
                            title="Click to view quoted message"
                          >
                            <span className="font-bold text-blue-400 mr-1">↳ {msg.replyTo.senderName}:</span>
                            <span className="italic">"{msg.replyTo.content}"</span>
                          </div>
                        )}

                        {/* Message Bubble */}
                        <div
                          className={`pl-3.5 pr-6 py-2 rounded-xl text-[13.5px] leading-relaxed shadow-sm break-words relative group/bubble ${
                            isMe
                              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-xs shadow-md shadow-blue-600/20'
                              : 'bg-[#202c33] text-[#e9edef] rounded-tl-xs'
                          }`}
                        >
                          {/* WhatsApp Bubble Context Chevron (Appears on hover over message) */}
                          {!msg.isDeleted && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveContextMenuMsgId(
                                  String(activeContextMenuMsgId) === String(msg.id) ? null : msg.id
                                );
                                setActiveReactionTrayMsgId(null);
                              }}
                              className={`absolute top-1 right-1 w-5 h-5 rounded-full bg-black/25 hover:bg-black/45 text-[#8696a0] hover:text-white flex items-center justify-center transition-all cursor-pointer z-10 ${
                                String(activeContextMenuMsgId) === String(msg.id)
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100'
                              }`}
                              title="Message options"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Dropdown Context Menu */}
                          {String(activeContextMenuMsgId) === String(msg.id) && !msg.isDeleted && (
                            <div
                              className={`absolute top-7 ${
                                isMe ? 'right-0' : 'left-0'
                              } z-50 w-44 py-1.5 rounded-xl bg-[#233138] border border-[#2a3942] shadow-[0_12px_28px_rgba(0,0,0,0.65)] text-[#d1d7db] text-[13px] font-normal backdrop-blur-md animate-in fade-in zoom-in-95 duration-100`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => {
                                  setReplyToMessage(msg);
                                  setActiveContextMenuMsgId(null);
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-[#182229] flex items-center gap-3 cursor-pointer transition-colors"
                              >
                                <Reply className="w-4 h-4 text-[#8696a0]" />
                                <span>Reply</span>
                              </button>

                              <button
                                onClick={() => {
                                  setActiveReactionTrayMsgId(msg.id);
                                  setActiveContextMenuMsgId(null);
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-[#182229] flex items-center gap-3 cursor-pointer transition-colors"
                              >
                                <Smile className="w-4 h-4 text-[#8696a0]" />
                                <span>React</span>
                              </button>

                              <button
                                onClick={() => {
                                  setForwardModalData({ isOpen: true, messageText: msg.content });
                                  setActiveContextMenuMsgId(null);
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-[#182229] flex items-center gap-3 cursor-pointer transition-colors"
                              >
                                <Share2 className="w-4 h-4 text-[#8696a0]" />
                                <span>Forward</span>
                              </button>

                              <button
                                onClick={() => {
                                  handleCopyMessage(msg.content);
                                  setActiveContextMenuMsgId(null);
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-[#182229] flex items-center gap-3 cursor-pointer transition-colors"
                              >
                                <Copy className="w-4 h-4 text-[#8696a0]" />
                                <span>Copy</span>
                              </button>

                              {isMe && (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingMessage(msg);
                                      setActiveContextMenuMsgId(null);
                                    }}
                                    className="w-full px-3 py-2 text-left hover:bg-[#182229] flex items-center gap-3 cursor-pointer text-blue-400 hover:text-blue-300 transition-colors"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                    <span>Edit</span>
                                  </button>

                                  <div className="h-px bg-[#2a3942] my-1" />

                                  <button
                                    onClick={() => {
                                      setDeleteConfirmMsgId(msg.id);
                                      setActiveContextMenuMsgId(null);
                                    }}
                                    className="w-full px-3 py-2 text-left hover:bg-rose-500/10 flex items-center gap-3 cursor-pointer text-rose-400 hover:text-rose-300 transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    <span>Delete</span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Deleted message state (Requirement 12) */}
                          {msg.isDeleted ? (
                            <div className="italic text-[#8696a0] flex items-center gap-1.5 text-xs py-0.5">
                              <Trash2 className="w-3.5 h-3.5 opacity-60" />
                              <span>This message was deleted</span>
                            </div>
                          ) : (
                            <>
                              {/* Message Text Content */}
                              {msg.content && <div className="leading-relaxed">{renderMessageBody(msg.content)}</div>}

                              {/* Image Preview (Requirement 17) */}
                              {isImage && msg.fileUrl && (
                                <div className="mt-2 rounded-lg overflow-hidden border border-white/10 max-w-xs">
                                  <img
                                    src={msg.fileUrl}
                                    alt={msg.fileName || 'Attachment'}
                                    onClick={() => setActiveImageLightbox({ isOpen: true, url: msg.fileUrl || '', title: msg.fileName || 'Image Attachment' })}
                                    className="w-full max-h-60 object-cover cursor-pointer hover:scale-102 transition-transform"
                                  />
                                </div>
                              )}

                              {/* Voice Message Player (Requirement 22) */}
                              {isVoice && msg.fileUrl && (
                                <div className="mt-2 p-2 bg-[#111b21]/80 rounded-xl flex items-center gap-3 border border-white/10 min-w-[220px]">
                                  <audio
                                    ref={(el) => {
                                      if (el) audioElementsRef.current[String(msg.id)] = el;
                                    }}
                                    src={msg.fileUrl}
                                    onEnded={() => setPlayingAudioId(null)}
                                    className="hidden"
                                  />
                                  <button
                                    onClick={() => {
                                      const audioEl = audioElementsRef.current[String(msg.id)];
                                      if (!audioEl) return;
                                      if (playingAudioId === msg.id) {
                                        audioEl.pause();
                                        setPlayingAudioId(null);
                                      } else {
                                        // Pause any other playing audio
                                        Object.values(audioElementsRef.current).forEach(a => a.pause());
                                        audioEl.play();
                                        setPlayingAudioId(msg.id);
                                      }
                                    }}
                                    className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0 cursor-pointer shadow-sm hover:scale-105 active:scale-95 transition-all shadow-blue-500/25"
                                  >
                                    {playingAudioId === msg.id ? (
                                      <Pause className="w-4 h-4 fill-current" />
                                    ) : (
                                      <Play className="w-4 h-4 fill-current ml-0.5" />
                                    )}
                                  </button>
                                  <div className="flex-1">
                                    <div className="h-1.5 bg-[#202c33] rounded-full overflow-hidden">
                                      <div className={`h-full bg-blue-500 ${playingAudioId === msg.id ? 'w-full animate-pulse' : 'w-1/3'}`} />
                                    </div>
                                    <span className="text-[10px] text-[#8696a0] font-mono mt-1 block">Voice Note</span>
                                  </div>
                                </div>
                              )}

                              {/* File Attachment Card with Enterprise PDF Viewer (Requirements 16, 18, 19) */}
                              {!isImage && !isVoice && msg.fileName && (
                                <div className="mt-2.5 p-2.5 bg-[#111b21]/70 rounded-xl flex items-center justify-between gap-3 border border-white/10 shadow-inner">
                                  <div className="flex items-center gap-2.5 truncate">
                                    <div className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 border border-red-500/30">
                                      <FileText className="w-4 h-4" />
                                    </div>
                                    <div className="truncate">
                                      <span className="text-xs font-bold text-[#e9edef] truncate block">{msg.fileName}</span>
                                      <span className="text-[10px] text-[#8696a0] block">
                                        {msg.fileSize
                                          ? typeof msg.fileSize === 'number'
                                            ? `${(msg.fileSize / (1024 * 1024)).toFixed(1)} MB`
                                            : msg.fileSize
                                          : 'Workspace Document'}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      onClick={() => {
                                        setSelectedPdfToView({
                                          isOpen: true,
                                          url: msg.fileUrl || '#',
                                          fileName: msg.fileName || 'Document.pdf',
                                          fileSize: typeof msg.fileSize === 'number' ? `${(msg.fileSize / (1024 * 1024)).toFixed(1)} MB` : (msg.fileSize || '1.8 MB'),
                                          uploadedBy: msg.sender.name || 'Workspace Member',
                                          uploadedAt: msg.createdAt,
                                          project: activeChannelObj?.name || activeTeamObj?.name || 'Workspace Project',
                                          organization: activeOrganization?.organizationName || 'TaskFlow Organization',
                                          accessLevel: 'Restricted Workspace Access'
                                        });
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/25 transition-transform active:scale-95"
                                      title="Open Document in PDF Viewer"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Open PDF</span>
                                    </button>
                                    {msg.fileUrl && msg.fileUrl !== '#' && (
                                      <a
                                        href={msg.fileUrl}
                                        download={msg.fileName}
                                        className="p-1.5 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-[#d1d7db] text-xs font-bold flex items-center justify-center transition-colors"
                                        title="Download Document"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          {/* Message Footer: Timestamp, Edited Badge & Read Checkmarks (Requirements 5, 8, 11) */}
                          <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-[#8696a0]">
                            {msg.isEdited && <span className="italic text-[9px] text-[#8696a0]">(edited)</span>}
                            <span>{formattedTime}</span>
                            {isMe && (
                              <MessageStatus
                                status={msg.status}
                                isRead={msg.isRead}
                                isMe={true}
                                onRetry={() => handleRetryMessage(msg)}
                              />
                            )}
                          </div>
                        </div>

                        {/* Emoji Reactions List (Requirement 10) */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1 px-1">
                            {Object.entries(msg.reactions).map(([emoji, userIds]) => (
                              <button
                                key={emoji}
                                onClick={() => handleToggleReaction(msg.id, emoji)}
                                className="px-2 py-0.5 rounded-full bg-[#202c33] border border-[#2a3942] text-[11px] font-bold flex items-center gap-1 hover:scale-105 transition-all cursor-pointer"
                              >
                                <span>{emoji}</span>
                                <span className="text-[9px] text-[#8696a0]">{userIds.length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* WhatsApp Hover Quick Action Triggers (Image 2) */}
                      {!msg.isDeleted && (
                        <div className="relative shrink-0 self-center">
                          {/* When hovered over the message, show the single round emoji smile button and quick reply button */}
                          <div
                            className={`items-center gap-1.5 transition-all duration-150 ${
                              String(activeReactionTrayMsgId) === String(msg.id)
                                ? 'flex opacity-100 scale-100'
                                : 'hidden group-hover:flex group-hover:opacity-100 group-hover:scale-100'
                            }`}
                          >
                            {/* Single Emoji Smile Button (WhatsApp Image 2) */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveReactionTrayMsgId(
                                  String(activeReactionTrayMsgId) === String(msg.id) ? null : msg.id
                                );
                                setActiveContextMenuMsgId(null);
                              }}
                              className={`w-7 h-7 rounded-full bg-[#182229]/80 hover:bg-[#202c33] text-[#8696a0] hover:text-[#d1d7db] flex items-center justify-center cursor-pointer shadow-sm transition-all active:scale-95 ${
                                String(activeReactionTrayMsgId) === String(msg.id)
                                  ? 'bg-[#202c33] text-white ring-1 ring-blue-500'
                                  : ''
                              }`}
                              title="Add reaction"
                            >
                              <Smile className="w-4 h-4" />
                            </button>

                            {/* Quick Reply / Forward Button (WhatsApp Image 2) */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReplyToMessage(msg);
                              }}
                              className="w-7 h-7 rounded-full bg-[#182229]/80 hover:bg-[#202c33] text-[#8696a0] hover:text-[#d1d7db] flex items-center justify-center cursor-pointer shadow-sm transition-all active:scale-95"
                              title="Reply"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Floating Emoji Reactions Bar (Appears when single Smile button is clicked!) */}
                          <AnimatePresence>
                            {String(activeReactionTrayMsgId) === String(msg.id) && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.85, y: 6 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.85, y: 6 }}
                                transition={{ duration: 0.15 }}
                                className={`absolute z-30 bottom-full mb-2 ${
                                  isMe ? 'left-0' : 'right-0'
                                } flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#202c33] border border-[#2a3942] shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur-md`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {(['👍', '❤️', '😂', '😮', '😢', '🙏'] as const).map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => {
                                      handleToggleReaction(msg.id, emoji);
                                      setActiveReactionTrayMsgId(null);
                                    }}
                                    className="w-7 h-7 rounded-full hover:bg-[#2a3942] flex items-center justify-center text-sm transition-transform hover:scale-125 cursor-pointer active:scale-90"
                                    title={`React ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              <AnimatePresence>
                {typingUserInActiveConv && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#202c33] border border-[#2a3942] text-[#8696a0] text-xs max-w-xs shadow-sm self-start my-1 shrink-0"
                  >
                    <span className="font-semibold text-blue-400">{typingUserInActiveConv}</span>
                    <span>is typing</span>
                    <span className="flex items-center gap-0.5 ml-0.5">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>

            {/* Message Composer (Requirements 4, 16, 22, 38) */}
            <MessageComposer
              onSendMessage={handleSendMessage}
              onTyping={handleUserTyping}
              replyToMessage={replyToMessage}
              onClearReply={() => setReplyToMessage(null)}
              editingMessage={editingMessage}
              onClearEdit={() => setEditingMessage(null)}
              contacts={contacts}
              placeholder={
                selectedConversationType === 'channel'
                  ? `Message #${activeChannelObj?.name || 'channel'}...`
                  : `Message ${activeContactObj?.name || 'teammate'}...`
              }
              orgId={orgId}
              convId={selectedConversationId || undefined}
              enterToSend={settings.enterToSend}
            />
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: SEND DOCUMENT PICKER MODAL                                       */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isDocumentPickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl overflow-hidden text-[#e9edef]"
            >
              <div className="p-4 border-b border-[#2a3942] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#e9edef]">Send Workspace Document</h3>
                    <p className="text-[11px] text-[#8696a0]">Select a document to share directly in chat</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDocumentPickerOpen(false)}
                  className="p-1 rounded-lg text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-semibold text-[#8696a0] uppercase mb-2 tracking-wider">
                    Available Workspace Documents
                  </label>
                  <div className="space-y-1.5">
                    {getAvailableDocuments().map((docItem: any) => {
                      const isSelected = selectedDocToSend?.id === docItem.id;
                      return (
                        <button
                          key={docItem.id}
                          onClick={() => setSelectedDocToSend(docItem)}
                          className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500/15 text-[#e9edef]'
                              : 'border-[#2a3942] hover:bg-[#2a3942] text-[#d1d7db]'
                          }`}
                        >
                          <div className="flex items-center gap-3 truncate">
                            <FileText className={`w-5 h-5 ${isSelected ? 'text-blue-400' : 'text-[#8696a0]'}`} />
                            <div className="truncate">
                              <p className="text-xs font-bold truncate">{docItem.title}</p>
                              <p className="text-[10px] text-[#8696a0]">{docItem.size || '1.4 MB'}</p>
                            </div>
                          </div>
                          {isSelected && <CheckCheck className="w-4 h-4 text-blue-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8696a0] uppercase mb-2 tracking-wider">
                    Recipient Target
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      onClick={() => {
                        setDocRecipientType('channel');
                        setDocRecipientId(channels[0]?.id || 'general-workspace');
                      }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        docRecipientType === 'channel'
                          ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/25'
                          : 'bg-[#111b21] text-[#8696a0] hover:text-[#d1d7db]'
                      }`}
                    >
                      Project Channel
                    </button>
                    <button
                      onClick={() => {
                        setDocRecipientType('dm');
                        setDocRecipientId(contacts[1]?.id || 'emp-101');
                      }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        docRecipientType === 'dm'
                          ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/25'
                          : 'bg-[#111b21] text-[#8696a0] hover:text-[#d1d7db]'
                      }`}
                    >
                      Teammate DM
                    </button>
                  </div>

                  <LuxurySelect
                    value={docRecipientId}
                    onChange={(val) => setDocRecipientId(val)}
                    options={
                      docRecipientType === 'channel'
                        ? channels.map((c) => ({
                            value: c.id,
                            label: `#${c.name}`,
                            subLabel: c.description || 'Channel',
                            icon: <Hash className="w-3.5 h-3.5 text-blue-400" />
                          }))
                        : contacts.filter(c => c.id !== AI_ASSISTANT_ID).map((u) => ({
                            value: u.id,
                            label: u.name,
                            subLabel: formatRoleName(u.role, 'title'),
                            badge: u.isOnline ? 'Online' : undefined,
                            badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          }))
                    }
                    buttonClassName="w-full px-3 py-2 bg-[#111b21] border-[#2a3942] rounded-xl text-xs font-medium text-[#d1d7db]"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-[#2a3942] flex items-center justify-end gap-2 bg-[#111b21]/50">
                <button
                  onClick={() => setIsDocumentPickerOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSendDoc}
                  disabled={!selectedDocToSend}
                  className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    selectedDocToSend
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/25 cursor-pointer'
                      : 'bg-[#2a3942] text-[#8696a0] cursor-not-allowed'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Document</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 2: ADD CONTACT / START DIRECT MESSAGE MODAL (Requirement 2)         */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isAddContactModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl overflow-hidden text-[#e9edef]"
            >
              <div className="p-4 border-b border-[#2a3942] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#e9edef]">New Direct Message</h3>
                    <p className="text-[11px] text-[#8696a0]">
                      Eligible members in {activeOrganization?.organizationName || 'organization'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAddContactModalOpen(false)}
                  className="p-1 rounded-lg text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 max-h-[60vh] overflow-y-auto space-y-1 divide-y divide-[#2a3942]">
                {contacts.map((contact) => (
                  <button
                    key={`modal_c_${contact.id}`}
                    onClick={() => {
                      if (contact.id === AI_ASSISTANT_ID) {
                        handleSelectConversation('ai', AI_ASSISTANT_ID);
                      } else {
                        const contactUid = String(contact.uid || contact.id);
                        handleSelectConversation('dm', contactUid);
                      }
                      setIsAddContactModalOpen(false);
                      showToast(`Chat with ${contact.name} opened`);
                    }}
                    className="w-full flex items-center justify-between p-3 hover:bg-[#2a3942] rounded-xl transition-all text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className="relative shrink-0">
                        <img
                          src={resolveAvatar(contact.profilePhoto, contact.name, (contact as any).gender)}
                          alt={contact.name}
                          className="w-10 h-10 rounded-full object-cover ring-1 ring-[#2a3942]"
                        />
                        <span
                          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#202c33] ${
                            contact.status === 'busy'
                              ? 'bg-rose-500'
                              : contact.status === 'away'
                              ? 'bg-amber-400'
                              : contact.isOnline
                              ? 'bg-emerald-500'
                              : 'bg-[#8696a0]'
                          }`}
                        />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-[#e9edef] group-hover:text-blue-400 transition-colors truncate">
                          {contact.name}
                        </p>
                        <p className="text-[10px] text-[#8696a0] truncate">
                          {contact.id === AI_ASSISTANT_ID
                            ? 'AI Copilot'
                            : `${formatRoleName(contact.role, 'title')} • ${
                                contact.status === 'busy'
                                  ? 'Busy'
                                  : contact.status === 'away'
                                  ? 'Away'
                                  : contact.isOnline
                                  ? 'Online'
                                  : 'Offline'
                              }`}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#8696a0] group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 3: COMMUNICATION SETTINGS MODAL (Requirement 26)                     */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isSettingsModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl overflow-hidden text-[#e9edef]"
            >
              <div className="p-4 border-b border-[#2a3942] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#e9edef]">Communication Settings</h3>
                    <p className="text-[11px] text-[#8696a0]">Preferences are stored and persisted across sessions</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="p-1 rounded-lg text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <h4 className="text-xs font-bold text-[#8696a0] uppercase tracking-wider mb-2">General & Chat</h4>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between text-xs text-[#d1d7db] cursor-pointer">
                      <span>Sound effects on new messages</span>
                      <input
                        type="checkbox"
                        checked={settings.soundEnabled}
                        onChange={(e) => setSettings({ ...settings, soundEnabled: e.target.checked })}
                        className="w-4 h-4 accent-blue-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#d1d7db] cursor-pointer">
                      <span>Press Enter to send (Shift+Enter for newline)</span>
                      <input
                        type="checkbox"
                        checked={settings.enterToSend}
                        onChange={(e) => setSettings({ ...settings, enterToSend: e.target.checked })}
                        className="w-4 h-4 accent-blue-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#d1d7db] cursor-pointer">
                      <span>Desktop notifications for mentions</span>
                      <input
                        type="checkbox"
                        checked={settings.desktopNotifications}
                        onChange={(e) => setSettings({ ...settings, desktopNotifications: e.target.checked })}
                        className="w-4 h-4 accent-blue-500"
                      />
                    </label>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#2a3942]">
                  <h4 className="text-xs font-bold text-[#8696a0] uppercase tracking-wider mb-2">Privacy & Visibility</h4>
                  <div className="space-y-3">
                    <label className="flex items-center justify-between text-xs text-[#d1d7db] cursor-pointer">
                      <span>Send read receipts (Double Blue Checkmarks)</span>
                      <input
                        type="checkbox"
                        checked={settings.readReceipts}
                        onChange={(e) => setSettings({ ...settings, readReceipts: e.target.checked })}
                        className="w-4 h-4 accent-blue-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#d1d7db] cursor-pointer">
                      <span>Show online availability status to teammates</span>
                      <input
                        type="checkbox"
                        checked={settings.onlineStatusVisible}
                        onChange={(e) => setSettings({ ...settings, onlineStatusVisible: e.target.checked })}
                        className="w-4 h-4 accent-blue-500"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-[#2a3942] flex items-center justify-end gap-2 bg-[#111b21]/50">
                <button
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSaveSettings(settings)}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/25 cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 4: VIEW PROFILE MODAL (Requirement 24)                              */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isViewProfileModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl p-6 text-center text-[#e9edef] relative"
            >
              <button
                onClick={() => setIsViewProfileModalOpen(false)}
                className="absolute top-4 right-4 p-1 text-[#8696a0] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-20 h-20 mx-auto rounded-full overflow-hidden ring-4 ring-blue-500/40 shadow-xl mb-3">
                <img
                  src={resolveAvatar(user?.profilePhoto, user?.name, user?.gender)}
                  alt={user?.name}
                  className="w-full h-full object-cover"
                />
              </div>

              <h3 className="text-lg font-bold text-[#e9edef]">{user?.name}</h3>
              <p className="text-xs text-blue-400 font-semibold">{formatRoleName(user?.role)}</p>
              <p className="text-xs text-[#8696a0] mt-0.5">{user?.email}</p>

              <div className="mt-5 p-3 bg-[#111b21] rounded-xl text-left text-xs space-y-2 border border-[#2a3942]">
                <div className="flex justify-between">
                  <span className="text-[#8696a0]">Organization:</span>
                  <span className="font-bold text-[#d1d7db]">{activeOrganization?.organizationName || 'Default Org'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8696a0]">Department:</span>
                  <span className="font-bold text-[#d1d7db]">{user?.department || 'Engineering'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8696a0]">Designation:</span>
                  <span className="font-bold text-[#d1d7db]">{user?.designation || 'Specialist'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8696a0]">Status:</span>
                  <span className={`font-bold capitalize ${
                    userStatus === 'busy'
                      ? 'text-rose-400'
                      : userStatus === 'away'
                      ? 'text-amber-400'
                      : userStatus === 'online'
                      ? 'text-emerald-400'
                      : 'text-[#8696a0]'
                  }`}>{userStatus}</span>
                </div>
              </div>

              <button
                onClick={() => setIsViewProfileModalOpen(false)}
                className="mt-5 w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 5: EDIT PROFILE MODAL                                               */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isEditProfileModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl p-5 text-[#e9edef] relative"
            >
              <div className="flex items-center justify-between border-b border-[#2a3942] pb-3 mb-4">
                <h3 className="font-bold text-sm text-[#e9edef]">Edit Profile Details</h3>
                <button
                  onClick={() => setIsEditProfileModalOpen(false)}
                  className="p-1 text-[#8696a0] hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#8696a0] uppercase mb-1">Full Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-xs text-[#d1d7db] outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#8696a0] uppercase mb-1">Designation</label>
                  <input
                    type="text"
                    value={editDesignation}
                    onChange={(e) => setEditDesignation(e.target.value)}
                    className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-xs text-[#d1d7db] outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#8696a0] uppercase mb-1">Department</label>
                  <input
                    type="text"
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                    className="w-full px-3 py-2 bg-[#111b21] border border-[#2a3942] rounded-xl text-xs text-[#d1d7db] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setIsEditProfileModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 6: DELETE MESSAGE CONFIRMATION MODAL (Requirement 12)               */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {deleteConfirmMsgId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#202c33] border border-[#2a3942] rounded-2xl p-5 text-center text-[#e9edef] shadow-2xl"
            >
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[#e9edef]">Delete this message?</h3>
              <p className="text-xs text-[#8696a0] mt-1.5 leading-relaxed">
                The message content will be replaced with "This message was deleted" to preserve conversation history.
              </p>
              <div className="flex gap-2 justify-center mt-5">
                <button
                  onClick={() => setDeleteConfirmMsgId(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8696a0] hover:text-white hover:bg-[#2a3942]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDeleteMessage}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 7: FORWARD MESSAGE MODAL (Requirement 14)                            */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {forwardModalData.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl overflow-hidden text-[#e9edef]"
            >
              <div className="p-4 border-b border-[#2a3942] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-blue-400" />
                  <h3 className="font-bold text-sm">Forward Message</h3>
                </div>
                <button
                  onClick={() => setForwardModalData({ isOpen: false, messageText: '' })}
                  className="p-1 rounded-lg text-[#8696a0] hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 bg-[#111b21] border-b border-[#2a3942] text-xs text-[#8696a0] italic truncate">
                "{forwardModalData.messageText}"
              </div>

              <div className="p-3 max-h-60 overflow-y-auto space-y-1">
                <p className="text-[10px] font-bold text-[#8696a0] uppercase px-2 mb-1">Select recipient:</p>
                {contacts.filter(c => c.id !== AI_ASSISTANT_ID).map((c) => (
                  <button
                    key={`fwd_c_${c.id}`}
                    onClick={() => handleForwardMessage('dm', c.id)}
                    className="w-full p-2 rounded-xl hover:bg-[#2a3942] flex items-center gap-2.5 text-left cursor-pointer transition-colors"
                  >
                    <img
                      src={resolveAvatar(c.profilePhoto, c.name, (c as any).gender)}
                      alt={c.name}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div className="truncate">
                      <p className="text-xs font-bold text-[#e9edef]">{c.name}</p>
                      <p className="text-[10px] text-[#8696a0]">{formatRoleName(c.role, 'title')}</p>
                    </div>
                  </button>
                ))}
                {channels.map((ch) => (
                  <button
                    key={`fwd_ch_${ch.id}`}
                    onClick={() => handleForwardMessage('channel', ch.id)}
                    className="w-full p-2 rounded-xl hover:bg-[#2a3942] flex items-center gap-2.5 text-left cursor-pointer transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#1e293b] border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-xs">#</div>
                    <div className="truncate">
                      <p className="text-xs font-bold text-[#e9edef]">#{ch.name}</p>
                      <p className="text-[10px] text-[#8696a0]">{ch.description || 'Channel'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 8: IMAGE LIGHTBOX MODAL (Requirement 17)                            */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {activeImageLightbox.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            >
              <div className="w-full flex items-center justify-between pb-3 text-white">
                <span className="text-xs font-bold truncate max-w-md">{activeImageLightbox.title}</span>
                <div className="flex items-center gap-2">
                  <a
                    href={activeImageLightbox.url}
                    download={activeImageLightbox.title || 'image.png'}
                    className="p-1.5 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-white transition-colors"
                    title="Download Image"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => setActiveImageLightbox({ isOpen: false, url: '', title: '' })}
                    className="p-1.5 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <img
                src={activeImageLightbox.url}
                alt={activeImageLightbox.title}
                className="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl"
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* Right Details Panel (Requirements 24 & 25) */}
      <ConversationDetailsPanel
        isOpen={detailsPanelOpen}
        onClose={toggleDetailsPanel}
        activeTab={selectedConversationType === 'channel' ? 'channels' : 'dms'}
        channel={activeChannelObj}
        contact={activeContactObj}
        members={contacts}
        messages={messages}
        convKey={selectedConversationId || ''}
        onOpenPdf={(doc) => {
          setSelectedPdfToView({
            isOpen: true,
            url: doc.url,
            fileName: doc.fileName,
            fileSize: doc.fileSize || '1.8 MB',
            uploadedBy: doc.uploadedBy || 'Teammate',
            uploadedAt: new Date().toISOString(),
            project: activeChannelObj?.name || activeTeamObj?.name || 'Workspace Project',
            organization: activeOrganization?.organizationName || 'TaskFlow Organization',
            accessLevel: 'Restricted Workspace Access'
          });
        }}
        onClearChat={handleClearChat}
      />

      {/* Create Channel Modal */}
      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        onSubmitChannel={handleCreateChannel}
        contacts={contacts}
      />

      {/* Enterprise Premium PDF Viewer Modal (Requirement 18) */}
      <PremiumPdfViewerModal
        isOpen={selectedPdfToView.isOpen}
        onClose={() => setSelectedPdfToView((prev) => ({ ...prev, isOpen: false }))}
        pdfUrl={selectedPdfToView.url}
        fileName={selectedPdfToView.fileName}
        fileSize={selectedPdfToView.fileSize}
        uploadedBy={selectedPdfToView.uploadedBy}
        uploadedAt={selectedPdfToView.uploadedAt}
        project={selectedPdfToView.project}
        organization={selectedPdfToView.organization}
        accessLevel={selectedPdfToView.accessLevel}
      />
    </div>
  );
}
