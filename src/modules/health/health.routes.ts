import { Router } from 'express';
import { HealthController } from './health.controller';

const router = Router();

router.get('/liveness', HealthController.liveness);
router.get('/readiness', HealthController.readiness);

export const healthRoutes = router;

