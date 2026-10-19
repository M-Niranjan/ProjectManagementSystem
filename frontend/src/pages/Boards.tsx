import { getAvatarByName, resolveAvatar } from '../services/avatar';
import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { 
  Plus, Search, Calendar, Users, Eye, CheckSquare, Clock, 
  ArrowUpRight, Flame, Layers, HelpCircle, FileText, ChevronRight, 
  GripVertical, Undo2, CheckCircle2, AlertCircle, Sparkles, UserCheck, Pencil
} from 'lucide-react';
import api from '../services/api';
import { useUIStore } from '../store/useUIStore';
import { useAuthStore } from '../store/useAuthStore';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useScrollLock } from '../hooks/useScrollLock';
import LuxurySelect from '../components/common/LuxurySelect';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  estimatedTime: number;
  actualTime: number;
  subtasksCount?: number;
  completedSubtasksCount?: number;
  commentsCount?: number;
  dependenciesCount?: number;
  assignee?: { id: number; name: string; profilePhoto?: string };
  reviewer?: { id: number; name: string; profilePhoto?: string };
}

interface Column {
  id: string;
  title: string;
  color: string;
}

interface GatePrompt {
  task: Task;
  targetStatus: string;
  type: 'NOTE' | 'QA' | 'REVIEWER' | 'SENDBACK';
}

const STAGE_ORDER = ['BACKLOG', 'TO_DO', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'COMPLETED'];

const COLUMNS: Column[] = [
  { id: 'BACKLOG', title: 'Backlog', color: 'border-t-slate-400 bg-slate-500/5' },
  { id: 'TO_DO', title: 'To Do', color: 'border-t-blue-500 bg-blue-500/5' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'border-t-indigo-500 bg-indigo-500/5' },
  { id: 'TESTING', title: 'Testing', color: 'border-t-purple-500 bg-purple-500/5' },
  { id: 'REVIEW', title: 'Review', color: 'border-t-amber-500 bg-amber-500/5' },
  { id: 'COMPLETED', title: 'Completed', color: 'border-t-green-500 bg-green-500/5' },
];

