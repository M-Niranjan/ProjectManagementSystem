import { Response } from 'express';
import { Op } from 'sequelize';
import { Notification, User } from '../models';
import { AuthRequest, normalizeRole } from '../middleware/auth';
import { FirebaseAdminService } from '../config/firebaseAdmin';
import { NotificationService } from '../services/notificationService';

export class NotificationController {
  /**
   * GET /api/notifications
   * Retrieves persistent notifications for the authenticated user, strictly isolated by organization.
   */
  public static async getNotifications(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const sqlUserId = req.user.id;
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';

      // 1. First fetch from Firestore for real-time and rich fields
      const firestoreNotifs = await FirebaseAdminService.getFirestoreNotifications(callerUid, targetOrgId, 60);

      // 2. Fetch from SQL table
      const sqlWhere: any = {
        [Op.or]: [
          { recipientUid: callerUid },
          { recipientId: sqlUserId },
        ],
      };
      if (targetOrgId) {
        sqlWhere.organizationId = { [Op.or]: [targetOrgId, null] };
      }

      const sqlNotifs = await Notification.findAll({
        where: sqlWhere,
        order: [['createdAt', 'DESC']],
        limit: 60,
      });

      // Merge and deduplicate by notificationId or ID
      const mergedMap = new Map<string, any>();

      // Put SQL notifications in map
      sqlNotifs.forEach((n) => {
        const key = n.notificationId || String(n.id);
        mergedMap.set(key, {
          id: n.id,
          notificationId: n.notificationId || String(n.id),
          recipientId: n.recipientUid || String(n.recipientId),
          recipientUid: n.recipientUid || callerUid,
          senderId: n.senderId || 'SYSTEM',
          senderName: n.senderName || 'System',
          organizationId: n.organizationId || targetOrgId,
          type: n.type,
          title: n.title,
          message: n.message,
          entityId: n.entityId,
          entityType: n.entityType || 'system',
          priority: n.priority || 'MEDIUM',
          actionUrl: n.actionUrl,
          isRead: n.isRead,
          taskId: n.taskId,
          projectId: n.projectId,
          createdAt: n.createdAt ? n.createdAt.toISOString() : new Date().toISOString(),
          updatedAt: n.updatedAt ? n.updatedAt.toISOString() : new Date().toISOString(),
        });
      });

      // Overlay Firestore notifications
      firestoreNotifs.forEach((fn) => {
        const key = fn.notificationId || fn.id;
        const existing = mergedMap.get(key);
        const createdAtStr = fn.createdAt?.toDate ? fn.createdAt.toDate().toISOString() : fn.createdAt || new Date().toISOString();
        const updatedAtStr = fn.updatedAt?.toDate ? fn.updatedAt.toDate().toISOString() : fn.updatedAt || new Date().toISOString();

        mergedMap.set(key, {
          ...existing,
          ...fn,
          id: existing?.id || fn.id,
          notificationId: fn.notificationId || fn.id,
          createdAt: createdAtStr,
          updatedAt: updatedAtStr,
        });
      });

      const allNotifs = Array.from(mergedMap.values());
      allNotifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return res.json(allNotifs);
    } catch (err: any) {
      console.error('Error in getNotifications:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /api/notifications/unread
   * Retrieves unread notifications and accurate unread count.
   */
  public static async getUnreadNotifications(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const sqlUserId = req.user.id;
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';

      const sqlWhere: any = {
        [Op.or]: [
          { recipientUid: callerUid },
          { recipientId: sqlUserId },
        ],
        isRead: false,
      };
      if (targetOrgId) {
        sqlWhere.organizationId = { [Op.or]: [targetOrgId, null] };
      }

      const unreadSql = await Notification.findAll({
        where: sqlWhere,
        order: [['createdAt', 'DESC']],
        limit: 50,
      });

      return res.json(unreadSql);
    } catch (err: any) {
      console.error('Error in getUnreadNotifications:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * PUT /api/notifications/:id/read
   * Marks an individual notification as read.
   */
  public static async markAsRead(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const paramId = req.params.id;
      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const sqlUserId = req.user.id;

      // Update in SQLite if numerical ID or matching notificationId
      if (!isNaN(Number(paramId))) {
        const notif = await Notification.findByPk(Number(paramId));
        if (notif) {
          if (notif.recipientId !== sqlUserId && notif.recipientUid !== callerUid && req.user.role !== 'ROLE_ADMIN') {
            return res.status(403).json({ message: 'Forbidden: Cannot modify another user notification' });
          }
          notif.isRead = true;
          await notif.save();
          if (notif.notificationId) {
            await FirebaseAdminService.markFirestoreNotificationAsRead(notif.notificationId);
          }
        }
      } else {
        await Notification.update(
          { isRead: true },
          { where: { notificationId: paramId, [Op.or]: [{ recipientUid: callerUid }, { recipientId: sqlUserId }] } }
        );
      }

      // Update in Firestore
      try {
        await FirebaseAdminService.markFirestoreNotificationAsRead(paramId);
      } catch (fErr) {
        console.warn('Firestore mark read warning:', fErr);
      }

      return res.json({ success: true, id: paramId, isRead: true });
    } catch (err: any) {
      console.error('Error in markAsRead:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * PUT /api/notifications/:id/unread
   * Marks an individual notification as unread.
   */
  public static async markAsUnread(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const paramId = req.params.id;
      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const sqlUserId = req.user.id;

      if (!isNaN(Number(paramId))) {
        const notif = await Notification.findByPk(Number(paramId));
        if (notif) {
          if (notif.recipientId !== sqlUserId && notif.recipientUid !== callerUid && req.user.role !== 'ROLE_ADMIN') {
            return res.status(403).json({ message: 'Forbidden' });
          }
          notif.isRead = false;
          await notif.save();
          if (notif.notificationId) {
            await FirebaseAdminService.markFirestoreNotificationAsUnread(notif.notificationId);
          }
        }
      } else {
        await Notification.update(
          { isRead: false },
          { where: { notificationId: paramId, [Op.or]: [{ recipientUid: callerUid }, { recipientId: sqlUserId }] } }
        );
      }

      try {
        await FirebaseAdminService.markFirestoreNotificationAsUnread(paramId);
      } catch (fErr) {
        console.warn('Firestore mark unread warning:', fErr);
      }

      return res.json({ success: true, id: paramId, isRead: false });
    } catch (err: any) {
      console.error('Error in markAsUnread:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * PUT /api/notifications/read-all
   * Marks all notifications for the authenticated user as read in the active organization.
   */
  public static async markAllAsRead(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const sqlUserId = req.user.id;
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';

      // Update in SQLite
      await Notification.update(
        { isRead: true },
        {
          where: {
            [Op.or]: [
              { recipientUid: callerUid },
              { recipientId: sqlUserId },
            ],
            isRead: false,
          },
        }
      );

      // Update in Firestore
      try {
        await FirebaseAdminService.markAllFirestoreNotificationsAsRead(callerUid, targetOrgId);
      } catch (fErr) {
        console.warn('Firestore mark all read warning:', fErr);
      }

      return res.json({ success: true, message: 'All notifications marked as read.' });
    } catch (err: any) {
      console.error('Error in markAllAsRead:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * DELETE /api/notifications/:id
   * Deletes a notification belonging to the current user.
   */
  public static async deleteNotification(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const paramId = req.params.id;
      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const sqlUserId = req.user.id;

      if (!isNaN(Number(paramId))) {
        const notif = await Notification.findByPk(Number(paramId));
        if (notif) {
          if (notif.recipientId !== sqlUserId && notif.recipientUid !== callerUid && req.user.role !== 'ROLE_ADMIN') {
            return res.status(403).json({ message: 'Forbidden' });
          }
          const docId = notif.notificationId;
          await notif.destroy();
          if (docId) {
            await FirebaseAdminService.deleteFirestoreNotification(docId);
          }
        }
      } else {
        await Notification.destroy({
          where: {
            notificationId: paramId,
            [Op.or]: [{ recipientUid: callerUid }, { recipientId: sqlUserId }],
          },
        });
      }

      try {
        await FirebaseAdminService.deleteFirestoreNotification(paramId);
      } catch (fErr) {
        console.warn('Firestore delete notification warning:', fErr);
      }

      return res.json({ success: true, id: paramId });
    } catch (err: any) {
      console.error('Error in deleteNotification:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * POST /api/notifications/device-token
   * Registers or refreshes an Android or Web FCM device token for push notifications.
   */
  public static async registerDeviceToken(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const { fcmToken, platform = 'android', deviceName } = req.body;
      if (!fcmToken || typeof fcmToken !== 'string') {
        return res.status(400).json({ message: 'FCM Token is required.' });
      }

      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';

      const result = await FirebaseAdminService.saveUserDeviceToken(callerUid, {
        organizationId: targetOrgId,
        fcmToken,
        platform,
        deviceName: deviceName || (platform === 'android' ? 'Android Device' : 'Web Browser'),
      });

      return res.json({
        success: true,
        message: 'Device token registered successfully for push notifications.',
        device: result,
      });
    } catch (err: any) {
      console.error('Error in registerDeviceToken:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * DELETE /api/notifications/device-token
   * De-registers an FCM device token on logout or permission revocation.
   */
  public static async unregisterDeviceToken(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const { fcmToken } = req.body;
      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);

      await FirebaseAdminService.removeUserDeviceToken(callerUid, fcmToken);

      return res.json({ success: true, message: 'Device token removed successfully.' });
    } catch (err: any) {
      console.error('Error in unregisterDeviceToken:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /api/notifications/preferences
   * Retrieves the current user's notification preferences.
   */
  public static async getPreferences(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      const preferences = await FirebaseAdminService.getUserNotificationPreferences(callerUid);

      return res.json(preferences);
    } catch (err: any) {
      console.error('Error in getPreferences:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * PUT /api/notifications/preferences
   * Updates the current user's notification preferences.
   */
  public static async updatePreferences(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const { preferences } = req.body;
      if (!preferences || typeof preferences !== 'object') {
        return res.status(400).json({ message: 'Preferences object is required.' });
      }

      const callerUid = req.firebaseUid || req.user.uid || String(req.user.id);
      await FirebaseAdminService.setUserNotificationPreferences(callerUid, preferences);

      return res.json({ success: true, preferences });
    } catch (err: any) {
      console.error('Error in updatePreferences:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * POST /api/notifications
   * Role-authorized privileged notification dispatch.
   * Strictly verifies recipient, permissions, and organization isolation.
   * NEVER broadcasts blindly.
   */
  public static async createNotification(req: AuthRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const {
        title,
        message,
        type = 'SYSTEM_ALERT',
        recipientId,
        recipientUid,
        recipientEmail,
        entityId,
        entityType = 'system',
        priority = 'MEDIUM',
        actionUrl,
        metadata,
      } = req.body;

      if (!title || !message) {
        return res.status(400).json({ message: 'Title and Message are required.' });
      }

      // Check sender permissions
      const senderRole = normalizeRole(req.user.role);
      const isPrivileged = senderRole === 'ROLE_ADMIN' || senderRole === 'ROLE_MANAGER';
      if (!isPrivileged && type === 'SYSTEM_ALERT') {
        return res.status(403).json({ message: 'Only Administrators and Team Leaders can dispatch system alerts.' });
      }

      const targetOrgId = req.organizationId || (req.headers['x-organization-id'] as string) || (req.user as any)?.organizationId || 'org_default';
      const senderUid = req.firebaseUid || req.user.uid || String(req.user.id);

      // Handle organization broadcast when recipient is specified as 'ALL'
      if (recipientId === 'ALL' || recipientUid === 'ALL') {
        const memberMap = new Map<string, { uid?: string; id?: number; email?: string }>();

        try {
          const fsUsers = await FirebaseAdminService.getFirestoreUsersByOrganization(targetOrgId);
          for (const u of fsUsers) {
            const key = (u.email || u.uid || '').toLowerCase().trim();
            if (key) {
              memberMap.set(key, { uid: u.uid, email: u.email });
            }
          }
        } catch (_fsErr) {}

        try {
          const sqlUsers = await User.findAll({ where: { status: { [Op.ne]: 'deactivated' } } });
          for (const u of sqlUsers) {
            const key = (u.email || '').toLowerCase().trim();
            const existing = memberMap.get(key);
            if (existing) {
              existing.id = u.id;
            } else if (key) {
              memberMap.set(key, { id: u.id, email: u.email });
            }
          }
        } catch (_sqlErr) {}

        const members = Array.from(memberMap.values());
        if (members.length > 0) {
          const dispatches = members.map(m =>
            NotificationService.sendNotification({
              recipientUid: m.uid,
              recipientId: m.id,
              recipientEmail: m.email,
              senderUid,
              senderName: req.user?.name || 'Workspace Lead',
              organizationId: targetOrgId,
              type,
              title,
              message,
              entityId,
              entityType,
              priority,
              actionUrl,
              metadata,
            })
          );
          await Promise.all(dispatches);
        }

        return res.status(201).json({
          success: true,
          message: `Broadcast alert delivered to ${members.length} team members.`,
        });
      }

      // A notification must always target an exact recipient
      if (!recipientId && !recipientUid && !recipientEmail) {
        return res.status(400).json({
          message: 'Exact recipient required. Notifications must never be broadcast without an authorized recipient.',
        });
      }

      const dispatched = await NotificationService.sendNotification({
        recipientUid: recipientUid || (typeof recipientId === 'string' && isNaN(Number(recipientId)) ? recipientId : undefined),
        recipientId: !isNaN(Number(recipientId)) ? Number(recipientId) : undefined,
        recipientEmail,
        senderUid,
        senderName: req.user.name || 'Workspace Lead',
        organizationId: targetOrgId,
        type,
        title,
        message,
        entityId,
        entityType,
        priority,
        actionUrl,
        metadata,
      });

      if (!dispatched) {
        return res.status(400).json({ message: 'Could not deliver notification to specified recipient in this organization.' });
      }

      return res.status(201).json({
        success: true,
        message: 'Notification dispatched successfully.',
        notification: dispatched,
      });
    } catch (err: any) {
      console.error('Error in createNotification:', err);
      return res.status(500).json({ error: err.message });
    }
  }
}
