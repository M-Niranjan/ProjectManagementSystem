import { Response } from 'express';
import { Task, Project, User, Comment, Notification, DirectMessage, Role, Attachment } from '../models';
import { AuthRequest } from '../middleware/auth';
import { AIService } from '../services/aiService';
import { Op } from 'sequelize';
import { firebaseFirestore, FieldValue, FirebaseAdminService } from '../config/firebaseAdmin';
import { NotificationService } from '../services/notificationService';

export class TaskController {
  public static async getAllTasks(req: AuthRequest, res: Response) {
    try {
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string);
      const projectWhere: any = {};
      if (targetOrgId) {
        projectWhere.organizationId = targetOrgId;
      }

      const tasks = await Task.findAll({
        include: [
          {
            model: Project,
            as: 'project',
            where: Object.keys(projectWhere).length ? projectWhere : undefined,
          },
          { model: User, as: 'assignee', attributes: { exclude: ['password'] } },
          { model: User, as: 'creator', attributes: { exclude: ['password'] } },
          { model: User, as: 'reviewer', attributes: { exclude: ['password'] } },
        ],
        order: [['createdAt', 'DESC']],
      });
      return res.json(tasks);
    } catch (err: any) {
      console.error('Error in getAllTasks:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async getProjectTasks(req: AuthRequest, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId);
      const tasks = await Task.findAll({
        where: { projectId },
        include: [
          { model: Project, as: 'project' },
          { model: User, as: 'assignee', attributes: { exclude: ['password'] } },
          { model: User, as: 'creator', attributes: { exclude: ['password'] } },
        ],
        order: [['createdAt', 'DESC']],
      });
      return res.json(tasks);
    } catch (err: any) {
      console.error('Error in getProjectTasks:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async getTaskById(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id);
      const task = await Task.findByPk(id, {
        include: [
          { model: Project, as: 'project' },
          { model: User, as: 'assignee', attributes: { exclude: ['password'] } },
          { model: User, as: 'creator', attributes: { exclude: ['password'] } },
          { model: Task, as: 'subtasks' },
          { model: Task, as: 'dependencies', through: { attributes: [] } },
        ],
      });
      if (!task) return res.status(404).send('Task not found');
      return res.json(task);
    } catch (err: any) {
      console.error('Error in getTaskById:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async createTask(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).send('Unauthorized');

      const creatorId = req.user.id;
      const { title, description, status, priority, dueDate, estimatedTime, projectId, assigneeId, parentId } = req.body;

      const resolvedProjectId = projectId || (req.body.project ? req.body.project.id : null);
      if (!resolvedProjectId) {
        return res.status(400).send('Project ID is required');
      }

      const project = await Project.findByPk(resolvedProjectId);
      if (!project) return res.status(404).send('Project not found');

      let taskPriority = priority;
      if (!taskPriority) {
        taskPriority = AIService.predictPriority(title, description);
      }

      let taskEstTime = estimatedTime;
      const resolvedAssigneeId = assigneeId || (req.body.assignee ? req.body.assignee.id : null);
      if (!taskEstTime || Number(taskEstTime) === 0) {
        let experience = 2;
        if (resolvedAssigneeId) {
          const assigneeUser = await User.findByPk(resolvedAssigneeId);
          if (assigneeUser) experience = assigneeUser.experience || 2;
        }
        taskEstTime = AIService.estimateDuration(title, description, experience);
      }

      let taskStatus = status || 'TO_DO';
      if (resolvedAssigneeId) {
        const assigneeUser = await User.findByPk(resolvedAssigneeId);
        if (assigneeUser && assigneeUser.role === Role.ROLE_EMPLOYEE && taskStatus !== 'COMPLETED') {
          taskStatus = 'PENDING_ACCEPTANCE';
        }
      }

      const task = await Task.create({
        title: title || 'New Task',
        description,
        status: taskStatus,
        priority: taskPriority,
        dueDate,
        estimatedTime: Number(taskEstTime || 0),
        actualTime: 0.0,
        projectId: resolvedProjectId,
        assigneeId: resolvedAssigneeId || null,
        creatorId,
        parentTaskId: parentId ? Number(parentId) : null,
      });

      if (resolvedAssigneeId) {
        const assigneeUser = await User.findByPk(resolvedAssigneeId);
        if (assigneeUser) {
          const taskOrgId = project.organizationId || req.organizationId || 'org_default';
          await NotificationService.sendNotification({
            recipientUid: (assigneeUser as any).uid || String(assigneeUser.id),
            recipientId: assigneeUser.id,
            recipientEmail: assigneeUser.email,
            senderUid: req.firebaseUid || String(req.user.id),
            senderName: req.user.name || 'Team Leader',
            organizationId: taskOrgId,
            type: 'TASK_ASSIGNED',
            title: 'New Task Assigned',
            message: `"${task.title}" was assigned to you by ${req.user.name || 'Team Leader'}.`,
            entityId: task.id,
            entityType: 'task',
            taskId: task.id,
            projectId: project.id,
            actionUrl: `/tasks?taskId=${task.id}`,
            eventId: `TASK_${task.id}_ASSIGNED_${(assigneeUser as any).uid || assigneeUser.id}`,
          });

          await DirectMessage.create({
            content: `Hello, I have assigned you a new task: "${task.title}". Please review and accept it.`,
            senderId: creatorId,
            recipientId: assigneeUser.id,
            taskId: task.id,
            isRead: false,
          });
        }
      }

      const savedTask = await Task.findByPk(task.id, {
        include: [
          { model: Project, as: 'project' },
          { model: User, as: 'assignee', attributes: { exclude: ['password'] } },
          { model: User, as: 'creator', attributes: { exclude: ['password'] } },
        ],
      });

      // Synchronize and persist directly to Firebase Firestore
      try {
        await FirebaseAdminService.createFirestoreTask(task.id, {
          id: String(task.id),
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          estimatedTime: task.estimatedTime,
          actualTime: task.actualTime,
          projectId: String(task.projectId),
          organizationId: project.organizationId || req.organizationId || 'org_default',
          assigneeId: task.assigneeId,
          creatorId: task.creatorId,
          assignee: (savedTask as any)?.assignee ? { id: (savedTask as any).assignee.id, name: (savedTask as any).assignee.name, email: (savedTask as any).assignee.email } : null,
          creator: (savedTask as any)?.creator ? { id: (savedTask as any).creator.id, name: (savedTask as any).creator.name, email: (savedTask as any).creator.email } : null,
          createdAt: task.createdAt,
        });

        await FirebaseAdminService.createFirestoreAuditLog({
          user: req.user?.name || 'Administrator',
          action: 'TASK_ASSIGNED',
          activity: `${req.user?.name || 'User'} assigned task "${task.title}"`,
          status: 'VERIFIED',
          organizationId: project.organizationId || req.organizationId || 'org_default',
          userId: req.user?.id,
        });
      } catch (fErr) {
        console.warn('Firestore task sync warning:', fErr);
      }

      return res.status(201).json(savedTask);
    } catch (err: any) {
      console.error('Error in createTask:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async updateTask(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).send('Unauthorized');

      const id = parseInt(req.params.id);
      const task = await Task.findByPk(id);
      if (!task) return res.status(404).send('Task not found');

      const isTeamLeader = req.user.role === Role.ROLE_ADMIN || req.user.role === Role.ROLE_MANAGER;

      let isAssignee = task.assigneeId === req.user.id;
      if (!isAssignee && task.assigneeId) {
        const assigneeUser = await User.findByPk(task.assigneeId).catch(() => null);
        if (assigneeUser && req.user.email && assigneeUser.email.toLowerCase() === req.user.email.toLowerCase()) {
          isAssignee = true;
        }
      }

      if (!isTeamLeader && !isAssignee) {
        return res.status(403).send('Only the assigned member or Team Leader can update this task.');
      }

      const oldStatus = task.status;
      const oldAssigneeId = task.assigneeId;
      const incomingStatus = req.body.status;

      // Duplicate acceptance guard
      if ((incomingStatus === 'ACCEPTED' || incomingStatus === 'TO_DO') && oldStatus === 'ACCEPTED') {
        const assigneeObj = oldAssigneeId ? await User.findByPk(oldAssigneeId) : null;
        return res.status(400).send(`Task has already been accepted by ${assigneeObj ? assigneeObj.name : 'the assignee'}.`);
      }

      const { title, description, priority, dueDate, estimatedTime, actualTime, recurring, recurringPattern, declineReason, assignee, assigneeId } = req.body;

      if (title !== undefined) task.title = title;
      if (description !== undefined) task.description = description;
      if (incomingStatus !== undefined) task.status = incomingStatus;
      if (priority !== undefined) task.priority = priority;
      if (dueDate !== undefined) task.dueDate = dueDate;
      if (estimatedTime !== undefined) task.estimatedTime = Number(estimatedTime);
      if (actualTime !== undefined) task.actualTime = Number(actualTime);
      if (recurring !== undefined) task.recurring = recurring;
      if (recurringPattern !== undefined) task.recurringPattern = recurringPattern;
      if (declineReason !== undefined) task.declineReason = declineReason;

      if (incomingStatus === 'ACCEPTED' && oldStatus === 'PENDING_ACCEPTANCE') {
        task.acceptedAt = new Date();
      }

      const resolvedAssigneeId = assigneeId !== undefined ? assigneeId : (assignee ? assignee.id : undefined);
      const taskOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || 'org_default';

      if (resolvedAssigneeId !== undefined) {
        if (resolvedAssigneeId === null) {
          task.assigneeId = null;
        } else {
          const newAssignee = await User.findByPk(resolvedAssigneeId);
          if (newAssignee) {
            task.assigneeId = newAssignee.id;
            if (oldAssigneeId !== newAssignee.id) {
              if (newAssignee.role === Role.ROLE_EMPLOYEE && incomingStatus !== 'COMPLETED') {
                task.status = 'PENDING_ACCEPTANCE';
              }
              await NotificationService.sendNotification({
                recipientUid: (newAssignee as any).uid || String(newAssignee.id),
                recipientId: newAssignee.id,
                recipientEmail: newAssignee.email,
                senderUid: req.firebaseUid || String(req.user.id),
                senderName: req.user.name || 'Team Leader',
                organizationId: taskOrgId,
                type: 'TASK_ASSIGNED',
                title: 'New Task Assigned',
                message: `"${task.title}" was assigned to you by ${req.user.name || 'Team Leader'}.`,
                entityId: task.id,
                entityType: 'task',
                taskId: task.id,
                projectId: task.projectId,
                actionUrl: `/tasks?taskId=${task.id}`,
                eventId: `TASK_${task.id}_REASSIGNED_${newAssignee.id}`,
              });

              await DirectMessage.create({
                content: `Hello, I have assigned you a new task: "${task.title}". Please review and accept it.`,
                senderId: req.user.id,
                recipientId: newAssignee.id,
                taskId: task.id,
                isRead: false,
              });
            }
          }
        }
      }

      await task.save();

      // Notifications on state transition
      if (oldStatus === 'PENDING_ACCEPTANCE' && (task.status === 'ACCEPTED' || task.status === 'TO_DO') && oldAssigneeId) {
        // Auto-dismiss TASK_ASSIGNED notifications
        await Notification.update({ isRead: true }, {
          where: {
            recipientId: oldAssigneeId,
            type: 'TASK_ASSIGNED',
            message: { [Op.like]: `%${task.title}%` },
          },
        });

        const oldAssigneeObj = await User.findByPk(oldAssigneeId);
        await DirectMessage.create({
          content: `I have accepted the task: "${task.title}".`,
          senderId: oldAssigneeId,
          recipientId: task.creatorId,
          taskId: task.id,
          isRead: false,
        });

        await NotificationService.sendNotification({
          recipientId: task.creatorId,
          senderUid: req.firebaseUid || String(req.user.id),
          senderName: oldAssigneeObj?.name || req.user.name || 'Assignee',
          organizationId: taskOrgId,
          type: 'TASK_ACCEPTED',
          title: 'Task Accepted',
          message: `${oldAssigneeObj?.name || 'Assignee'} accepted task: "${task.title}".`,
          entityId: task.id,
          entityType: 'task',
          taskId: task.id,
          projectId: task.projectId,
          actionUrl: `/tasks?taskId=${task.id}`,
          eventId: `TASK_${task.id}_ACCEPTED_${Date.now()}`,
        });
      }

      if (oldStatus === 'PENDING_ACCEPTANCE' && (task.status === 'BACKLOG' || task.status === 'DECLINED') && oldAssigneeId) {
        const oldAssigneeObj = await User.findByPk(oldAssigneeId);
        let reason = declineReason || 'No reason provided.';
        if (!reason.startsWith(oldAssigneeObj?.name || '')) {
          reason = `${oldAssigneeObj?.name || 'Assignee'}: ${reason}`;
        }
        task.declineReason = reason;
        await task.save();

        await DirectMessage.create({
          content: `I have declined the task: "${task.title}". Reason: ${reason}`,
          senderId: oldAssigneeId,
          recipientId: task.creatorId,
          taskId: task.id,
          isRead: false,
        });

        await NotificationService.sendNotification({
          recipientId: task.creatorId,
          senderUid: req.firebaseUid || String(req.user.id),
          senderName: oldAssigneeObj?.name || req.user.name || 'Assignee',
          organizationId: taskOrgId,
          type: 'TASK_DECLINED',
          title: 'Task Declined',
          message: `${oldAssigneeObj?.name || 'Assignee'} declined task: "${task.title}". Reason: ${reason}`,
          entityId: task.id,
          entityType: 'task',
          taskId: task.id,
          projectId: task.projectId,
          actionUrl: `/tasks?taskId=${task.id}`,
          eventId: `TASK_${task.id}_DECLINED_${Date.now()}`,
        });
      }

      if (task.status === 'COMPLETED' && oldStatus !== 'COMPLETED') {
        await NotificationService.sendNotification({
          recipientId: task.creatorId,
          senderUid: req.firebaseUid || String(req.user.id),
          senderName: req.user.name || 'Team Member',
          organizationId: taskOrgId,
          type: 'TASK_COMPLETED',
          title: 'Task Completed',
          message: `The task "${task.title}" has been marked complete.`,
          entityId: task.id,
          entityType: 'task',
          taskId: task.id,
          projectId: task.projectId,
          actionUrl: `/tasks?taskId=${task.id}`,
          eventId: `TASK_${task.id}_COMPLETED_${Date.now()}`,
        });
      }

      const updatedTask = await Task.findByPk(id, {
        include: [
          { model: Project, as: 'project' },
          { model: User, as: 'assignee', attributes: { exclude: ['password'] } },
          { model: User, as: 'creator', attributes: { exclude: ['password'] } },
        ],
      });

      // Synchronize update to Firebase Firestore
      try {
        await FirebaseAdminService.updateFirestoreTask(id, {
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          estimatedTime: task.estimatedTime,
          actualTime: task.actualTime,
          assigneeId: task.assigneeId,
          reviewerId: task.reviewerId,
          declineReason: task.declineReason,
          assignee: (updatedTask as any)?.assignee ? { id: (updatedTask as any).assignee.id, name: (updatedTask as any).assignee.name, email: (updatedTask as any).assignee.email } : null,
        });
      } catch (fErr) {
        console.warn('Firestore task update warning:', fErr);
      }

      return res.json(updatedTask);
    } catch (err: any) {
      console.error('Error in updateTask:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async deleteTask(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).send('Unauthorized');

      const id = parseInt(req.params.id);
      const task = await Task.findByPk(id);
      if (!task) return res.status(404).send('Task not found');

      if (req.user.role !== Role.ROLE_ADMIN && req.user.role !== Role.ROLE_MANAGER) {
        return res.status(403).send('Only Team Leaders can delete tasks.');
      }

      await task.destroy();

      // Synchronize deletion in Firebase Firestore
      try {
        await FirebaseAdminService.deleteFirestoreTask(id);
      } catch (fErr) {
        console.warn('Firestore task deletion warning:', fErr);
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error in deleteTask:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async getComments(req: AuthRequest, res: Response) {
    try {
      const taskId = parseInt(req.params.id);
      const comments = await Comment.findAll({
        where: { taskId },
        include: [{ model: User, as: 'user', attributes: { exclude: ['password'] } }],
        order: [['createdAt', 'ASC']],
      });
      return res.json(comments);
    } catch (err: any) {
      console.error('Error in getComments:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async addComment(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).send('Unauthorized');

      const taskId = parseInt(req.params.id);
      const { content } = req.body;

      const task = await Task.findByPk(taskId);
      if (!task) return res.status(404).send('Task not found');

      const comment = await Comment.create({
        content: content || '',
        taskId,
        userId: req.user.id,
      });

      const taskOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || 'org_default';

      // 1. Check for @mentions in comment
      const mentionMatches = (content || '').match(/@([\w.-]+)/g);
      if (mentionMatches && mentionMatches.length > 0) {
        for (const match of mentionMatches) {
          const mentionName = match.replace('@', '').toLowerCase();
          const mentionedUser = await User.findOne({
            where: {
              name: { [Op.like]: `%${mentionName}%` }
            }
          });
          if (mentionedUser && mentionedUser.id !== req.user.id) {
            await NotificationService.sendNotification({
              recipientUid: (mentionedUser as any).uid || String(mentionedUser.id),
              recipientId: mentionedUser.id,
              recipientEmail: mentionedUser.email,
              senderUid: req.firebaseUid || String(req.user.id),
              senderName: req.user.name || 'User',
              organizationId: taskOrgId,
              type: 'TASK_MENTION',
              title: 'You were mentioned in a task comment',
              message: `${req.user.name || 'User'} mentioned you on "${task.title}": "${content.slice(0, 100)}"`,
              entityId: task.id,
              entityType: 'task',
              taskId: task.id,
              projectId: task.projectId,
              actionUrl: `/tasks?taskId=${task.id}`,
            });
          }
        }
      }

      // 2. Notify task assignee if not the commenter
      if (task.assigneeId && task.assigneeId !== req.user.id) {
        await NotificationService.sendNotification({
          recipientId: task.assigneeId,
          senderUid: req.firebaseUid || String(req.user.id),
          senderName: req.user.name || 'User',
          organizationId: taskOrgId,
          type: 'TASK_COMMENT',
          title: 'New Comment on Task',
          message: `${req.user.name || 'User'} commented on "${task.title}": "${(content || '').slice(0, 100)}"`,
          entityId: task.id,
          entityType: 'task',
          taskId: task.id,
          projectId: task.projectId,
          actionUrl: `/tasks?taskId=${task.id}`,
        });
      }

      // 3. Notify task creator if different from commenter and assignee
      if (task.creatorId && task.creatorId !== req.user.id && task.creatorId !== task.assigneeId) {
        await NotificationService.sendNotification({
          recipientId: task.creatorId,
          senderUid: req.firebaseUid || String(req.user.id),
          senderName: req.user.name || 'User',
          organizationId: taskOrgId,
          type: 'TASK_COMMENT',
          title: 'New Comment on Task',
          message: `${req.user.name || 'User'} commented on "${task.title}": "${(content || '').slice(0, 100)}"`,
          entityId: task.id,
          entityType: 'task',
          taskId: task.id,
          projectId: task.projectId,
          actionUrl: `/tasks?taskId=${task.id}`,
        });
      }

      const fullComment = await Comment.findByPk(comment.id, {
        include: [{ model: User, as: 'user', attributes: { exclude: ['password'] } }],
      });

      return res.json(fullComment);
    } catch (err: any) {
      console.error('Error in addComment:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async updateTimer(req: AuthRequest, res: Response) {
    try {
      const taskId = parseInt(req.params.id);
      const additionalHours = parseFloat(String(req.query.additionalHours || req.body.additionalHours || 0));

      const task = await Task.findByPk(taskId);
      if (!task) return res.status(404).send('Task not found');

      task.actualTime = (task.actualTime || 0) + additionalHours;
      await task.save();

      const project = await Project.findByPk(task.projectId);
      if (project) {
        project.spent = (project.spent || 0) + additionalHours * 50.0;
        await project.save();
      }

      return res.json(task);
    } catch (err: any) {
      console.error('Error in updateTimer:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async getAiSubtasks(req: AuthRequest, res: Response) {
    try {
      const taskId = parseInt(req.params.id);
      const task = await Task.findByPk(taskId);
      if (!task) return res.status(404).send('Task not found');

      const suggestions = AIService.suggestSubtasks(task.title, task.description);
      return res.json(suggestions);
    } catch (err: any) {
      console.error('Error in getAiSubtasks:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async addDependency(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id);
      const depId = parseInt(req.params.depId);

      const task = await Task.findByPk(id);
      const dependency = await Task.findByPk(depId);

      if (!task || !dependency) return res.status(404).send('Task or Dependency not found');

      await (task as any).addDependency(dependency);

      const updatedTask = await Task.findByPk(id, {
        include: [{ model: Task, as: 'dependencies', through: { attributes: [] } }],
      });

      return res.json(updatedTask);
    } catch (err: any) {
      console.error('Error in addDependency:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async removeDependency(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id);
      const depId = parseInt(req.params.depId);

      const task = await Task.findByPk(id);
      const dependency = await Task.findByPk(depId);

      if (!task || !dependency) return res.status(404).send('Task or Dependency not found');

      await (task as any).removeDependency(dependency);

      const updatedTask = await Task.findByPk(id, {
        include: [{ model: Task, as: 'dependencies', through: { attributes: [] } }],
      });

      return res.json(updatedTask);
    } catch (err: any) {
      console.error('Error in removeDependency:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async uploadTaskPdf(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required to submit task evidence.' });
      }

      const taskId = req.params.id;
      const stepId = req.params.stepId;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: 'Please select a valid PDF file to upload.' });
      }

      // 1. Strict PDF validation
      const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        return res.status(400).json({ message: 'Please upload a valid PDF file. Only PDF documents are accepted.' });
      }

      // 2. Validate user assignment / role permissions
      const task = await Task.findByPk(taskId, {
        include: [{ model: User, as: 'assignee', attributes: { exclude: ['password'] } }],
      });

      const userRole = req.user.role;
      const isPrivileged = userRole === Role.ROLE_ADMIN || userRole === Role.ROLE_MANAGER;

      if (!isPrivileged && task && task.assigneeId) {
        const isAssigned = task.assigneeId === req.user.id || (req.user.email && (task as any).assignee?.email?.toLowerCase() === req.user.email.toLowerCase());
        if (!isAssigned) {
          return res.status(403).json({ message: 'You are not authorized to submit evidence for this task.' });
        }
      }

      // 3. Compute download URL
      const host = req.get('host') || '192.168.29.230:8080';
      const protocol = req.protocol || 'http';
      const downloadUrl = `${protocol}://${host}/uploads/${file.filename}`;

      // 4. Determine Versioning from Firestore or SQLite
      let currentVersionNumber = 1;
      let existingSubmissions: any[] = [];

      if (firebaseFirestore) {
        try {
          const snapshot = await firebaseFirestore
            .collection('taskSubmissions')
            .where('taskId', '==', String(taskId))
            .where('stepId', '==', String(stepId))
            .get();

          existingSubmissions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          currentVersionNumber = existingSubmissions.length + 1;

          // Mark previous submissions as not latest
          if (!snapshot.empty) {
            const batch = firebaseFirestore.batch();
            snapshot.docs.forEach(doc => {
              batch.update(doc.ref, { isLatest: false });
            });
            await batch.commit();
          }
        } catch (fsErr) {
          console.warn('Firestore taskSubmissions query warning:', fsErr);
        }
      }

      const versionLabel = `Version ${currentVersionNumber}`;
      const submissionId = `sub_${taskId}_${stepId}_${Date.now()}`;

      const submissionData: any = {
        id: submissionId,
        taskId: String(taskId),
        stepId: String(stepId),
        employeeId: req.user.uid || String(req.user.id),
        employeeName: req.user.name || req.user.email?.split('@')[0] || 'Employee',
        employeeEmail: req.user.email,
        fileName: file.originalname,
        storedFileName: file.filename,
        fileSize: file.size,
        contentType: 'application/pdf',
        storagePath: `uploads/${file.filename}`,
        downloadUrl,
        uploadedAt: new Date().toISOString(),
        status: 'submitted',
        version: versionLabel,
        versionNumber: currentVersionNumber,
        isLatest: true,
      };

      // 5. Store in Firestore collection taskSubmissions
      if (firebaseFirestore) {
        try {
          await firebaseFirestore
            .collection('taskSubmissions')
            .doc(submissionId)
            .set({
              ...submissionData,
              serverTimestamp: FieldValue?.serverTimestamp ? FieldValue.serverTimestamp() : new Date().toISOString(),
            });
        } catch (fsWriteErr) {
          console.error('Error writing taskSubmission to Firestore:', fsWriteErr);
        }
      }

      // 6. Record in SQLite Attachment model as well
      try {
        await Attachment.create({
          fileName: file.originalname,
          fileUrl: downloadUrl,
          fileType: 'application/pdf',
          taskId: Number(taskId),
          uploadedById: req.user.id,
        });
      } catch (attErr) {
        console.warn('Error recording attachment in database:', attErr);
      }

      // 7. Dispatch Notification to the specific Team Leader / Task Creator only (NO BROADCAST)
      try {
        const taskObj: any = await Task.findByPk(taskId, {
          include: [{ model: Project, as: 'project' }]
        });
        const targetLeaderId = taskObj?.creatorId || taskObj?.project?.ownerId;
        const taskOrgId = taskObj?.project?.organizationId || req.organizationId || 'org_default';

        if (targetLeaderId) {
          await NotificationService.sendNotification({
            recipientId: targetLeaderId,
            senderUid: req.firebaseUid || String(req.user.id),
            senderName: req.user.name || 'Employee',
            organizationId: taskOrgId,
            type: 'TASK_SUBMITTED',
            title: 'Task Step PDF Evidence Submitted',
            message: `${submissionData.employeeName} uploaded ${file.originalname} (${versionLabel}) for Step #${stepId} on Task "${taskObj?.title || taskId}".`,
            entityId: taskId,
            entityType: 'document',
            taskId: Number(taskId),
            projectId: taskObj?.projectId,
            actionUrl: `/step-verification?taskId=${taskId}`,
          });
        }
      } catch (notifErr) {
        console.warn('Notification creation warning:', notifErr);
      }

      return res.status(201).json({
        success: true,
        message: 'Task PDF evidence uploaded successfully.',
        submission: submissionData,
      });
    } catch (err: any) {
      console.error('Error in uploadTaskPdf:', err);
      return res.status(500).json({ error: err.message || 'Unable to upload the document. Please try again.' });
    }
  }

  public static async getStepSubmissions(req: AuthRequest, res: Response) {
    try {
      const taskId = req.params.id;
      const stepId = req.params.stepId;

      let submissions: any[] = [];
      if (firebaseFirestore) {
        try {
          const snapshot = await firebaseFirestore
            .collection('taskSubmissions')
            .where('taskId', '==', String(taskId))
            .where('stepId', '==', String(stepId))
            .get();

          submissions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          submissions.sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
        } catch (fsErr) {
          console.warn('Error fetching Firestore taskSubmissions:', fsErr);
        }
      }

      return res.json(submissions);
    } catch (err: any) {
      console.error('Error in getStepSubmissions:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public static async reviewStepSubmission(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const userRole = req.user.role;
      if (userRole !== Role.ROLE_ADMIN && userRole !== Role.ROLE_MANAGER) {
        return res.status(403).json({ message: 'Only Team Leaders and Administrators can review task submissions.' });
      }

      const taskId = req.params.id;
      const stepId = req.params.stepId;
      const { action, notes, submissionId } = req.body;

      const newStatus = action === 'APPROVE' ? 'approved' : action === 'REQUEST_CHANGES' ? 'changes_requested' : 'rejected';

      if (firebaseFirestore && submissionId) {
        try {
          await firebaseFirestore.collection('taskSubmissions').doc(submissionId).update({
            status: newStatus,
            reviewerNotes: notes || '',
            reviewedBy: { id: req.user.id, name: req.user.name || 'Team Leader' },
            reviewedAt: new Date().toISOString(),
          });
        } catch (fsErr) {
          console.warn('Firestore update submission status warning:', fsErr);
        }
      }

      // Notify the employee only
      try {
        const task: any = await Task.findByPk(taskId, {
          include: [{ model: Project, as: 'project' }]
        });
        if (task && task.assigneeId) {
          const taskOrgId = task.project?.organizationId || req.organizationId || 'org_default';
          const isApproved = action === 'APPROVE';
          await NotificationService.sendNotification({
            recipientId: task.assigneeId,
            senderUid: req.firebaseUid || String(req.user.id),
            senderName: req.user.name || 'Team Leader',
            organizationId: taskOrgId,
            type: isApproved ? 'STEP_APPROVED' : 'CHANGES_REQUESTED',
            title: isApproved ? 'Task Step Approved!' : 'Changes Requested on Task Step',
            message: `Your submitted PDF for Step #${stepId} on "${task.title}" has been ${newStatus.replace('_', ' ')}.${notes ? ` Note: ${notes}` : ''}`,
            entityId: taskId,
            entityType: 'document',
            taskId: Number(taskId),
            projectId: task.projectId,
            actionUrl: `/step-verification?taskId=${taskId}`,
          });
        }
      } catch (notifErr) {
        console.warn('Review notification creation warning:', notifErr);
      }

      return res.json({
        success: true,
        action,
        status: newStatus,
        message: `Step submission has been ${newStatus.replace('_', ' ')}.`,
      });
    } catch (err: any) {
      console.error('Error in reviewStepSubmission:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}