export default function Boards() {
  const { selectedProjectId, setView, setTaskModalOpen, showToast } = useUIStore();
  const { user } = useAuthStore();
  const isTeamLeader = user?.role === 'ROLE_ADMIN' || user?.role === 'ROLE_MANAGER';
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(selectedProjectId);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isProjectFocused, setIsProjectFocused] = useState(false);
  
  // Team users for reviewer dropdowns
  const [usersList, setUsersList] = useState<any[]>([]);

  // Gate Modal prompts state
  const [gatePrompt, setGatePrompt] = useState<GatePrompt | null>(null);

  // Lock background scroll when quality gate modal is open
  useScrollLock(!!gatePrompt);

  const [completionNote, setCompletionNote] = useState('');
  const [qaChecked, setQaChecked] = useState({ test: false, ui: false, review: false });
  const [selectedReviewerId, setSelectedReviewerId] = useState<number | null>(null);
  const [sendBackReason, setSendBackReason] = useState('');

  // Configure Pointer sensor with 8px constraints to avoid capturing clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const fetchProjects = async () => {
    try {
      const res = await api.get('/api/projects');
      setProjectsList(res.data);
      if (!activeProjectId && res.data.length > 0) {
        setActiveProjectId(res.data[0].id);
      }
    } catch (err) {
      setProjectsList([]);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/api/teams');
      // System Administrator manages the portal only - filter out ROLE_ADMIN from reviewer/assignee list
      const assignableUsers = (res.data || []).filter((u: any) => u.role !== 'ROLE_ADMIN' && !u.role?.includes('ADMIN'));
      setUsersList(assignableUsers);
    } catch (err) {
      setUsersList([]);
    }
  };

  const fetchTasks = async () => {
    if (!activeProjectId) return;
    try {
      const res = await api.get(`/api/tasks/project/${activeProjectId}`);
      if (res.data && res.data.length > 0) {
        setTasks(res.data);
      } else {
        setTasks([]);
      }
    } catch (err) {
      setTasks([]);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [activeProjectId]);

  useEffect(() => {
    window.addEventListener('task-created', fetchTasks);
    window.addEventListener('task-status-updated', fetchTasks);
    return () => {
      window.removeEventListener('task-created', fetchTasks);
      window.removeEventListener('task-status-updated', fetchTasks);
    };
  }, [activeProjectId]);

  // Hook into global live auto-refresh
  useLiveRefresh(fetchTasks);
  useScrollLock(!!gatePrompt);

  // Validation function checks constraints step-by-step
  const validateTransition = (task: Task, targetStatus: string): { valid: boolean; error?: string } => {
    const currentIdx = STAGE_ORDER.indexOf(task.status);
    const targetIdx = STAGE_ORDER.indexOf(targetStatus);

    if (targetIdx === -1) return { valid: false, error: 'Invalid workflow stage.' };

    const diff = targetIdx - currentIdx;
    
    // Enforce strict lock: Employees cannot transition tasks to COMPLETED. Only Team Leaders can approve.
    if (targetStatus === 'COMPLETED' && user?.role === 'ROLE_EMPLOYEE') {
      return {
        valid: false,
        error: '🔒 Access Denied: Employees cannot mark tasks as COMPLETED. Please submit your task for REVIEW so your Team Leader can inspect and sign off.'
      };
    }

    // Enforce step-by-step sequential progression
    if (Math.abs(diff) !== 1) {
      return { valid: false, error: 'Workflow progression must be step-by-step. You cannot skip stages.' };
    }

    if (diff === 1) {
      // 1. Backlog -> To Do
      if (task.status === 'BACKLOG') {
        if (!task.title || !task.priority || !task.dueDate) {
          return { valid: false, error: 'Planning tasks requires a title, priority, and due date. Please edit task details first.' };
        }
      }
      // 2. To Do -> In Progress
      if (task.status === 'TO_DO') {
        if (!task.assignee) {
          return { valid: false, error: 'Starting work requires assigning a team member to this task.' };
        }
      }
      // 3. In Progress -> Testing (requires completion note)
      // 4. Testing -> Review (requires QA checks list)
      // 5. Review -> Completed (requires reviewer != assignee)
      if (task.status === 'REVIEW') {
        if (!task.reviewer) {
          return { valid: false, error: 'Approve & Complete requires assigning a Reviewer.' };
        }
        if (task.assignee) {
          const sameId = task.reviewer.id === task.assignee.id;
          const sameName = (task.reviewer.name || '').trim().toLowerCase() === (task.assignee.name || '').trim().toLowerCase();
          if (sameId && (task.reviewer.id !== 900000 || sameName)) {
            return { valid: false, error: 'Self-approval is blocked. Reviewer must be a different person than the assignee.' };
          }
        }
      }
    }

    return { valid: true };
  };

  const handleActionClick = (task: Task) => {
    const currentIdx = STAGE_ORDER.indexOf(task.status);
    if (currentIdx === -1 || task.status === 'COMPLETED') return;

    const nextStatus = STAGE_ORDER[currentIdx + 1];
    
    // Run pre-validation checks (for backlog/todo requirements)
    const checks = validateTransition(task, nextStatus);
    if (!checks.valid) {
      showToast(checks.error || 'Transition not allowed.', 'error');
      return;
    }

    // Intercept with overlay prompt modals if human-confirmed parameters needed
    if (task.status === 'IN_PROGRESS') {
      setCompletionNote('');
      setGatePrompt({ task, targetStatus: 'TESTING', type: 'NOTE' });
      return;
    }
    if (task.status === 'TESTING') {
      setQaChecked({ test: false, ui: false, review: false });
      setGatePrompt({ task, targetStatus: 'REVIEW', type: 'QA' });
      return;
    }
    if (task.status === 'REVIEW') {
      setSelectedReviewerId(null);
      setGatePrompt({ task, targetStatus: 'COMPLETED', type: 'REVIEWER' });
      return;
    }

    // Direct progression if no dialog prompts needed (e.g. Backlog -> Todo, Todo -> InProgress)
    commitTransition(task, nextStatus);
  };

  const handleSendBack = (task: Task) => {
    const currentIdx = STAGE_ORDER.indexOf(task.status);
    if (currentIdx <= 0) return; // Cannot send back from backlog

    const prevStatus = STAGE_ORDER[currentIdx - 1];
    setSendBackReason('');
    setGatePrompt({ task, targetStatus: prevStatus, type: 'SENDBACK' });
  };

  // Drag and Drop integration with the strict gates validation
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = parseInt(active.id.toString().replace('task-', ''));
    const newStatus = over.id.toString();

    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const checks = validateTransition(task, newStatus);
    if (!checks.valid) {
      showToast(checks.error || 'Transition not allowed.', 'error');
      return;
    }

    // Intercept with dialog prompts if dragging forward
    if (task.status === 'IN_PROGRESS' && newStatus === 'TESTING') {
      setCompletionNote('');
      setGatePrompt({ task, targetStatus: 'TESTING', type: 'NOTE' });
      return;
    }
    if (task.status === 'TESTING' && newStatus === 'REVIEW') {
      setQaChecked({ test: false, ui: false, review: false });
      setGatePrompt({ task, targetStatus: 'REVIEW', type: 'QA' });
      return;
    }
    if (task.status === 'REVIEW' && newStatus === 'COMPLETED') {
      setSelectedReviewerId(null);
      setGatePrompt({ task, targetStatus: 'COMPLETED', type: 'REVIEWER' });
      return;
    }

    // Intercept with dialog prompt if dragging backward
    const currentIdx = STAGE_ORDER.indexOf(task.status);
    const targetIdx = STAGE_ORDER.indexOf(newStatus);
    if (targetIdx < currentIdx) {
      setSendBackReason('');
      setGatePrompt({ task, targetStatus: newStatus, type: 'SENDBACK' });
      return;
    }

    // Immediate commit for straightforward steps (Backlog -> Todo, Todo -> InProgress)
    commitTransition(task, newStatus);
  };

  const commitTransition = async (task: Task, targetStatus: string, note: string = '', reviewer: any = null) => {
    const historyNote = note ? `Reason/Note: "${note}"` : '';
    const userDisplayName = user?.name || 'Alice Smith';
    const logDetails = `Task "${task.title}" moved from ${task.status.replace('_', ' ')} to ${targetStatus.replace('_', ' ')} by ${userDisplayName}. ${historyNote}`;

    const updatedTask = {
      ...task,
      status: targetStatus,
      reviewer: reviewer || task.reviewer
    };

    // Optimistic UI updates
    setTasks(tasks.map(t => t.id === task.id ? updatedTask : t));

    try {
      // Save status modifications in database
      await api.put(`/api/tasks/${task.id}`, updatedTask);
      
      // Save audit log to system activity stream
      await api.post('/api/logs', {
        action: 'UPDATE',
        details: logDetails
      });

      // Post audit comment inside task collaboration stream (Audit Trail)
      await api.post(`/api/tasks/${task.id}/comments`, {
        content: `🚨 [System Log] Transitioned to ${targetStatus.replace('_', ' ')}. ${note ? `Note: "${note}"` : ''}`
      });

      // Confetti on completed signoff
      if (targetStatus === 'COMPLETED') {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      }

      fetchTasks();
    } catch (err) {
      console.error('Failed to commit task progression', err);
    }
  };

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gatePrompt) return;

    const { task, targetStatus, type } = gatePrompt;

    if (type === 'NOTE') {
      if (!completionNote.trim()) return;
      commitTransition(task, targetStatus, `Completion note: ${completionNote}`);
    } else if (type === 'QA') {
      if (!qaChecked.test || !qaChecked.ui || !qaChecked.review) return;
      commitTransition(task, targetStatus, 'QA checklist verified & passed successfully.');
    } else if (type === 'REVIEWER') {
      if (!selectedReviewerId) return;
      const reviewer = usersList.find(u => u.id === selectedReviewerId);
      if (!reviewer) return;
      
      // Double check self-approval block
      if (task.assignee && reviewer.id === task.assignee.id) {
        showToast('Self-approval blocked. Assignee cannot approve their own task.', 'warning');
        return;
      }
      commitTransition(task, targetStatus, 'Review signed off and completed.', reviewer);
    } else if (type === 'SENDBACK') {
      if (!sendBackReason.trim()) return;
      commitTransition(task, targetStatus, `Sent back: ${sendBackReason}`);
    }

    setGatePrompt(null);
  };

  const openTaskDetail = (task: Task) => {
    window.dispatchEvent(new CustomEvent('open-task-detail', { detail: task }));
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-h-[calc(100vh-100px)] flex flex-col relative pb-16">
      {/* Title Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 flex-shrink-0 w-full min-w-0">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-800 dark:text-white">
            Kanban Boards
          </h1>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
            Gated Workflow: Plan ➔ Work ➔ Build ➔ QA ➔ Sign-Off ➔ Complete.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {user?.role === 'ROLE_EMPLOYEE' && (
            <label className="flex items-center gap-2 text-xs font-black text-slate-700 dark:text-slate-300 cursor-pointer bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-xl px-3.5 py-2">
              <input
                type="checkbox"
                checked={showMyTasksOnly}
                onChange={(e) => setShowMyTasksOnly(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
              />
              🧑 My Tasks Only
            </label>
          )}

          <div className="relative flex-1 sm:flex-initial max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Filter board tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-xl text-slate-800 dark:text-white outline-none focus:border-blue-500/50 transition-all font-semibold text-xs w-full sm:w-48"
            />
          </div>

          {isTeamLeader && (
            <button
              onClick={() => setTaskModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-500/10 cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
            >
              <Plus className="w-4 h-4" /> Add Task
            </button>
          )}
        </div>
      </div>

      {/* Searchable Project Selector */}
      <div className="relative w-full max-w-xs space-y-1.5 flex-shrink-0">
        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Select Project Workspace:</label>
        <div className="relative">
          <input
            type="text"
            className="w-full pl-9 pr-10 py-2.5 bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-xl text-slate-800 dark:text-white outline-none focus:border-blue-500/50 transition-all font-bold text-xs cursor-pointer"
            placeholder="Select Project"
            value={
              isProjectFocused
                ? projectSearchQuery
                : (projectsList.find(p => p.id === activeProjectId)
                    ? `📁 ${projectsList.find(p => p.id === activeProjectId).name}`
                    : '')
            }
            onFocus={() => {
              setIsProjectDropdownOpen(true);
              setIsProjectFocused(true);
              setProjectSearchQuery('');
            }}
            onBlur={() => {
              setTimeout(() => {
                setIsProjectDropdownOpen(false);
                setIsProjectFocused(false);
                setProjectSearchQuery('');
              }, 200);
            }}
            onChange={(e) => {
              setProjectSearchQuery(e.target.value);
              setIsProjectDropdownOpen(true);
            }}
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
            <span className="text-slate-400 text-[9px]">▼</span>
          </div>

          {/* Floating Dropdown Suggestion List */}
          {isProjectDropdownOpen && (
            <div className="absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto glass-panel border border-slate-200/50 dark:border-white/5 shadow-2xl z-40 rounded-xl py-1">
              {projectsList.filter(p => p.name.toLowerCase().includes(projectSearchQuery.toLowerCase())).length === 0 ? (
                <div className="px-4 py-2.5 text-xs text-slate-400">No projects found</div>
              ) : (
                projectsList.filter(p => p.name.toLowerCase().includes(projectSearchQuery.toLowerCase())).map(p => {
                  const isActive = p.id === activeProjectId;
                  return (
                    <button
                      key={p.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => {
                        setActiveProjectId(p.id);
                        setIsProjectDropdownOpen(false);
                        setIsProjectFocused(false);
                        setProjectSearchQuery('');
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-black uppercase transition-colors flex items-center gap-2 cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-white/10 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span>📁</span>
                      <span className="truncate">{p.name}</span>
                      {isActive && <span className="ml-auto">✓</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Columns Container */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-x-auto pb-4 flex gap-4 sm:gap-6 items-start h-full mt-4 min-h-0 custom-scrollbar overscroll-x-contain">
          {COLUMNS.map(col => {
            const isEmployeeRole = user?.role === 'ROLE_EMPLOYEE';
            const colTasks = tasks.filter(t => {
              const isMyTask = t.assignee && (t.assignee.id === user?.id || t.assignee.name === user?.name);
              // Employees strictly see ONLY their own assigned tasks. Team leaders see ALL team tasks.
              if (isEmployeeRole) {
                if (!isMyTask) return false;
              } else if (showMyTasksOnly && !isMyTask) {
                return false;
              }
              if (!t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
              const taskStatus = t.status ? t.status.toUpperCase() : '';
              if (col.id === 'TO_DO') {
                return taskStatus === 'TO_DO' || taskStatus === 'TODO' || taskStatus === 'ACCEPTED';
              }
              if (col.id === 'IN_PROGRESS') {
                return taskStatus === 'IN_PROGRESS' || taskStatus === 'INPROGRESS';
              }
              return taskStatus === col.id;
            });
            return (
              <KanbanColumn 
                key={col.id} 
                column={col} 
                tasks={colTasks} 
                onCardClick={openTaskDetail} 
                onActionClick={handleActionClick}
                onSendBackClick={handleSendBack}
                isTeamLeader={isTeamLeader}
              />
            );
          })}
        </div>
      </DndContext>

      {/* Gated Input Dialog Prompts Modal */}
      {gatePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 touch-none overscroll-contain select-none">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm touch-none overscroll-none" onClick={() => setGatePrompt(null)}></div>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="glass-panel w-full max-w-sm max-h-[88vh] overflow-y-auto p-6 shadow-2xl relative border border-slate-200/50 dark:border-white/10 z-50 modal-dialog-contain overscroll-contain"
          >
            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2 mb-3">
              <CheckSquare className="w-5 h-5 text-blue-500" />
              {gatePrompt.type === 'SENDBACK' ? 'Regression: Send Task Back' : 'Workflow Gate Validation'}
            </h3>
            
            <p className="text-[10px] text-slate-400 font-bold mb-4 uppercase">
              Task: {gatePrompt.task.title}
            </p>

            <form onSubmit={handlePromptSubmit} className="space-y-4">
              {gatePrompt.type === 'NOTE' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Completion Note</label>
                  <textarea
                    required
                    placeholder="Outlining what was completed and built..."
                    value={completionNote}
                    onChange={(e) => setCompletionNote(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-xl text-slate-800 dark:text-white outline-none focus:border-blue-500/50 transition-all font-semibold text-xs h-20 resize-none"
                  ></textarea>
                </div>
              )}

              {gatePrompt.type === 'QA' && (
                <div className="space-y-2.5">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">QA Verification Checks</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qaChecked.test}
                        onChange={(e) => setQaChecked({ ...qaChecked, test: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                      />
                      Code runs without error warnings
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qaChecked.ui}
                        onChange={(e) => setQaChecked({ ...qaChecked, ui: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                      />
                      UI responsiveness & colors verified
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qaChecked.review}
                        onChange={(e) => setQaChecked({ ...qaChecked, review: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                      />
                      Functional integration flow passed
                    </label>
                  </div>
                </div>
              )}

              {gatePrompt.type === 'REVIEWER' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Assign Reviewer</label>
                    <LuxurySelect
                      value={selectedReviewerId || ''}
                      onChange={(val) => setSelectedReviewerId(val ? Number(val) : null)}
                      placeholder="Select Reviewer..."
                      options={usersList.map(u => ({
                        value: String(u.id),
                        label: u.name,
                        subLabel: u.designation ? u.designation.replace(/Devoloper/g, 'Developer') : undefined,
                        icon: (
                          <img
                            src={resolveAvatar(u.profilePhoto, u.name, u.gender)}
                            alt=""
                            className="w-4.5 h-4.5 rounded-full object-cover ring-1 ring-white/20"
                          />
                        )
                      }))}
                    />
                  </div>

                  {/* Warn if self-approval */}
                  {selectedReviewerId && gatePrompt.task.assignee && selectedReviewerId === gatePrompt.task.assignee.id && (
                    <div className="p-2 bg-red-500/10 border border-red-500/25 rounded-xl flex items-start gap-1.5 text-[9px] font-black text-red-500 uppercase leading-normal">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      Self-approval blocked. Assignee cannot review their own work. Please select a different reviewer.
                    </div>
                  )}
                </div>
              )}

              {gatePrompt.type === 'SENDBACK' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Regression Reason</label>
                  <textarea
                    required
                    placeholder="Describe bugs or QA issues found..."
                    value={sendBackReason}
                    onChange={(e) => setSendBackReason(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-xl text-slate-800 dark:text-white outline-none focus:border-blue-500/50 transition-all font-semibold text-xs h-20 resize-none"
                  ></textarea>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setGatePrompt(null)}
                  className="px-3.5 py-2 border border-slate-200/50 dark:border-white/5 rounded-xl hover:bg-white/10 text-slate-500 dark:text-slate-400 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    (gatePrompt.type === 'QA' && (!qaChecked.test || !qaChecked.ui || !qaChecked.review)) ||
                    (gatePrompt.type === 'REVIEWER' && (!selectedReviewerId || (gatePrompt.task.assignee && selectedReviewerId === gatePrompt.task.assignee.id)))
                  }
                  className="px-4 py-2 bg-blue-600 disabled:opacity-40 hover:bg-blue-500 text-white rounded-xl font-bold text-xs cursor-pointer transition-colors"
                >
                  Confirm Gate
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// Kanban Column component
interface ColumnProps {
  column: Column;
  tasks: Task[];
  onCardClick: (task: Task) => void;
  onActionClick: (task: Task) => void;
  onSendBackClick: (task: Task) => void;
  isTeamLeader: boolean;
}

function KanbanColumn({ column, tasks, onCardClick, onActionClick, onSendBackClick, isTeamLeader }: ColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
  });

  const { setTaskModalOpen } = useUIStore();

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-[280px] xs:w-80 max-h-full rounded-2xl border-t-4 border border-slate-200/50 dark:border-white/5 p-4 flex flex-col ${column.color}`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">{column.title}</span>
          <span className="text-[10px] font-black px-2 py-0.5 bg-slate-200 dark:bg-white/5 text-slate-500 dark:text-slate-400 rounded-full">
            {tasks.length}
          </span>
        </div>

        {/* Quick Add Task Button for Column */}
        {isTeamLeader && (
          <button
            type="button"
            onClick={() => setTaskModalOpen(true, column.id)}
            className="w-5.5 h-5.5 flex items-center justify-center rounded-lg border border-slate-200/50 dark:border-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
            title={`Add task directly to ${column.title}`}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Cards Stack */}
      <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
        {tasks.length === 0 ? (
          <div className="py-12 text-center text-[10px] font-bold text-slate-400 border border-dashed border-slate-300/40 dark:border-white/5 rounded-xl">
            Drop task cards here
          </div>
        ) : (
          tasks.map(task => (
            <KanbanCard 
              key={task.id} 
              task={task} 
              onClick={() => onCardClick(task)} 
              onActionClick={onActionClick}
              onSendBackClick={onSendBackClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Kanban Card component
interface CardProps {
  task: Task;
  onClick: () => void;
  onActionClick: (task: Task) => void;
  onSendBackClick: (task: Task) => void;
}

function KanbanCard({ task, onClick, onActionClick, onSendBackClick }: CardProps) {
  const { setTaskModalOpen } = useUIStore();
  const { user } = useAuthStore();
  const isTeamLeader = user?.role === 'ROLE_ADMIN' || user?.role === 'ROLE_MANAGER';
  const isAssignee = task.assignee && task.assignee.id === user?.id;
  const canEdit = isTeamLeader || isAssignee;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: task,
    disabled: !canEdit,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 50,
  } : undefined;

  // Determine stage action button specs
  const getActionSpecs = () => {
    if (!canEdit && task.status !== 'COMPLETED') {
      return { 
        label: '🔒 Locked (Assignee Only)', 
        color: 'bg-slate-100 dark:bg-white/5 text-slate-400/50 cursor-not-allowed', 
        disabled: true 
      };
    }
    switch (task.status) {
      case 'BACKLOG':
        return { label: 'Plan Task', color: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:opacity-90' };
      case 'TO_DO':
        return { label: 'Start Work', color: 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90' };
      case 'IN_PROGRESS':
        return { label: 'Mark Built', color: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90' };
      case 'TESTING':
        return { label: 'Analyze / QA', color: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:opacity-90' };
      case 'REVIEW':
        return { label: 'Approve & Complete', color: 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:opacity-90' };
      case 'COMPLETED':
      default:
        return { label: '🔒 Signed Off', color: 'bg-slate-200 dark:bg-white/5 text-slate-400 cursor-not-allowed', disabled: true };
    }
  };

  const buttonSpecs = getActionSpecs();
  const showSendBack = canEdit && task.status !== 'BACKLOG' && task.status !== 'COMPLETED';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`glass-panel p-4 flex flex-col gap-3.5 hover:border-blue-500/30 transition-all select-none border border-slate-200/50 dark:border-white/5 cursor-pointer relative ${
        isDragging ? 'opacity-30 border-blue-500 border-dashed' : ''
      }`}
    >
      <div className="space-y-1">
        <div className="flex justify-between items-start">
          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${
            task.priority === 'CRITICAL' || task.priority === 'URGENT' ? 'bg-red-500/10 text-red-500' :
            task.priority === 'HIGH' ? 'bg-amber-500/10 text-amber-500' :
            task.priority === 'MEDIUM' ? 'bg-blue-500/10 text-blue-500' :
            'bg-slate-500/10 text-slate-500'
          }`}>
            {task.priority}
          </span>
          
          <div className="flex items-center gap-1.5">
            {/* Watch/Eye icon */}
            <button 
              type="button" 
              className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5 transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              title="View task details"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>

            {/* Edit icon */}
            {isTeamLeader ? (
              <button 
                type="button" 
                className="text-slate-400 hover:text-blue-500 p-0.5 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setTaskModalOpen(true, null, true, task);
                }}
                title="Edit task details"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="text-slate-400 cursor-not-allowed p-0.5" title="Only Team Leaders can edit this task.">
                🔒
              </span>
            )}
            
            {/* Send Back icon */}
            {showSendBack && (
              <button
                type="button"
                className="text-slate-400 hover:text-red-500 p-0.5 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSendBackClick(task);
                }}
                title="Send back one stage"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            )}
            
            {/* Grip Handle for Drag and Drop operations */}
            {canEdit && (
              <div
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-0.5 cursor-grab active:cursor-grabbing"
                title="Drag Card"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        </div>
        <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 line-clamp-1">{task.title}</h4>
        <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">{task.description}</p>
      </div>

      {/* Progress subtasks bar */}
      {task.subtasksCount && task.subtasksCount > 0 ? (
        <div className="space-y-1">
          <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
            <span>Checklist</span>
            <span>{task.completedSubtasksCount || 0}/{task.subtasksCount}</span>
          </div>
          <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${((task.completedSubtasksCount || 0) / task.subtasksCount) * 100}%` }}
            ></div>
          </div>
        </div>
      ) : null}

      {/* Card Info Details */}
      <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 border-t border-slate-200/30 dark:border-white/5 pt-2.5">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" /> {task.dueDate}
        </span>

        <div className="flex items-center gap-2">
          {task.estimatedTime > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="w-3 h-3" /> {task.estimatedTime}h
            </span>
          )}
          {task.assignee && (
            <img
              src={resolveAvatar(task.assignee.profilePhoto, task.assignee.name, (task.assignee as any).gender)}
              alt="assignee"
              className="w-4.5 h-4.5 rounded-full object-cover ring-1 ring-blue-500/20"
              title={`Assignee: ${task.assignee.name}`}
            />
          )}
          {task.reviewer && (
            <img
              src={resolveAvatar(task.reviewer.profilePhoto, task.reviewer.name, (task.reviewer as any).gender)}
              alt="reviewer"
              className="w-4.5 h-4.5 rounded-full object-cover ring-1 ring-purple-500/20 border border-purple-500/50"
              title={`Reviewer: ${task.reviewer.name}`}
            />
          )}
        </div>
      </div>

      {/* Stage-Gated Progression Action Button */}
      <div className="pt-2 border-t border-slate-200/20 dark:border-white/5">
        <button
          type="button"
          disabled={buttonSpecs.disabled}
          onClick={(e) => {
            e.stopPropagation();
            onActionClick(task);
          }}
          className={`w-full py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 ${buttonSpecs.color}`}
        >
          {task.status === 'COMPLETED' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : null}
          {buttonSpecs.label}
        </button>
      </div>
    </div>
  );
}
