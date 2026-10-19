import { Router } from 'express';
import { TeamController } from '../controllers/teamController';
import { authenticateToken, requireRole } from '../middleware/auth';
import { resolveOrganization } from '../middleware/orgContext';
import { Role } from '../models/User';

const router = Router();

// Automatically authenticate and resolve organization context for all team routes
router.use(authenticateToken);
router.use(resolveOrganization);

// Provisioning Routes
router.post('/create-team-leader', requireRole(Role.ROLE_ADMIN), TeamController.createTeamLeader);
router.post('/create-employee', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.createEmployee);
router.post('/', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.createMember);

// Team Leader -> Invite Teammate Routes
router.get('/invitations', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.getInvitations);
router.get('/eligible-teammates', requireRole(Role.ROLE_MANAGER, Role.ROLE_ADMIN), TeamController.getEligibleTeammates);
router.post('/invite-teammates', requireRole(Role.ROLE_MANAGER, Role.ROLE_ADMIN), TeamController.inviteTeammates);
router.post('/invite', requireRole(Role.ROLE_MANAGER, Role.ROLE_ADMIN), TeamController.inviteTeammates);
router.post('/remove-teammate', requireRole(Role.ROLE_MANAGER, Role.ROLE_ADMIN), TeamController.removeTeammate);

router.get('/', TeamController.getAllMembers);
router.post('/resend-invitation', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.resendInvitation);
router.put('/:id/role', requireRole(Role.ROLE_ADMIN), TeamController.updateMemberRole);
router.put('/:id/status', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.updateMemberStatus);
router.post('/:id/deactivate', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.deactivateMember);
router.put('/:id', requireRole(Role.ROLE_ADMIN, Role.ROLE_MANAGER), TeamController.updateMemberDetails);
router.delete('/:id', requireRole(Role.ROLE_ADMIN), TeamController.deleteMember);

export default router;
