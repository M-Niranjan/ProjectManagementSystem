import { Router } from 'express';
import { TeamController } from '../controllers/teamController';
import { AdminController } from '../controllers/adminController';
import { authenticateToken, requireRole } from '../middleware/auth';
import { Role } from '../models/User';

const router = Router();

// Admin provisioning routes
router.post('/create-team-leader', authenticateToken, requireRole(Role.ROLE_ADMIN), TeamController.createTeamLeader);
router.post('/create-employee', authenticateToken, requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.createEmployee);

// Security & Audit Logs (stored in Firebase Firestore)
router.get('/audit-logs', authenticateToken, requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), AdminController.getAuditLogs);
router.post('/audit-logs', authenticateToken, AdminController.createAuditLog);
router.get('/user/:userId', authenticateToken, AdminController.getAuditLogs);

export default router;

